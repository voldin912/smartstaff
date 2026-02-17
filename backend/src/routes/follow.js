import express from 'express';
import { auth, authorize } from '../middleware/auth.js';
import {
  getRecords,
  uploadAudio,
  downloadSTT,
  updateStaffId,
  updateStaffName,
  updateSummary,
  deleteRecord,
  getPrompt,
  updatePrompt,
  getProcessingJobStatus,
  getProcessingJobs,
  retryProcessingJob,
} from '../controllers/followController.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Get all records (paginated)
router.get('/', auth, getRecords);

// Upload audio file (async - returns jobId)
router.post('/upload', auth, upload.single('audio'), uploadAudio);

// Processing job status routes (must be before /:recordId routes to avoid conflict)
router.get('/processing/jobs', auth, getProcessingJobs);
router.get('/processing/jobs/:jobId', auth, getProcessingJobStatus);
router.post('/processing/jobs/:jobId/retry', auth, retryProcessingJob);

// Download STT as PDF
router.get('/:recordId/stt', auth, downloadSTT);

// Update staffId
router.put('/:recordId/staff-id', auth, updateStaffId);

// Update staff name
router.put('/:recordId/staff-name', auth, updateStaffName);

// Update summary
router.put('/:recordId/summary', auth, updateSummary);

// Delete record
router.delete('/:recordId', auth, deleteRecord);

// Get prompt (admin and company-manager)
router.get('/prompt', auth, authorize('admin', 'company-manager'), getPrompt);

// Update prompt (admin and company-manager)
router.put('/prompt', auth, authorize('admin', 'company-manager'), updatePrompt);

export default router;
