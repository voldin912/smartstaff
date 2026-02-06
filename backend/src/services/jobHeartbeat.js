import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

/**
 * Job Heartbeat Service
 * 
 * Provides heartbeat monitoring for long-running jobs to detect
 * stalled or hung processes. Ensures jobs don't get stuck in
 * 'processing' status indefinitely.
 */

// Configuration from environment variables
const CONFIG = {
  heartbeatIntervalMs: parseInt(process.env.JOB_HEARTBEAT_INTERVAL_MS || '30000'), // 30 seconds
  heartbeatTimeoutMinutes: parseInt(process.env.JOB_HEARTBEAT_TIMEOUT_MINUTES || '5'), // 5 minutes
  maxDurationMinutes: parseInt(process.env.JOB_MAX_DURATION_MINUTES || '30'), // 30 minutes
  maxAttempts: parseInt(process.env.JOB_MAX_ATTEMPTS || '3'), // 3 attempts
};

// Store active heartbeat intervals by jobId
const activeHeartbeats = new Map();

/**
 * Acquire exclusive lock on a job using atomic conditional UPDATE
 * Only succeeds if job is in an allowed state (pending or failed)
 * This prevents duplicate execution by multiple workers
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<{acquired: boolean, attempts: number, reason?: string}>}
 */
export async function acquireJobLock(jobId) {
  try {
    const timeoutMinutes = CONFIG.maxDurationMinutes;
    
    // Atomic UPDATE with status check - only one worker can succeed
    const [result] = await pool.query(
      `UPDATE processing_jobs 
       SET status = 'processing',
           started_at = NOW(), 
           heartbeat_at = NOW(), 
           timeout_at = DATE_ADD(NOW(), INTERVAL ? MINUTE),
           attempts = attempts + 1,
           timeout_reason = 'none',
           updated_at = NOW()
       WHERE id = ? 
         AND status IN ('pending', 'failed')`,
      [timeoutMinutes, jobId]
    );
    
    // If affectedRows is 0, someone else grabbed the job or it's in wrong state
    if (result.affectedRows === 0) {
      // Check why we couldn't acquire the lock
      const [rows] = await pool.query(
        'SELECT status, attempts FROM processing_jobs WHERE id = ?',
        [jobId]
      );
      
      if (rows.length === 0) {
        logger.error('Job not found for acquireJobLock', { jobId });
        return { acquired: false, attempts: 0, reason: 'job_not_found' };
      }
      
      const currentStatus = rows[0].status;
      logger.warn('Failed to acquire job lock', { 
        jobId, 
        currentStatus,
        reason: currentStatus === 'processing' ? 'already_processing' : 'invalid_status'
      });
      
      return { 
        acquired: false, 
        attempts: rows[0].attempts || 0, 
        reason: currentStatus === 'processing' ? 'already_processing' : 'invalid_status'
      };
    }
    
    // Successfully acquired lock - get the updated attempts count
    const [rows] = await pool.query(
      'SELECT attempts, max_attempts FROM processing_jobs WHERE id = ?',
      [jobId]
    );
    
    const attempts = rows[0]?.attempts || 1;
    const maxAttempts = rows[0]?.max_attempts || CONFIG.maxAttempts;
    
    logger.info('Job lock acquired', { 
      jobId, 
      attempts, 
      maxAttempts,
      timeoutMinutes 
    });
    
    return { acquired: true, attempts };
  } catch (error) {
    logger.error('Error acquiring job lock', { jobId, error: error.message });
    return { acquired: false, attempts: 0, reason: 'error' };
  }
}

/**
 * @deprecated Use acquireJobLock() instead for atomic lock acquisition
 * Start a job - sets started_at, heartbeat_at, calculates timeout_at, increments attempts
 * Call this at the beginning of job processing
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<{success: boolean, attempts: number}>}
 */
export async function startJob(jobId) {
  // Delegate to acquireJobLock for backwards compatibility
  const result = await acquireJobLock(jobId);
  return { success: result.acquired, attempts: result.attempts };
}

/**
 * Update heartbeat timestamp for a job
 * Call this periodically during job processing
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<boolean>}
 */
export async function updateHeartbeat(jobId) {
  try {
    await pool.query(
      'UPDATE processing_jobs SET heartbeat_at = NOW(), updated_at = NOW() WHERE id = ?',
      [jobId]
    );
    
    logger.debug('Heartbeat updated', { jobId });
    return true;
  } catch (error) {
    logger.error('Error updating heartbeat', { jobId, error: error.message });
    return false;
  }
}

