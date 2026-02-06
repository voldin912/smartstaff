/**
 * Async Processing Service
 * 
 * Manages job and chunk lifecycle for audio processing.
 * Delegates actual processing to the audioProcessing orchestrator.
 */

import { pool } from '../config/database.js';
import logger from '../utils/logger.js';
import { addAudioProcessingJob } from '../queues/audioQueue.js';

// Import the orchestrator for processing
import { processAudioJob as orchestratorProcessAudioJob } from './audioProcessing/orchestrator.js';

// ============================================
// Job Management Functions
// ============================================

/**
 * Create a new processing job
 */
export async function createProcessingJob(fileId, userId, companyId, staffId, localFilePath) {
  try {
    const [result] = await pool.query(
      `INSERT INTO processing_jobs 
       (file_id, user_id, company_id, staff_id, local_file_path, status, current_step) 
       VALUES (?, ?, ?, ?, ?, 'pending', 'ジョブ作成完了')`,
      [fileId, userId, companyId, staffId, localFilePath]
    );
    
    logger.info('Processing job created', { jobId: result.insertId, fileId, userId });
    return result.insertId;
  } catch (error) {
    logger.error('Error creating processing job', { error: error.message });
    throw error;
  }
}

/**
 * Update job status and progress
 */
export async function updateJobStatus(jobId, status, progress = null, currentStep = null, errorMessage = null) {
  try {
    const updates = ['status = ?', 'updated_at = NOW()'];
    const params = [status];
    
    if (progress !== null) {
      updates.push('progress = ?');
      params.push(progress);
    }
    
    if (currentStep !== null) {
      updates.push('current_step = ?');
      params.push(currentStep);
    }
    
    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    
    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = NOW()');
    }
    
    params.push(jobId);
    
    await pool.query(
      `UPDATE processing_jobs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    logger.debug('Job status updated', { jobId, status, progress, currentStep });
  } catch (error) {
    logger.error('Error updating job status', { jobId, error: error.message });
  }
}

/**
 * Update job chunk counts
 */
export async function updateJobChunkCounts(jobId, totalChunks = null, completedChunks = null) {
  try {
    const updates = ['updated_at = NOW()'];
    const params = [];
    
    if (totalChunks !== null) {
      updates.push('total_chunks = ?');
      params.push(totalChunks);
    }
    
    if (completedChunks !== null) {
      updates.push('completed_chunks = ?');
      params.push(completedChunks);
    }
    
    params.push(jobId);
    
    await pool.query(
      `UPDATE processing_jobs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  } catch (error) {
    logger.error('Error updating chunk counts', { jobId, error: error.message });
  }
}

/**
 * Get job status by ID
 */
