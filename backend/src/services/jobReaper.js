import { pool } from '../config/database.js';
import logger from '../utils/logger.js';
import { addAudioProcessingJob } from '../queues/audioQueue.js';

/**
 * Job Reaper Service
 * 
 * Periodically checks for stalled/hung jobs and marks them as failed.
 * Jobs can be automatically re-queued if they haven't exceeded max attempts.
 */

// Configuration from environment variables
const CONFIG = {
  heartbeatTimeoutMinutes: parseInt(process.env.JOB_HEARTBEAT_TIMEOUT_MINUTES || '5'),
  reaperIntervalMs: parseInt(process.env.JOB_REAPER_INTERVAL_MS || '60000'), // 1 minute
  maxAttempts: parseInt(process.env.JOB_MAX_ATTEMPTS || '3'),
};

let reaperInterval = null;
let isReaping = false;

/**
 * Find all stalled jobs that need to be reaped
 * A job is considered stalled if:
 * 1. Status is 'processing' AND heartbeat_at is older than timeout threshold
 * 2. Status is 'processing' AND timeout_at has passed (hard timeout)
 * 
 * @returns {Promise<Array>} Array of stalled jobs
 */
export async function findStalledJobs() {
  try {
    const [stalledJobs] = await pool.query(`
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
        started_at,
        heartbeat_at,
        timeout_at,
        attempts,
        max_attempts,
        TIMESTAMPDIFF(MINUTE, heartbeat_at, NOW()) as minutes_since_heartbeat,
        CASE 
          WHEN timeout_at < NOW() THEN 'max_duration'
          WHEN heartbeat_at < DATE_SUB(NOW(), INTERVAL ? MINUTE) THEN 'heartbeat_timeout'
          ELSE 'unknown'
        END as detected_reason
      FROM processing_jobs
      WHERE status = 'processing'
        AND (
          heartbeat_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)
          OR timeout_at < NOW()
        )
      ORDER BY heartbeat_at ASC
    `, [CONFIG.heartbeatTimeoutMinutes, CONFIG.heartbeatTimeoutMinutes]);
    
    return stalledJobs;
  } catch (error) {
    logger.error('Error finding stalled jobs', error);
    return [];
  }
}

/**
 * Mark a job as failed due to timeout
 * 
 * @param {Object} job - The stalled job
 * @param {string} reason - Timeout reason ('heartbeat_timeout' or 'max_duration')
 * @returns {Promise<boolean>}
 */
async function markJobAsFailed(job, reason) {
  try {
    const errorMessage = reason === 'heartbeat_timeout' 
      ? `ジョブがタイムアウトしました（ハートビート応答なし: ${job.minutes_since_heartbeat}分）`
      : `ジョブがタイムアウトしました（最大実行時間超過）`;
    
    await pool.query(`
      UPDATE processing_jobs 
      SET status = 'failed',
          timeout_reason = ?,
          error_message = ?,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = ?
    `, [reason, errorMessage, job.id]);
    
    logger.warn('Job marked as failed due to timeout', {
      jobId: job.id,
      reason,
      minutesSinceHeartbeat: job.minutes_since_heartbeat,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
    });
    
    return true;
  } catch (error) {
    logger.error('Error marking job as failed', { jobId: job.id, error: error.message });
    return false;
  }
}

/**
 * Re-queue a failed job for retry
 * Uses atomic UPDATE with status check to prevent race conditions
 * 
 * @param {Object} job - The job to re-queue
 * @returns {Promise<boolean>}
 */
