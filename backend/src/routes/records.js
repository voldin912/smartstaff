import express from 'express';
import { auth } from '../middleware/auth.js';
import { getRecords, uploadAudio, testAPI, downloadSTT, downloadSkillSheet, updateStaffId, updateSkillSheet, getSkillSheet, updateSalesforce, downloadSalesforce, downloadBulk, updateLoR, deleteOldRecords } from '../controllers/recordsController.js';
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

// Manual cleanup of old records (admin only) - for testing or manual execution
router.post('/cleanup/old-records', auth, async (req, res) => {
  try {
    // Only allow admin to manually trigger cleanup
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. Admin only.' });
    }
    
    const result = await deleteOldRecords();
    res.json({ 
      success: true, 
      message: 'Cleanup completed successfully',
      ...result 
    });
  } catch (error) {
    console.error('Error during manual cleanup:', error);
    res.status(500).json({ error: 'Failed to cleanup old records' });
  }
});

export default router;