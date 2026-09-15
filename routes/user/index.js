const express = require('express');
const router = express.Router();
const multer = require('multer');
const userController = require('../../controllers/user/userController');
const playgroundController = require('../../controllers/playgroundController');
const { loadUser, requireUser } = require('../../middleware/auth');
const { uploadAvatar } = require('../../middleware/upload');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(loadUser);
router.use(requireUser);

// Dashboard
router.get('/', userController.dashboard);
router.get('/dashboard', userController.dashboard);

// API Keys
router.get('/api-keys', userController.apiKeys);
router.get('/api-keys/:keyId/stats', userController.apiKeyStats);
router.post('/api-keys/create', userController.createApiKey);
router.post('/api-keys/:keyId/edit', userController.updateApiKey);
router.post('/api-keys/:keyId/delete', userController.deleteApiKey);
router.post('/api-keys/:keyId/scopes', userController.updateApiKeyScopes);
router.get('/api-keys/:keyId/scopes', userController.getApiKeyScopes);

// Favorites
router.post('/favorites/toggle/:apiId', userController.toggleFavorite);

// Browse APIs (admin-created)
router.get('/browse-apis', userController.browseApis);
router.get('/browse-apis/:slug', userController.apiDetail);

// Credits
router.get('/credits', userController.credits);
router.post('/credits/calculate', userController.calculateCustomPackage);
router.post('/credits/purchase', userController.purchasePackage);

// Transactions
router.get('/transactions', userController.transactions);
router.get('/transactions/:id', userController.transactionDetail);
router.post('/transactions/:id/upload-proof', uploadAvatar.single('payment_proof'), userController.uploadPaymentProof);

// Logs
router.get('/logs', userController.logs);

// Profile
router.get('/profile', userController.profile);
router.post('/profile', uploadAvatar.single('avatar'), userController.updateProfile);

// Email Verification (OTP)
router.use('/verify-email', require('./email-verification'));

// Legacy verification request (kept for backward compatibility)
router.post('/request-verification', userController.requestVerification);

// Referral
router.get('/referrals', userController.referrals);

// Playground
router.get('/playground', userController.playground);
router.post('/playground/init', playgroundController.init);
router.post('/playground/status', playgroundController.status);
router.post('/playground/execute', upload.single('file'), playgroundController.execute);
router.post('/playground/honeypot', playgroundController.honeypot);
router.get('/playground/apis', playgroundController.listApis);
router.get('/playground/apis/:slug/routes', playgroundController.getRoutes);

// Notifications
router.use('/notification', require('./notification'));

module.exports = router;