async function requeueJob(job) {
  try {
    // Atomic UPDATE with status check - only requeue if job is in 'failed' status
    // This prevents race conditions where another process might have already requeued the job
    const [result] = await pool.query(`
      UPDATE processing_jobs 
      SET status = 'pending',
          progress = 0,
          current_step = 'リトライ待機中（タイムアウトから復旧）',
          timeout_reason = 'none',
          started_at = NULL,
          heartbeat_at = NULL,
          timeout_at = NULL,
          updated_at = NOW()
      WHERE id = ? AND status = 'failed'
    `, [job.id]);
    
    // If no rows affected, job status has changed (another process handled it)
    if (result.affectedRows === 0) {
      logger.warn('Job requeue skipped - status may have changed', {
        jobId: job.id,
        expectedStatus: 'failed',
      });
      return false;
    }
    
    // Reset chunk statuses
    await pool.query(`
      UPDATE chunk_processing 
      SET status = 'pending', 
          error_message = NULL,
          updated_at = NOW()
      WHERE job_id = ?
    `, [job.id]);
    
    // Add to BullMQ queue
    await addAudioProcessingJob({
      jobId: job.id,
      audioFilePath: job.local_file_path,
      fileId: job.file_id,
      userId: job.user_id,
      companyId: job.company_id,
      staffId: job.staff_id,
    });
    
    logger.info('Stalled job re-queued for retry', {
      jobId: job.id,
      attempt: job.attempts,
      maxAttempts: job.max_attempts,
    });
    
    return true;
  } catch (error) {
    logger.error('Error re-queuing job', { jobId: job.id, error: error.message });
    return false;
  }
}

/**
 * Process a single stalled job
 * 
 * @param {Object} job - The stalled job
 * @returns {Promise<{action: string, success: boolean}>}
 */
async function processStallledJob(job) {
  const reason = job.detected_reason;
  const canRetry = job.attempts < job.max_attempts;
  
  // First, mark the job as failed
  const marked = await markJobAsFailed(job, reason);
  if (!marked) {
    return { action: 'mark_failed', success: false };
  }
  
  // If can retry, re-queue the job
  if (canRetry) {
    const requeued = await requeueJob(job);
    return { action: 'requeued', success: requeued };
  }
  
  // Final failure - no more retries
  logger.error('Job permanently failed after max attempts', {
    jobId: job.id,
    attempts: job.attempts,
    maxAttempts: job.max_attempts,
    reason,
  });
  
  return { action: 'final_failure', success: true };
}

/**
 * Run the reaper once - find and process all stalled jobs
 * 
 * @returns {Promise<{processed: number, requeued: number, failed: number}>}
 */
export async function runReaper() {
  // Prevent concurrent reaper runs
  if (isReaping) {
    logger.debug('Reaper already running, skipping');
    return { processed: 0, requeued: 0, failed: 0 };
  }
  
  isReaping = true;
  const stats = { processed: 0, requeued: 0, failed: 0 };
  
  try {
    const stalledJobs = await findStalledJobs();
    
    if (stalledJobs.length === 0) {
      logger.debug('Reaper: No stalled jobs found');
      return stats;
    }
    
    logger.info('Reaper: Found stalled jobs', { count: stalledJobs.length });
    
    for (const job of stalledJobs) {
      const result = await processStallledJob(job);
      stats.processed++;
      
      if (result.action === 'requeued' && result.success) {
        stats.requeued++;
      } else if (result.action === 'final_failure') {
        stats.failed++;
      }
    }
    
    logger.info('Reaper completed', stats);
    return stats;
  } catch (error) {
    logger.error('Error running reaper', error);
    return stats;
  } finally {
    isReaping = false;
  }
}

/**
 * Start the reaper interval timer
 * 
 * @returns {NodeJS.Timeout}
 */
export function startReaper() {
  if (reaperInterval) {
    logger.warn('Reaper already started');
    return reaperInterval;
  }
  
  logger.info('Starting job reaper', { 
    intervalMs: CONFIG.reaperIntervalMs,
    heartbeatTimeoutMinutes: CONFIG.heartbeatTimeoutMinutes,
  });
  
  // Run immediately on start
  runReaper().catch(err => logger.error('Initial reaper run failed', err));
  
  // Then run periodically
  reaperInterval = setInterval(() => {
    runReaper().catch(err => logger.error('Reaper interval run failed', err));
  }, CONFIG.reaperIntervalMs);
  
  return reaperInterval;
}

/**
 * Stop the reaper interval timer
 */
export function stopReaper() {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = null;
    logger.info('Job reaper stopped');
  }
}

/**
 * Check if reaper is running
 * 
 * @returns {boolean}
 */
export function isReaperRunning() {
  return reaperInterval !== null;
}

// Export configuration for reference
export const REAPER_CONFIG = CONFIG;

export default {
  findStalledJobs,
  runReaper,
  startReaper,
  stopReaper,
  isReaperRunning,
  REAPER_CONFIG,
};
