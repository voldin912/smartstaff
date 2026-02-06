/**
 * Record Persister Module
 * 
 * Handles saving processing results to the records table.
 * Part of the modular audio processing pipeline.
 */

import { pool } from '../../config/database.js';
import logger from '../../utils/logger.js';
import cache from '../../utils/cache.js';

/**
 * Save record to database with idempotency (ON DUPLICATE KEY UPDATE)
 * 
 * @param {number} jobId - Job ID (used as unique key)
 * @param {object} data - Record data
 * @param {string} data.fileId - File ID
 * @param {number} data.userId - User ID
 * @param {number} data.companyId - Company ID
 * @param {string} data.staffId - Staff ID
 * @param {string} data.audioFilePath - Path to audio file
 * @param {string} data.sttText - Combined STT text
 * @param {string} data.skillsheet - Skill sheet content
 * @param {string} data.lor - LOR content
 * @param {Array} data.workContent - Work content array
 * @param {string} data.skills - Skills content
 * @param {string} data.hope - Hope content
 * @param {string} data.qualityStatus - Quality status ('complete' or 'partial')
 * @param {number} data.successRate - Success rate (0-1)
 * @param {Array} data.warnings - Processing warnings array
 * @returns {Promise<{recordId: number, isNew: boolean}>}
 */
export async function saveRecord(jobId, data) {
  const {
    fileId,
    userId,
    companyId,
    staffId,
    audioFilePath,
    sttText,
    skillsheet,
    lor,
    workContent,
    skills,
    hope,
    qualityStatus,
    successRate,
    warnings
  } = data;
  
  const successRatePercent = parseFloat((successRate * 100).toFixed(2));
  const warningsJson = JSON.stringify(warnings || []);
  const workContentJson = JSON.stringify(workContent || []);
  
  logger.info('Saving record to database', { 
    jobId,
    qualityStatus,
    successRatePercent
  });
  
  try {
    const [result] = await pool.query(
      `INSERT INTO records 
       (job_id, file_id, user_id, company_id, staff_id, audio_file_path, stt, skill_sheet, lor, salesforce, skills, hope, quality_status, chunk_success_rate, processing_warnings, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE 
         updated_at = NOW(),
         stt = VALUES(stt),
         skill_sheet = VALUES(skill_sheet),
         lor = VALUES(lor),
         salesforce = VALUES(salesforce),
         skills = VALUES(skills),
         hope = VALUES(hope),
         quality_status = VALUES(quality_status),
         chunk_success_rate = VALUES(chunk_success_rate),
         processing_warnings = VALUES(processing_warnings),
         id = LAST_INSERT_ID(id)`,
      [
        jobId,
        fileId,
        userId,
        companyId,
        staffId,
        audioFilePath,
        sttText,
        skillsheet,
        lor,
        workContentJson,
        skills,
        hope,
        qualityStatus,
        successRatePercent,
        warningsJson
      ]
    );
    
    const recordId = result.insertId;
    const isNew = result.affectedRows === 1;
    
    logger.info('Record saved', { 
      jobId, 
      recordId, 
      isNew,
      affectedRows: result.affectedRows
    });
    
    return { recordId, isNew };
    
  } catch (error) {
    logger.error('Failed to save record', { jobId, error: error.message });
    throw error;
  }
}

/**
 * Update processing_jobs with the record_id for reference
 * 
 * @param {number} jobId - Job ID
 * @param {number} recordId - Record ID
 * @returns {Promise<boolean>}
 */
export async function updateJobRecord(jobId, recordId) {
  try {
    await pool.query(
      'UPDATE processing_jobs SET record_id = ? WHERE id = ?',
      [recordId, jobId]
    );
    
    logger.debug('Job record reference updated', { jobId, recordId });
    return true;
    
  } catch (error) {
    logger.error('Failed to update job record reference', { jobId, recordId, error: error.message });
    return false;
  }
}

/**
 * Invalidate cache after saving record
 * 
 * @param {number} jobId - Job ID for logging
 * @param {number} companyId - Company ID for cache invalidation
 */
export function invalidateCache(jobId, companyId) {
  if (companyId) {
    try {
      cache.invalidatePattern(`records:company:${companyId}:*`);
      cache.invalidatePattern(`dashboard:stats:company:${companyId}`);
      logger.debug('Cache invalidated', { jobId, companyId });
    } catch (error) {
      logger.warn('Failed to invalidate cache', { jobId, companyId, error: error.message });
      // Non-fatal - continue
    }
  }
}

/**
 * Get record by job ID
 * 
 * @param {number} jobId - Job ID
 * @returns {Promise<object|null>}
 */
export async function getRecordByJobId(jobId) {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM records WHERE job_id = ?',
      [jobId]
    );
    
    return rows.length > 0 ? rows[0] : null;
    
  } catch (error) {
    logger.error('Failed to get record by job ID', { jobId, error: error.message });
    return null;
  }
}

/**
 * Complete the persist step - saves record, updates job reference, invalidates cache
 * 
 * @param {number} jobId - Job ID
 * @param {object} data - Record data (same as saveRecord)
 * @returns {Promise<{recordId: number, success: boolean}>}
 */
export async function completeRecordPersistence(jobId, data) {
  try {
    // Save record
    const { recordId } = await saveRecord(jobId, data);
    
    // Update job with record reference
    await updateJobRecord(jobId, recordId);
    
    // Invalidate cache
    invalidateCache(jobId, data.companyId);
    
    return { recordId, success: true };
    
  } catch (error) {
    logger.error('Record persistence failed', { jobId, error: error.message });
    return { recordId: null, success: false, error: error.message };
  }
}

export default {
  saveRecord,
  updateJobRecord,
  invalidateCache,
  getRecordByJobId,
  completeRecordPersistence,
};
