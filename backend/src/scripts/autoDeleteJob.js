import 'dotenv/config';
import { autoDeleteOldRecords } from '../controllers/recordsController.js';
import { autoDeleteOldFollows } from '../controllers/followController.js';
import logger from '../utils/logger.js';

/**
 * Standalone script for running auto-delete job (Records + Follow)
 * Intended to be called by external schedulers (Cron, Cloud Scheduler, etc.)
 * 
 * Usage:
 *   node src/scripts/autoDeleteJob.js
 * 
 * Environment variables:
 *   - AUTO_DELETE_RETENTION_MONTHS: Retention period in months (default: 2)
 *   - AUTO_DELETE_INTERVAL_HOURS: Minimum hours between executions (default: 24)
 */
(async () => {
  try {
    logger.info('Starting auto-delete job script...');
    
    const [recordsResult, followsResult] = await Promise.all([
      autoDeleteOldRecords(),
      autoDeleteOldFollows(),
    ]);
    
    logger.info('Auto-delete job completed', {
      records: recordsResult,
      follows: followsResult,
    });

    if (!recordsResult.success && !followsResult.success) {
      logger.warn('Both auto-delete jobs were skipped', {
        recordsReason: recordsResult.reason,
        followsReason: followsResult.reason,
      });
    }

    process.exit(0);
  } catch (error) {
    logger.error('Auto-delete job script failed', error);
    process.exit(1);
  }
})();
