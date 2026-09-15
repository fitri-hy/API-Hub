const express = require('express');
const router = express.Router();
const publicController = require('../controllers/public/publicController');

router.get('/', publicController.getLanding);
router.get('/browser-apis', publicController.getBrowserApi);
router.get('/browser-apis/:slug', publicController.getBrowserApiDetail);

// Static pages
router.get('/contact', publicController.getContact);
router.get('/about', publicController.getAbout);
router.get('/terms', publicController.getTerms);
router.get('/privacy', publicController.getPrivacy);
router.get('/security', publicController.getSecurity);
router.get('/referral', publicController.getReferral);

module.exports = router;
