import 'dotenv/config';
import { pool } from '../config/database.js';
import { addAudioProcessingJob } from '../queues/audioQueue.js';
import logger from '../utils/logger.js';

/**
 * Recover Orphaned Jobs Script
 * 
 * This script finds jobs that are stuck in 'processing' status
 * (likely due to server restart or crash) and re-queues them.
 * 
 * Run this script:
 * - Once during migration to BullMQ
 * - After any unexpected server crash
 * - Periodically via cron as a safety net
 * 
 * Usage:
 *   npm run job:recover-orphaned
 *   node src/scripts/recoverOrphanedJobs.js
 * 
 * Environment variables:
 *   - ORPHAN_THRESHOLD_MINUTES: Minutes of inactivity before job is considered orphaned (default: 30)
 *   - ORPHAN_REQUEUE: Set to 'true' to re-queue orphaned jobs, otherwise just report (default: false)
 */

const ORPHAN_THRESHOLD_MINUTES = parseInt(process.env.ORPHAN_THRESHOLD_MINUTES || '30');
const SHOULD_REQUEUE = process.env.ORPHAN_REQUEUE === 'true';

async function findOrphanedJobs() {
  try {
    // Find jobs that have been in 'processing' status for too long without updates
    const [orphanedJobs] = await pool.query(`
      SELECT 
        id,
        file_id,
        user_id,
        company_id,
        staff_id,
        local_file_path,
        status,
        progress,
        current_step,
        created_at,
        updated_at,
        TIMESTAMPDIFF(MINUTE, updated_at, NOW()) as minutes_since_update
      FROM processing_jobs
      WHERE status = 'processing'
        AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
      ORDER BY created_at ASC
    `, [ORPHAN_THRESHOLD_MINUTES]);

    return orphanedJobs;
  } catch (error) {
    logger.error('Error finding orphaned jobs', error);
    throw error;
  }
}

async function resetJobToPending(jobId) {
  try {
    await pool.query(`
      UPDATE processing_jobs 
      SET status = 'pending', 
          progress = 0, 
          current_step = '復旧中: キューに再登録',
          error_message = NULL,
          updated_at = NOW()
      WHERE id = ?
    `, [jobId]);
    
    // Also reset any chunk processing records
    await pool.query(`
      UPDATE chunk_processing 
      SET status = 'pending', 
          retry_count = 0, 
          error_message = NULL,
          updated_at = NOW()
      WHERE job_id = ?
    `, [jobId]);
    
    logger.info('Job reset to pending status', { jobId });
  } catch (error) {
    logger.error('Error resetting job', { jobId, error: error.message });
    throw error;
  }
}

async function requeueJob(job) {
  try {
    // Reset job status first
    await resetJobToPending(job.id);
    
    // Add to BullMQ queue
    await addAudioProcessingJob({
      jobId: job.id,
      audioFilePath: job.local_file_path,
      fileId: job.file_id,
      userId: job.user_id,
      companyId: job.company_id,
      staffId: job.staff_id,
    });
    
    logger.info('Orphaned job re-queued successfully', {
      jobId: job.id,
      fileId: job.file_id,
      minutesSinceUpdate: job.minutes_since_update,
    });
    
    return true;
  } catch (error) {
    logger.error('Error re-queuing job', { jobId: job.id, error: error.message });
    return false;
  }
}

async function main() {
  logger.info('='.repeat(50));
  logger.info('Orphaned Jobs Recovery Script');
  logger.info('='.repeat(50));
  logger.info(`Threshold: ${ORPHAN_THRESHOLD_MINUTES} minutes`);
  logger.info(`Mode: ${SHOULD_REQUEUE ? 'REQUEUE' : 'REPORT ONLY'}`);
  logger.info('');

  try {
    const orphanedJobs = await findOrphanedJobs();

    if (orphanedJobs.length === 0) {
      logger.info('No orphaned jobs found. All jobs are healthy.');
      await pool.end();
      process.exit(0);
    }

    logger.info(`Found ${orphanedJobs.length} orphaned job(s):`);
    logger.info('');

    for (const job of orphanedJobs) {
      logger.info(`Job ID: ${job.id}`);
      logger.info(`  File ID: ${job.file_id}`);
      logger.info(`  User ID: ${job.user_id}`);
      logger.info(`  Status: ${job.status}`);
      logger.info(`  Progress: ${job.progress}%`);
      logger.info(`  Current Step: ${job.current_step}`);
      logger.info(`  Created: ${job.created_at}`);
      logger.info(`  Last Update: ${job.updated_at}`);
      logger.info(`  Minutes Since Update: ${job.minutes_since_update}`);
      logger.info(`  Audio File: ${job.local_file_path}`);
      logger.info('');
    }

    if (SHOULD_REQUEUE) {
      logger.info('Re-queuing orphaned jobs...');
      logger.info('');

      let successCount = 0;
      let failCount = 0;

      for (const job of orphanedJobs) {
        const success = await requeueJob(job);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }
      }

      logger.info('');
      logger.info('Recovery Summary:');
      logger.info(`  Successfully re-queued: ${successCount}`);
      logger.info(`  Failed to re-queue: ${failCount}`);
    } else {
      logger.info('To re-queue these jobs, run with ORPHAN_REQUEUE=true:');
      logger.info('  ORPHAN_REQUEUE=true npm run job:recover-orphaned');
    }

    await pool.end();
    process.exit(0);
  } catch (error) {
    logger.error('Recovery script failed', error);
    await pool.end();
    process.exit(1);
  }
}

main();
