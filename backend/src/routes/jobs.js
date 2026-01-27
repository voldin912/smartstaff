import express from 'express';
import { auth, authorize } from '../middleware/auth.js';
import { autoDeleteOldRecords } from '../controllers/recordsController.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Auto-delete old records job endpoint
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

      const result = await autoDeleteOldRecords();

      if (result.success) {
        res.json({
          success: true,
          message: 'Auto-delete job completed successfully',
          deletedCount: result.deletedCount || 0
        });
      } else {
        const statusCode = result.reason === 'lock_not_acquired' || result.reason === 'recently_executed' 
          ? 200 // Not an error, just skipped
          : 500;
        
        res.status(statusCode).json({
          success: false,
          message: `Auto-delete job skipped: ${result.reason}`,
          reason: result.reason,
          lastRun: result.lastRun
        });
      }
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
