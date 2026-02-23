import express from 'express';
import { auth, authorize } from '../middleware/auth.js';
import { autoDeleteOldRecords } from '../controllers/recordsController.js';
import { autoDeleteOldFollows } from '../controllers/followController.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Auto-delete old records and follows job endpoint
// Runs both Records (DB rows + audio files) and Follow (DB rows only) cleanup
// Intended to be called by external schedulers (Cron, Cloud Scheduler, etc.)
// Requires authentication (admin or company-manager)
router.post(
  '/auto-delete',
  auth,
  authorize('admin', 'company-manager'),
  async (req, res) => {
    try {
      logger.info('Auto-delete job triggered via API', {
        triggeredBy: req.user.id,
        userRole: req.user.role
      });

      const [recordsResult, followsResult] = await Promise.all([
        autoDeleteOldRecords(),
        autoDeleteOldFollows(),
      ]);

      res.json({
        success: recordsResult.success || followsResult.success,
        records: {
          success: recordsResult.success,
          deletedCount: recordsResult.deletedCount || 0,
          filesDeleted: recordsResult.filesDeleted || 0,
          reason: recordsResult.reason || null,
        },
        follows: {
          success: followsResult.success,
          deletedCount: followsResult.deletedCount || 0,
          reason: followsResult.reason || null,
        },
      });
    } catch (error) {
      logger.error('Error in auto-delete job endpoint', error);
      res.status(500).json({
        success: false,
        message: 'Auto-delete job failed',
        error: error.message
      });
    }
  }
);

export default router;
