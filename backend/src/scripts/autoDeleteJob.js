import 'dotenv/config';
import { autoDeleteOldRecords } from '../controllers/recordsController.js';
import logger from '../utils/logger.js';

/**
 * Standalone script for running auto-delete job
 * Intended to be called by external schedulers (Cron, Cloud Scheduler, etc.)
 * 
 * Usage:
 *   node src/scripts/autoDeleteJob.js
 * 
 * Environment variables:
 *   - AUTO_DELETE_RETENTION_MONTHS: Retention period in months (default: 4)
 *   - AUTO_DELETE_INTERVAL_HOURS: Minimum hours between executions (default: 24)
 */
(async () => {
  try {
    logger.info('Starting auto-delete job script...');
    
    const result = await autoDeleteOldRecords();
    
    if (result.success) {
      logger.info('Auto-delete job completed successfully', result);
      process.exit(0);
    } else {
      logger.warn('Auto-delete job skipped', { reason: result.reason });
      // Exit with code 0 even if skipped (not an error)
      process.exit(0);
    }
  } catch (error) {
    logger.error('Auto-delete job script failed', error);
    process.exit(1);
  }
})();
