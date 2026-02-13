import express from 'express';
import { auth, authorize } from '../middleware/auth.js';
import { getRecords, uploadAudio, downloadSTT, updateStaffId, updateStaffName, updateSummary, deleteRecord, getPrompt, updatePrompt } from '../controllers/followController.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Get all records (paginated)
router.get('/', auth, getRecords);

// Upload audio file
router.post('/upload', auth, upload.single('audio'), uploadAudio);

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

// Get prompt (admin only)
router.get('/prompt', auth, authorize('admin'), getPrompt);

// Update prompt (admin only)
router.put('/prompt', auth, authorize('admin'), updatePrompt);

export default router;
