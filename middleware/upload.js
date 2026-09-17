const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs').promises;

const avatarDir = path.join(__dirname, '../public/uploads/avatars');
const siteDir = path.join(__dirname, '../public/uploads/site');

// Storage configuration for avatars
const avatarStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, avatarDir);
  },

  filename: function (req, file, cb) {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);

    cb(
      null,
      `avatar-${req.session.userId}-${uniqueSuffix}${ext}`
    );
  }
});

// File filter for images only
const imageFilter = function (req, file, cb) {
  const allowedTypes = /jpeg|jpg|png|gif|webp/;

  const extname = allowedTypes.test(
    path.extname(file.originalname).toLowerCase()
  );

  const mimetype = allowedTypes.test(file.mimetype);

  if (extname && mimetype) {
    return cb(null, true);
  }

  cb(new Error(
    'Only image files (jpeg, jpg, png, gif, webp) are allowed'
  ));
};

const uploadAvatar = multer({
  storage: avatarStorage,
  limits: {
    fileSize: 2 * 1024 * 1024
  },
  fileFilter: imageFilter
});

// ==========================================
// SITE IMAGE UPLOAD (logo, favicon, og_image)
// ==========================================
const siteStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, siteDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(file.originalname);
    const prefix = file.fieldname === 'site_favicon' ? 'favicon' : file.fieldname === 'site_og_image' ? 'og-image' : file.fieldname === 'qris_image' ? 'qris' : 'logo';
    cb(null, `${prefix}-${uniqueSuffix}${ext}`);
  }
});

const uploadSiteImage = multer({
  storage: siteStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB for site images
  },
  fileFilter: imageFilter
});

// ==========================================
// DELETE AVATAR
// ==========================================
const deleteAvatar = async (avatar) => {
  if (!avatar) return false;

  const filename = path.basename(avatar);
  const avatarPath = path.join(avatarDir, filename);

  try {
    await fs.unlink(avatarPath);

    console.log('Avatar berhasil dihapus:', avatarPath);

    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Avatar tidak ditemukan:', avatarPath);
      return false;
    }

    console.error('Gagal menghapus avatar:', err.message);
    throw err;
  }
};

// ==========================================
// DELETE SITE IMAGE
// ==========================================
const deleteSiteImage = async (imagePath) => {
  if (!imagePath) return false;

  // Only delete files in the site uploads directory
  const relativePath = imagePath.replace('/uploads/site/', '');
  if (relativePath === imagePath) return false; // not a site image

  const fullPath = path.join(siteDir, path.basename(imagePath));

  try {
    await fs.unlink(fullPath);
    console.log('Site image deleted:', fullPath);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('Site image not found:', fullPath);
      return false;
    }
    console.error('Failed to delete site image:', err.message);
    throw err;
  }
};

module.exports = {
  uploadAvatar,
  deleteAvatar,
  uploadSiteImage,
  deleteSiteImage
};