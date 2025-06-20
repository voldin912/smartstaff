import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure upload directories exist
const audioUploadDir = 'uploads/audio';
const logoUploadDir = 'uploads/logos';
if (!fs.existsSync(audioUploadDir)) {
  fs.mkdirSync(audioUploadDir, { recursive: true });
}
if (!fs.existsSync(logoUploadDir)) {
  fs.mkdirSync(logoUploadDir, { recursive: true });
}

// Configure multer storage for audio files
const audioStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, audioUploadDir);
  },
  filename: function (req, file, cb) {
    // Get original filename without extension
    const originalName = file.originalname.split('.')[0];
    // Create date in YYYYmmddHHMMSS format
    const now = new Date();
    const dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    // Create unique filename with original name as prefix
    const uniqueSuffix = dateStr;
    // Use the original filename directly
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure multer storage for logo files
const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, logoUploadDir);
  },
  filename: function (req, file, cb) {
    // Create date in YYYYmmddHHMMSS format
    const now = new Date();
    const dateStr = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    // Create unique filename with company slug or timestamp
    const uniqueSuffix = dateStr;
    cb(null, `logo_${uniqueSuffix}${path.extname(file.originalname)}`);
  }
});

// Configure multer upload for audio files
const upload = multer({
  storage: audioStorage,
  fileFilter: function (req, file, cb) {
    // Accept only audio files
    if (!file.mimetype.startsWith('audio/')) {
      return cb(new Error('Only audio files are allowed!'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Configure multer upload for logo files
const logoUpload = multer({
  storage: logoStorage,
  fileFilter: function (req, file, cb) {
    // Accept only image files
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'));
    }
    cb(null, true);
  },
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

export { upload, logoUpload }; 