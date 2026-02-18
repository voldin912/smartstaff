/**
 * Follow Record Persister Module
 * 
 * Handles saving follow processing results to the follows table.
 * Part of the follow audio processing pipeline.
 */

import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';
import cache from '../../utils/cache.js';

/**
 * Save follow record to database with idempotency (ON DUPLICATE KEY UPDATE on job_id)
 * 
 * @param {number} jobId - Job ID (used as unique key)
 * @param {object} data - Follow record data
 * @param {string} data.fileId - File ID
 * @param {number} data.userId - User ID
 * @param {number} data.companyId - Company ID
 * @param {string} data.staffId - Staff ID
 * @param {string} data.sttText - Combined STT text
 * @param {string} data.summary - Follow summary text
 * @returns {Promise<{recordId: number, isNew: boolean}>}
 */
export async function saveFollowRecord(jobId, data) {
  const {
    fileId,
    userId,
    companyId,
    staffId,
    sttText,
    summary,
  } = data;

  logger.info('Saving follow record to database', { jobId });

  try {
    const [result] = await pool.query(
      `INSERT INTO follows 
       (job_id, file_id, user_id, company_id, staff_id, follow_date, audio_file_path, stt, summary, date)
       VALUES (?, ?, ?, ?, ?, CURDATE(), ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         updated_at = NOW(),
         stt = VALUES(stt),
         summary = VALUES(summary),
         id = LAST_INSERT_ID(id)`,
      [
        jobId,
        fileId,
        userId,
        companyId,
        staffId,
        null,
        sttText,
        summary,
      ]
    );

    const recordId = result.insertId;
    const isNew = result.affectedRows === 1;

    logger.info('Follow record saved', {
      jobId,
      recordId,
      isNew,
      affectedRows: result.affectedRows,
    });

    return { recordId, isNew };

  } catch (error) {
    logger.error('Failed to save follow record', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Update processing_jobs with the record_id for reference
 * 
 * @param {number} jobId - Job ID
 * @param {number} recordId - Follow record ID
 * @returns {Promise<boolean>}
 */
export async function updateJobRecord(jobId, recordId) {
  try {
    await pool.query(
      'UPDATE processing_jobs SET record_id = ? WHERE id = ?',
      [recordId, jobId]
    );

    logger.debug('Follow job record reference updated', { jobId, recordId });
    return true;

  } catch (error) {
    logger.error('Failed to update follow job record reference', { jobId, recordId, error: error.message });
    return false;
  }
}

/**
 * Invalidate cache after saving follow record
 * 
 * @param {number} jobId - Job ID for logging
 * @param {number} companyId - Company ID for cache invalidation
 */
export function invalidateCache(jobId, companyId) {
  if (companyId) {
    try {
      cache.invalidatePattern(`follows:company:${companyId}:*`);
      logger.debug('Follow cache invalidated', { jobId, companyId });
    } catch (error) {
      logger.warn('Failed to invalidate follow cache', { jobId, companyId, error: error.message });
      // Non-fatal - continue
    }
  }
}

/**
 * Get follow record by job ID
 * 
 * @param {number} jobId - Job ID
 * @returns {Promise<object|null>}
 */
export async function getFollowRecordByJobId(jobId) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM follows WHERE job_id = ?',
      [jobId]
    );

    return rows.length > 0 ? rows[0] : null;

  } catch (error) {
    logger.error('Failed to get follow record by job ID', { jobId, error: error.message });
    return null;
  }
}

/**
 * Complete the persist step - saves follow record, updates job reference, invalidates cache
 * 
 * @param {number} jobId - Job ID
 * @param {object} data - Follow record data (same as saveFollowRecord)
 * @returns {Promise<{recordId: number, success: boolean}>}
 */
export async function completeFollowPersistence(jobId, data) {
  try {
    // Save follow record
    const { recordId } = await saveFollowRecord(jobId, data);

    // Update job with record reference
    await updateJobRecord(jobId, recordId);

    // Invalidate cache
    invalidateCache(jobId, data.companyId);

    return { recordId, success: true };

  } catch (error) {
    logger.error('Follow record persistence failed', { jobId, error: error.message });
    return { recordId: null, success: false, error: error.message };
  }
}

export default {
  saveFollowRecord,
  updateJobRecord,
  invalidateCache,
  getFollowRecordByJobId,
  completeFollowPersistence,
};
