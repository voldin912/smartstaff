import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Ensure upload directory exists
const uploadDir = 'uploads/audio';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
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

// Configure multer upload
const upload = multer({
  storage: storage,
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

export default upload; 