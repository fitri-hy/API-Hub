const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const gatewayController = require('../controllers/gatewayController');
const { loadUser, requireUser } = require('../middleware/auth');

// Gateway file upload — memory storage (no disk), max 50MB
const gatewayUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|bmp|tiff|svg|mp3|mp4|wav|ogg|flac|aac|opus|wma|amr|m4a|avi|mov|mkv|webm|3gp|ts|mts|wmv|flv|pdf|txt|csv|json|xml|zip|rar|doc|docx|xls|xlsx|ppt|pptx|apk|exe|bin/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!ext || allowed.test(ext)) return cb(null, true);
    cb(new Error(`File type \".${ext}\" not allowed`));
  }
});

// Public API listing
router.get('/apis', gatewayController.listPublic);

// API documentation
router.get(
    '/:slug/docs',
    loadUser,
    requireUser,
    gatewayController.docs
);

// Streaming download endpoint — serves temp files, auto-deletes after
const fs = require('fs');
const tempDir = path.join(__dirname, '..', 'temp');
const fileTtl = require('../script/fileTtl');

router.get('/download/:filename', (req, res) => {
  const { filename } = req.params;

  // Security: prevent path traversal
  const safeName = path.basename(filename);
  if (safeName !== filename || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const filePath = path.join(tempDir, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found or already expired' });
  }

  // Cancel auto-delete timer — user is downloading now
  fileTtl.cancel(filePath);

  const stat = fs.statSync(filePath);
  const ext = path.extname(safeName).toLowerCase();
  const mimeMap = {
    // video
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.webm': 'video/webm',
    '.avi': 'video/x-msvideo', '.mov': 'video/quicktime', '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv', '.3gp': 'video/3gpp', '.ts': 'video/mp2t',
    '.mts': 'video/mp2t',
    // audio
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.opus': 'audio/opus', '.wav': 'audio/wav',
    '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma', '.amr': 'audio/amr',
    // image
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.tiff': 'image/tiff', '.tif': 'image/tiff',
    // docs
    '.pdf': 'application/pdf', '.txt': 'text/plain',
    '.csv': 'text/csv', '.json': 'application/json', '.xml': 'application/xml',
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed'
  };

  res.set({
    'Content-Type': mimeMap[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `attachment; filename="${safeName}"`,
    'Cache-Control': 'no-store'
  });

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);

  // Cleanup after response finishes (or on error)
  const cleanup = () => { try { fs.unlinkSync(filePath); } catch {} };
  stream.on('end', cleanup);
  stream.on('error', cleanup);
  res.on('close', () => { fileTtl.cancel(filePath); cleanup(); });
});

// API execution (catch-all) — with optional file upload (field name: "file")
router.all('/:slug/*', gatewayUpload.single('file'), gatewayController.handleRequest);

module.exports = router;