export async function getJobStatus(jobId, userId, role) {
  try {
    let query = `
      SELECT 
        pj.*,
        pj.local_file_path as localFilePath,
        pj.file_id as fileId,
        pj.user_id as userId,
        pj.company_id as companyId,
        pj.staff_id as staffId,
        u.name as userName,
        c.name as companyName
      FROM processing_jobs pj
      LEFT JOIN users u ON pj.user_id = u.id
      LEFT JOIN companies c ON pj.company_id = c.id
      WHERE pj.id = ?
    `;
    const params = [jobId];
    
    // Role-based access control
    if (role !== 'admin') {
      query += ' AND pj.user_id = ?';
      params.push(userId);
    }
    
    const [rows] = await pool.query(query, params);
    
    if (rows.length === 0) {
      return null;
    }
    
    return rows[0];
  } catch (error) {
    logger.error('Error getting job status', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Get all jobs for a user/company with pagination
 */
export async function getUserJobs(userId, companyId, role, status = null, limit = 20) {
  try {
    let query = `
      SELECT 
        pj.*,
        u.name as userName,
        c.name as companyName
      FROM processing_jobs pj
      LEFT JOIN users u ON pj.user_id = u.id
      LEFT JOIN companies c ON pj.company_id = c.id
      WHERE 1=1
    `;
    const params = [];
    
    // Role-based filtering
    if (role === 'admin') {
      // Admin sees all jobs
    } else if (role === 'company_admin' && companyId) {
      query += ' AND pj.company_id = ?';
      params.push(companyId);
    } else {
      query += ' AND pj.user_id = ?';
      params.push(userId);
    }
    
    // Status filter
    if (status) {
      query += ' AND pj.status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY pj.created_at DESC LIMIT ?';
    params.push(limit);
    
    const [rows] = await pool.query(query, params);
    return rows;
  } catch (error) {
    logger.error('Error getting user jobs', { userId, error: error.message });
    throw error;
  }
}

// ============================================
// Chunk Management Functions
// ============================================

/**
 * Register chunks for a job
 */
export async function registerChunks(jobId, chunkCount) {
  try {
    const values = [];
    for (let i = 0; i < chunkCount; i++) {
      values.push([jobId, i, 'pending']);
    }
    
    await pool.query(
      'INSERT INTO chunk_processing (job_id, chunk_index, status) VALUES ?',
      [values]
    );
    
    await updateJobChunkCounts(jobId, chunkCount, 0);
    
    logger.debug('Chunks registered', { jobId, chunkCount });
  } catch (error) {
    logger.error('Error registering chunks', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Update chunk status
 */
export async function updateChunkStatus(jobId, chunkIndex, status, sttResult = null, errorMessage = null) {
  try {
    const updates = ['status = ?', 'updated_at = NOW()'];
    const params = [status];
    
    if (sttResult !== null) {
      updates.push('stt_result = ?');
      params.push(sttResult);
    }
    
    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    
    if (status === 'failed') {
      updates.push('retry_count = retry_count + 1');
    }
    
    params.push(jobId, chunkIndex);
    
    await pool.query(
      `UPDATE chunk_processing SET ${updates.join(', ')} WHERE job_id = ? AND chunk_index = ?`,
      params
    );
    
    // Update completed chunks count if completed
    if (status === 'completed') {
      await pool.query(
        'UPDATE processing_jobs SET completed_chunks = completed_chunks + 1, updated_at = NOW() WHERE id = ?',
        [jobId]
      );
    }
  } catch (error) {
    logger.error('Error updating chunk status', { jobId, chunkIndex, error: error.message });
  }
}

/**
 * Get failed chunks for retry
 */
export async function getFailedChunks(jobId) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM chunk_processing WHERE job_id = ? AND status = ?',
      [jobId, 'failed']
    );
    return rows;
  } catch (error) {
    logger.error('Error getting failed chunks', { jobId, error: error.message });
    return [];
  }
}

/**
 * Get chunk status for a job
 */
export async function getChunkStatus(jobId) {
  try {
    const [rows] = await pool.query(
      'SELECT chunk_index, status, error_message FROM chunk_processing WHERE job_id = ? ORDER BY chunk_index',
      [jobId]
    );
    return rows;
  } catch (error) {
    logger.error('Error getting chunk status', { jobId, error: error.message });
    return [];
  }
}

// ============================================
// Main Processing Function
// ============================================

/**
 * Main async processing function for audio job
 * Delegates to the orchestrator for modular step execution
 * 
 * @param {number} jobId - Job ID
 * @param {string} audioFilePath - Path to audio file
 * @param {string} fileId - File ID
 * @param {number} userId - User ID
 * @param {number} companyId - Company ID
 * @param {string} staffId - Staff ID
 * @returns {Promise<{success: boolean, recordId?: number, error?: string}>}
 */
export async function processAudioJob(jobId, audioFilePath, fileId, userId, companyId, staffId) {
  logger.info('Starting audio processing job', { jobId, audioFilePath });
  
  try {
    // Delegate to orchestrator with required callbacks
    const result = await orchestratorProcessAudioJob(
      jobId,
      audioFilePath,
      fileId,
      userId,
      companyId,
      staffId,
      updateJobStatus,
      registerChunks,
      updateChunkStatus
    );
    
    if (!result.success) {
      logger.error('Audio processing failed', { jobId, error: result.error });
      throw new Error(result.error || 'Processing failed');
    }
    
    logger.info('Audio processing completed', { 
      jobId, 
      recordId: result.recordId,
      qualityStatus: result.qualityStatus
    });
    
    return result;
    
  } catch (error) {
    logger.error('Error in processAudioJob', { jobId, error: error.message });
    throw error;
  }
}

// ============================================
// Job Retry and Cleanup
// ============================================

/**
 * Retry a failed job
 * Uses atomic UPDATE to prevent race conditions
 */
export async function retryFailedJob(jobId, userId, companyId, role) {
  try {
    // Get job details for queue data (access check)
    const job = await getJobStatus(jobId, userId, role);
    
    if (!job) {
      const error = new Error('Job not found or access denied');
      error.statusCode = 404;
      throw error;
    }
    
    // Atomic UPDATE with status check - only allow retry if job is in 'failed' status
    const [result] = await pool.query(
      `UPDATE processing_jobs 
       SET status = 'pending', 
           progress = 0, 
           current_step = 'リトライ準備中', 
           error_message = NULL, 
           completed_at = NULL,
           started_at = NULL,
           heartbeat_at = NULL,
           timeout_at = NULL,
           timeout_reason = 'none',
           updated_at = NOW()
       WHERE id = ? AND status = 'failed'`,
      [jobId]
    );
    
    // If no rows affected, job is not in retryable state
    if (result.affectedRows === 0) {
      const error = new Error(`Job cannot be retried: current status is '${job.status}', expected 'failed'`);
      error.statusCode = 409; // Conflict
      throw error;
    }
    
    // Reset chunk statuses
    await pool.query(
      'UPDATE chunk_processing SET status = \'pending\', retry_count = 0, error_message = NULL WHERE job_id = ?',
      [jobId]
    );
    
    // Add job to persistent queue for retry
    await addAudioProcessingJob({
      jobId,
      audioFilePath: job.localFilePath,
      fileId: job.fileId,
      userId: job.userId,
      companyId: job.companyId,
      staffId: job.staffId,
    });
    
    logger.info('Job retry queued', { jobId, previousStatus: job.status });
    
    return { success: true, message: 'Job retry queued' };
  } catch (error) {
    logger.error('Error retrying failed job', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Clean up old completed/failed jobs
 */
export async function cleanupOldJobs(daysToKeep = 7) {
  try {
    const [result] = await pool.query(
      `DELETE FROM processing_jobs 
       WHERE status IN ('completed', 'failed') 
       AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [daysToKeep]
    );
    
    logger.info('Old jobs cleaned up', { deletedCount: result.affectedRows });
    return result.affectedRows;
  } catch (error) {
    logger.error('Error cleaning up old jobs', { error: error.message });
    return 0;
  }
}

// ============================================
// Exports
// ============================================

export default {
  // Job management
  createProcessingJob,
  updateJobStatus,
  updateJobChunkCounts,
  getJobStatus,
  getUserJobs,
  
  // Chunk management
  registerChunks,
  updateChunkStatus,
  getFailedChunks,
  getChunkStatus,
  
  // Processing
  processAudioJob,
  
  // Retry and cleanup
  retryFailedJob,
  cleanupOldJobs,
};
