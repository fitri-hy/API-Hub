const axios = require('axios');
const AdminSettings = require('../models/AdminSettings');

const verifyTurnstile = async (token, remoteip = '') => {
  try {
    const turnstileEnabledSetting = await AdminSettings.get('auth_turnstile_enabled');
    const turnstileEnabled = turnstileEnabledSetting === 'true' || turnstileEnabledSetting === true || turnstileEnabledSetting === '1' || turnstileEnabledSetting === 1;

    if (!turnstileEnabled) {
      return true;
    }

    const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

    if (!secretKey) {
      console.error('CRITICAL: CLOUDFLARE_TURNSTILE_SECRET_KEY is missing in environment variables.');
      return false;
    }

    if (!token) {
      return false;
    }

    const response = await axios.post(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      new URLSearchParams({
        secret: secretKey,
        response: token,
        remoteip: remoteip
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data && response.data.success === true;
  } catch (error) {
    console.error('Turnstile verification error:', error.message);
    return false;
  }
};

module.exports = { verifyTurnstile };