import express from 'express';
import { auth, authorize } from '../middleware/auth.js';
import { getRecords, uploadAudio, testAPI, downloadSTT, downloadSkillSheet, updateStaffId, updateSkillSheet, getSkillSheet, updateSalesforce, downloadSalesforce, downloadBulk, updateLoR, getPrompt, updatePrompt } from '../controllers/followController.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

// Get all records
router.get('/', auth, getRecords);

// Upload audio file
router.post('/upload', auth, upload.single('audio'), uploadAudio);

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

// Get prompt (admin only)
router.get('/prompt', auth, authorize('admin'), getPrompt);

// Update prompt (admin only)
router.put('/prompt', auth, authorize('admin'), updatePrompt);

export default router;
