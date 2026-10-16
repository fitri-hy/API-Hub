const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const AdminSettings = require('../models/AdminSettings');
const Credit = require('../models/Credit');
const SystemLog = require('../models/SystemLog');
const helpers = require('../utils/helpers');
const fs = require('fs');
const path = require('path');
const https = require('https');

async function downloadGoogleAvatar(photoUrl, userId) {
    if (!photoUrl) return null;
    return new Promise((resolve) => {
        const uploadDir = path.join(__dirname, '../public/uploads/avatars');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const filename = `avatar-${userId}-${Date.now()}.jpg`;
        const filePath = path.join(uploadDir, filename);
        const relativePath = `/uploads/avatars/${filename}`;

        https.get(photoUrl, (response) => {
            if (response.statusCode === 200) {
                const fileStream = fs.createWriteStream(filePath);
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve(relativePath);
                });
            } else {
                resolve(null);
            }
        }).on('error', () => {
            resolve(null);
        });
    });
}

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    passReqToCallback: true,
    prompt: 'select_account'
}, async (req, accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const googleId = profile.id;
        const fullName = profile.displayName;
        const rawAvatar = profile.photos && profile.photos[0] ? profile.photos[0].value : null;
        const clientIp = helpers.getClientIp(req);
        const userAgent = req.headers['user-agent'];

        let user = await User.findByGoogleId(googleId);
        if (user) {
            return done(null, user);
        }

        if (email) {
            user = await User.findByEmail(email);
            if (user) {
                let localAvatar = user.avatar;
                if (!localAvatar || localAvatar.startsWith('http')) {
                    localAvatar = await downloadGoogleAvatar(rawAvatar, user.id);
                }

                await User.update(user.id, { 
                    google_id: googleId, 
                    is_verified: 1,
                    avatar: localAvatar
                });
                
                user = await User.findById(user.id);

                await SystemLog.create({
                    userId: user.id,
                    action: 'auth_link_google',
                    details: { email: user.email },
                    ipAddress: clientIp,
                    userAgent: userAgent
                });

                return done(null, user);
            }
        }

        let baseUsername = email ? email.split('@')[0] : 'user_' + Date.now();
        baseUsername = baseUsername.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
        let username = baseUsername;
        let counter = 1;

        while (await User.findByUsername(username)) {
            username = `${baseUsername}${counter++}`;
        }

        const newUser = await User.createFromGoogle({
            googleId,
            email,
            username,
            fullName,
            avatar: null
        });

        const localAvatar = await downloadGoogleAvatar(rawAvatar, newUser.id);
        if (localAvatar) {
            await User.update(newUser.id, { avatar: localAvatar });
            newUser.avatar = localAvatar;
        }

        try {
            const bonusEnabled = await AdminSettings.get('new_user_bonus_enabled');
            if (bonusEnabled) {
                const bonusCredits = parseInt(await AdminSettings.get('default_credits')) || 0;
                if (bonusCredits > 0) {
                    await Credit.add(newUser.id, bonusCredits, 'Bonus credit for new Google user', 'bonus', null, null);
                }
            }
        } catch (bonusErr) {
            console.error('Error granting bonus credits for Google user:', bonusErr);
        }

        try {
            await SystemLog.create({
                userId: newUser.id,
                action: 'auth_register_google',
                details: { email: newUser.email, username: newUser.username },
                ipAddress: clientIp,
                userAgent: userAgent
            });
        } catch (logErr) {
            console.error('System log error for Google register:', logErr);
        }

        return done(null, newUser);
    } catch (err) {
        console.error('Google Strategy Error:', err);
        return done(err, null);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

module.exports = passport;