import express from 'express';
import multer from 'multer';
import { auth } from '../middleware/auth.js';
import { 
  getRecords, 
  getRecordDetail, 
  uploadAudio, 
  getProcessingJobStatus,
  getProcessingJobs,
  retryProcessingJob,
  testAPI, 
  downloadSTT, 
  downloadSkillSheet, 
  updateStaffId, 
  updateStaffName, 
  updateMemo, 
  updateSkillSheet, 
  getSkillSheet, 
  updateSalesforce, 
  downloadSalesforce, 
  downloadBulk, 
  updateLoR, 
  deleteRecord 
} from '../controllers/recordsController.js';
import { upload } from '../middleware/upload.js';
import logger from '../utils/logger.js';
import cacheMiddleware, { getCacheKey } from '../middleware/cache.js';

const router = express.Router();

// Get all records (caching disabled for immediate UI updates)
router.get('/', auth, /* cacheMiddleware({
  prefix: 'records',
  includeQuery: true,
  ttl: 30
}), */ getRecords);

// Get single record detail (must be before other /:recordId routes) (caching disabled for immediate UI updates)
router.get('/:recordId', auth, /* cacheMiddleware({
  keyGenerator: (req) => {
    const recordId = req.params.recordId;
    const { role, company_id } = req.user;
    if (role === 'admin') {
      return `records:detail:${recordId}:admin`;
    }
    return `records:detail:${recordId}:company:${company_id}`;
  },
  includeParams: true,
  ttl: 30
}), */ getRecordDetail);

// Upload audio file with multer error handling
router.post('/upload', auth, (req, res, next) => {
  upload.single('audio')(req, res, (err) => {
    if (err) {
      logger.error('Multer error', err);
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'ファイルサイズが大きすぎます。100MB以下にしてください。' });
        }
        return res.status(400).json({ error: `ファイルアップロードエラー: ${err.message}` });
      }
      // Handle fileFilter errors
      if (err.message) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: 'ファイルのアップロードに失敗しました。' });
    }
    next();
  });
}, uploadAudio);

// ============================================
// Processing Job Status APIs (for async upload)
// ============================================

// Get all processing jobs for current user
router.get('/processing/jobs', auth, getProcessingJobs);

// Get single processing job status (for polling)
router.get('/processing/jobs/:jobId', auth, getProcessingJobStatus);

// Retry a failed processing job
router.post('/processing/jobs/:jobId/retry', auth, retryProcessingJob);

// ============================================
// Record Download/Update APIs
// ============================================

// Download STT as PDF
router.get('/:recordId/stt', auth, downloadSTT);

// Download Skill Sheet as PDF
router.get('/:recordId/skill-sheet', auth, downloadSkillSheet);

// Get Skill Sheet
router.get('/:recordId/get-skill-sheet', auth, getSkillSheet);

// Update Skill Sheet
router.put('/:recordId/skill-sheet', auth, updateSkillSheet);

// Update staffId
router.put('/:recordId/staff-id', auth, updateStaffId);

// Update staff name
router.put('/:recordId/staff-name', auth, updateStaffName);

// Update memo
router.put('/:recordId/memo', auth, updateMemo);

// Update Salesforce data
router.put('/:recordId/salesforce', auth, updateSalesforce);

// Download Salesforce as PDF
router.get('/:recordId/salesforce-pdf', auth, downloadSalesforce);

// Download Bulk as PDF
router.get('/:recordId/bulk', auth, downloadBulk);

// Test API
router.get('/test', auth, testAPI);

// Update LoR
router.put('/:recordId/lor', auth, updateLoR);

// Delete record
router.delete('/:recordId', auth, deleteRecord);

export default router;