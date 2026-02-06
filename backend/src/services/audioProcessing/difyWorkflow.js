/**
 * Dify Workflow Module
 * 
 * Handles the main Dify AI workflow execution (skill sheet, lor, salesforce).
 * Part of the modular audio processing pipeline.
 */

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';
import {
  API_CONFIG,
  ERROR_CODES,
  isRetryableStatus,
  categorizeError,
  calculateBackoff,
  sleep,
} from '../../config/axiosConfig.js';

// Configuration
const CONFIG = {
  maxRetries: API_CONFIG.dify.maxRetries,
  uploadTimeout: API_CONFIG.dify.uploadTimeout,
  workflowTimeout: API_CONFIG.dify.workflowTimeout,
  uploadDir: 'uploads/audio',
};

/**
 * Execute main Dify workflow (skill sheet, lor, salesforce)
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} combinedText - Combined STT text from all chunks
 * @returns {Promise<{outputs: object}>} Dify workflow outputs
 * @throws {Error} With standardized error code
 */
export async function executeMainWorkflow(jobId, combinedText) {
  // Ensure upload directory exists
  if (!fs.existsSync(CONFIG.uploadDir)) {
    fs.mkdirSync(CONFIG.uploadDir, { recursive: true });
  }
  
  // Save combined text to temp file
  const tempFilePath = path.join(CONFIG.uploadDir, `temp_${jobId}_${Date.now()}.csv`);
  fs.writeFileSync(tempFilePath, combinedText);
  
  logger.info('Starting main Dify workflow', { jobId, textLength: combinedText.length });
  
  try {
    // Upload text file to Dify with retry
    const txtFileId = await uploadTextFile(jobId, tempFilePath);
    
    // Call main workflow with retry
    const result = await runWorkflow(jobId, txtFileId);
    
    logger.info('Main Dify workflow completed', { jobId });
    return result;
    
  } finally {
    // Clean up temp file
    cleanupTempFile(jobId, tempFilePath);
  }
}

/**
 * Upload text file to Dify with retry
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} filePath - Path to the text file
 * @returns {Promise<string>} Dify file ID
 */
async function uploadTextFile(jobId, filePath) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: 'text/csv',
      });
      form.append('type', 'document');
      form.append('purpose', 'workflow_input');
      form.append('user', 'voldin012');

      const response = await axios.post('https://api.dify.ai/v1/files/upload', form, {
        headers: {
          Authorization: `Bearer ${process.env.DIFY_SECRET_KEY}`,
          ...form.getHeaders()
        },
        timeout: CONFIG.uploadTimeout
      });
      
      logger.debug('Text file uploaded to Dify', { jobId, fileId: response.data.id });
      return response.data.id;
      
    } catch (error) {
      lastError = error;
      const errorCode = categorizeError(error, 'upload');
      const httpStatus = error.response?.status;
      
      logger.warn(`Dify text upload attempt ${attempt}/${CONFIG.maxRetries} failed`, {
        jobId,
        errorCode,
        httpStatus,
        message: error.message
      });
      
      // Check if we should retry
      const shouldRetry = attempt < CONFIG.maxRetries && 
        (isRetryableStatus(httpStatus) || !error.response);
      
      if (shouldRetry) {
        const delay = calculateBackoff(attempt);
        logger.debug(`Retrying text upload in ${delay}ms`, { jobId, attempt });
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  const errorCode = categorizeError(lastError, 'upload');
  const errorMessage = `${errorCode}: Text file upload failed - ${lastError.message}`;
  logger.error('Dify text upload failed after all retries', { jobId, errorCode });
  
  const error = new Error(errorMessage);
  error.code = errorCode;
  throw error;
}

/**
 * Run the main Dify workflow with retry
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} txtFileId - Dify file ID
 * @returns {Promise<{outputs: object}>} Workflow result
 */
async function runWorkflow(jobId, txtFileId) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.dify.ai/v1/workflows/run',
        {
          inputs: {
            "txtFile": {
              "transfer_method": "local_file",
              "upload_file_id": txtFileId,
              "type": "document"
            }
          },
          user: 'voldin012'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: CONFIG.workflowTimeout
        }
      );
      
      logger.debug('Main Dify workflow response received', { jobId });
      return response.data.data;
      
    } catch (error) {
      lastError = error;
      const errorCode = categorizeError(error, 'workflow');
      const httpStatus = error.response?.status;
      
      logger.warn(`Dify main workflow attempt ${attempt}/${CONFIG.maxRetries} failed`, {
        jobId,
        errorCode,
        httpStatus,
        message: error.message
      });
      
      // Check if we should retry
      const shouldRetry = attempt < CONFIG.maxRetries && 
        (isRetryableStatus(httpStatus) || !error.response);
      
      if (shouldRetry) {
        const delay = calculateBackoff(attempt);
        logger.debug(`Retrying main workflow in ${delay}ms`, { jobId, attempt });
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  const errorCode = categorizeError(lastError, 'workflow');
  const errorMessage = `${errorCode}: Main workflow failed - ${lastError.message}`;
  logger.error('Dify main workflow failed after all retries', { jobId, errorCode });
  
  const error = new Error(errorMessage);
  error.code = errorCode;
  throw error;
}

/**
 * Parse and validate Dify workflow outputs
 * 
 * @param {number} jobId - Job ID for logging
 * @param {object} difyResult - Raw Dify workflow result
 * @returns {{skillsheet: string, lor: string, workContent: Array, skills: string, hope: string}}
 */
export function parseOutputs(jobId, difyResult) {
  const outputs = difyResult.outputs || {};
  
  // Extract raw outputs
  const skillsheet = outputs.skillsheet || '';
  const lor = outputs.lor || '';
  const skills = outputs.skills || '';
  const hope = outputs.hope || '';
  
  // Parse work content (salesforce) from skillsheet
  // The career summaries are extracted from the parsed skillsheet data
  let workContent = [];
  try {
    if (skillsheet) {
      // Clean JSON code blocks if present
      const cleanSkillsheet = typeof skillsheet === 'string' 
        ? skillsheet.replace(/```json\n?|\n?```/g, '').trim()
        : skillsheet;
      
      let skillsheetData = {};
      if (typeof cleanSkillsheet === 'string') {
        skillsheetData = JSON.parse(cleanSkillsheet);
      } else {
        skillsheetData = cleanSkillsheet;
      }
      
      // Extract work content array from skillsheet career summaries
      workContent = Object.values(skillsheetData).map(career => career?.summary || career?.['summary'] || '');
    }
  } catch (parseError) {
    logger.warn('Failed to parse skillsheet for work content', { 
      jobId, 
      error: parseError.message,
      skillsheetType: typeof skillsheet
    });
    workContent = [];
  }
  
  logger.debug('Dify outputs parsed', {
    jobId,
    hasSkillsheet: !!skillsheet,
    hasLor: !!lor,
    hasSkills: !!skills,
    hasHope: !!hope,
    workContentItems: workContent.length
  });
  
  return {
    skillsheet,
    lor,
    workContent,
    skills,
    hope
  };
}

/**
 * Clean up temporary file
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} filePath - Path to temp file
 */
function cleanupTempFile(jobId, filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.debug('Temp file deleted', { jobId, filePath });
    } catch (error) {
      logger.warn('Failed to delete temp file', { 
        jobId, 
        filePath, 
        error: error.message 
      });
      // Continue - cleanup failure should not affect job status
    }
  }
}

export default {
  executeMainWorkflow,
  parseOutputs,
  CONFIG,
};