/**
 * End a job - clears timeout fields and sets final status
 * Call this when job completes or fails
 * 
 * @param {number} jobId - The job ID
 * @param {string} status - Final status ('completed' or 'failed')
 * @param {string} timeoutReason - Reason for timeout if applicable ('none', 'heartbeat_timeout', 'max_duration', 'manual')
 * @param {string} errorMessage - Error message if failed
 * @returns {Promise<boolean>}
 */
export async function endJob(jobId, status, timeoutReason = 'none', errorMessage = null) {
  try {
    // Stop any active heartbeat interval for this job
    stopHeartbeatInterval(jobId);
    
    const updates = [
      'status = ?',
      'timeout_reason = ?',
      'completed_at = NOW()',
      'updated_at = NOW()'
    ];
    const params = [status, timeoutReason];
    
    if (errorMessage) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    
    params.push(jobId);
    
    await pool.query(
      `UPDATE processing_jobs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    logger.info('Job ended', { jobId, status, timeoutReason });
    return true;
  } catch (error) {
    logger.error('Error ending job', { jobId, error: error.message });
    return false;
  }
}

/**
 * Start automatic heartbeat interval for a job
 * Useful for long-running operations where manual heartbeat calls are impractical
 * 
 * @param {number} jobId - The job ID
 * @returns {NodeJS.Timeout} The interval ID
 */
export function startHeartbeatInterval(jobId) {
  // Clear any existing interval for this job
  stopHeartbeatInterval(jobId);
  
  const intervalId = setInterval(async () => {
    const success = await updateHeartbeat(jobId);
    if (!success) {
      logger.warn('Failed to update heartbeat, stopping interval', { jobId });
      stopHeartbeatInterval(jobId);
    }
  }, CONFIG.heartbeatIntervalMs);
  
  activeHeartbeats.set(jobId, intervalId);
  logger.debug('Started heartbeat interval', { jobId, intervalMs: CONFIG.heartbeatIntervalMs });
  
  return intervalId;
}

/**
 * Stop the automatic heartbeat interval for a job
 * 
 * @param {number} jobId - The job ID
 */
export function stopHeartbeatInterval(jobId) {
  const intervalId = activeHeartbeats.get(jobId);
  if (intervalId) {
    clearInterval(intervalId);
    activeHeartbeats.delete(jobId);
    logger.debug('Stopped heartbeat interval', { jobId });
  }
}

/**
 * Stop all active heartbeat intervals
 * Call this during graceful shutdown
 */
export function stopAllHeartbeats() {
  for (const [jobId, intervalId] of activeHeartbeats) {
    clearInterval(intervalId);
    logger.debug('Stopped heartbeat interval during shutdown', { jobId });
  }
  activeHeartbeats.clear();
  logger.info('All heartbeat intervals stopped');
}

/**
 * Get job heartbeat status
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<Object|null>}
 */
export async function getJobHeartbeatStatus(jobId) {
  try {
    const [rows] = await pool.query(
      `SELECT 
        id, status, started_at, heartbeat_at, timeout_at, 
        attempts, max_attempts, timeout_reason,
        TIMESTAMPDIFF(SECOND, heartbeat_at, NOW()) as seconds_since_heartbeat,
        TIMESTAMPDIFF(SECOND, NOW(), timeout_at) as seconds_until_timeout
       FROM processing_jobs 
       WHERE id = ?`,
      [jobId]
    );
    
    return rows.length > 0 ? rows[0] : null;
  } catch (error) {
    logger.error('Error getting job heartbeat status', { jobId, error: error.message });
    return null;
  }
}

/**
 * Check if a job can be retried based on attempts
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<boolean>}
 */
export async function canRetryJob(jobId) {
  try {
    const [rows] = await pool.query(
      'SELECT attempts, max_attempts FROM processing_jobs WHERE id = ?',
      [jobId]
    );
    
    if (rows.length === 0) return false;
    
    return rows[0].attempts < rows[0].max_attempts;
  } catch (error) {
    logger.error('Error checking if job can retry', { jobId, error: error.message });
    return false;
  }
}

// Export configuration for reference
export const HEARTBEAT_CONFIG = CONFIG;

export default {
  acquireJobLock,
  startJob,
  updateHeartbeat,
  endJob,
  startHeartbeatInterval,
  stopHeartbeatInterval,
  stopAllHeartbeats,
  getJobHeartbeatStatus,
  canRetryJob,
  HEARTBEAT_CONFIG,
};
