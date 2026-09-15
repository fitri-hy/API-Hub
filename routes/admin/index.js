const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const adminController = require('../../controllers/admin/adminController');
const { loadUser, requireAdmin } = require('../../middleware/auth');
const { uploadAvatar, uploadSiteImage } = require('../../middleware/upload');

// Multer config for avatar uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../public/uploads/avatars')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `user-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  }
});

router.use(loadUser);
router.use(requireAdmin);

// Dashboard
router.get('/', adminController.dashboard);
router.get('/dashboard', adminController.dashboard);

// Users
router.get('/users', adminController.users);
router.get('/users/:uuid', adminController.userDetail);
router.post('/users/:uuid', upload.single('avatar'), adminController.updateUser);
router.post('/users/:uuid/credits', adminController.addCredits);
router.post('/users/:uuid/verification/:requestId/approve', adminController.approveVerification);
router.post('/users/:uuid/verification/:requestId/reject', adminController.rejectVerification);
router.post('/users/:uuid/delete', adminController.deleteUser);

// APIs (Admin CRUD)
router.get('/apis', adminController.apis);
router.get('/apis/create', adminController.apiCreateForm);
router.post('/apis/create', adminController.apiCreate);
router.get('/apis/:id', adminController.apiDetail);
router.get('/apis/:id/edit', adminController.apiEdit);
router.post('/apis/:id/edit', adminController.apiUpdate);
router.post('/apis/:id/delete', adminController.apiDelete);

// Routes (within APIs)
router.post('/apis/:id/routes/create', adminController.routeCreate);
router.post('/apis/:id/routes/:routeId/edit', adminController.routeEdit);
router.post('/apis/:id/routes/:routeId/delete', adminController.routeDelete);

// Packages
router.get('/packages', adminController.packages);
router.post('/packages', adminController.createPackage);
router.post('/packages/:id', adminController.updatePackage);
router.post('/packages/:id/delete', adminController.deletePackage);

// Request Logs (Ditambahkan di sini)
router.get('/logs', adminController.logs);
router.post('/logs/clear', adminController.clearLogs);

// Credit Logs
router.get('/credit-logs', adminController.creditLogs);
router.post('/credit-logs/clear', adminController.clearCreditLogs);

// Transactions
router.get('/transactions', adminController.transactions);
router.get('/transactions/:id', adminController.transactionDetail);
router.post('/transactions/:id/approve', adminController.approveTransaction);
router.post('/transactions/:id/reject', adminController.rejectTransaction);

// System Logs
router.get('/system-logs', adminController.systemLogs);
router.post('/system-logs/clear', adminController.clearSystemLogs);

// Settings
router.get('/settings', adminController.settings);
router.post('/settings', uploadSiteImage.fields([
  { name: 'site_logo', maxCount: 1 },
  { name: 'site_favicon', maxCount: 1 },
  { name: 'site_og_image', maxCount: 1 }
]), adminController.updateSettings);
router.post('/settings/test-smtp', adminController.testSmtp);

// Referral Reports
router.get('/referrals', adminController.referrals);

// Notifications
router.use('/notification', require('./notification'));
router.use('/push-notification', require('./push-notification'));

module.exports = router;
