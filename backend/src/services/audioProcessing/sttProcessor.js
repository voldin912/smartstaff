/**
 * STT Processor Module
 * 
 * Handles Speech-to-Text processing via Dify API.
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
  maxConcurrency: parseInt(process.env.CHUNK_CONCURRENCY || '10'),
  maxRetries: API_CONFIG.dify.maxRetries,
  difyTimeout: API_CONFIG.dify.workflowTimeout,
  uploadTimeout: API_CONFIG.dify.uploadTimeout,
  minChunkSuccessRate: API_CONFIG.minChunkSuccessRate,
};

/**
 * Upload audio file to Dify with retry logic
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} filePath - Path to the file to upload
 * @returns {Promise<string>} - Dify file ID
 * @throws {Error} - With standardized error code
 */
export async function uploadFileToDify(jobId, filePath) {
  let lastError = null;
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const form = new FormData();
      form.append('file', fs.createReadStream(filePath), {
        filename: path.basename(filePath),
        contentType: 'audio/mpeg',
      });
      form.append('type', 'audio');
      form.append('purpose', 'workflow_input');
      form.append('user', 'voldin012');

      const response = await axios.post('https://api.dify.ai/v1/files/upload', form, {
        headers: {
          Authorization: `Bearer ${process.env.DIFY_SECRET_KEY}`,
          ...form.getHeaders()
        },
        timeout: CONFIG.uploadTimeout
      });

      logger.debug('File uploaded to Dify', { jobId, fileId: response.data.id });
      return response.data.id;
    } catch (error) {
      lastError = error;
      const errorCode = categorizeError(error, 'upload');
      const httpStatus = error.response?.status;
      
      logger.warn(`Dify upload attempt ${attempt}/${CONFIG.maxRetries} failed`, {
        jobId,
        filePath,
        errorCode,
        httpStatus,
        message: error.message
      });
      
      // Check if we should retry
      const shouldRetry = attempt < CONFIG.maxRetries && 
        (isRetryableStatus(httpStatus) || !error.response);
      
      if (shouldRetry) {
        const delay = calculateBackoff(attempt);
        logger.debug(`Retrying upload in ${delay}ms`, { jobId, filePath, attempt });
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  const errorCode = categorizeError(lastError, 'upload');
  const errorMessage = `${errorCode}: ${lastError.message}`;
  logger.error('Dify upload failed after all retries', { jobId, filePath, errorCode });
  
  const error = new Error(errorMessage);
  error.code = errorCode;
  error.httpStatus = lastError.response?.status;
  throw error;
}

/**
 * Process chunk with Dify STT workflow
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} chunkPath - Path to the audio chunk
 * @returns {Promise<string>} - STT result text
 * @throws {Error} - With standardized error code
 */
export async function processChunkWithDify(jobId, chunkPath) {
  // Upload file to Dify (has its own retry logic)
  const fileId = await uploadFileToDify(jobId, chunkPath);
  
  // Call STT workflow with retry
  let lastError = null;
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      const response = await axios.post(
        'https://api.dify.ai/v1/workflows/run',
        {
          inputs: {
            "audioFile": {
              "transfer_method": "local_file",
              "upload_file_id": fileId,
              "type": "audio"
            }
          },
          user: 'voldin012'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY_STT}`,
            'Content-Type': 'application/json'
          },
          timeout: CONFIG.difyTimeout
        }
      );
      
      const sttResult = response.data.data.outputs.stt;
      logger.debug('STT processing completed', { jobId, chunkPath, resultLength: sttResult?.length });
      return sttResult;
    } catch (error) {
      lastError = error;
      const errorCode = categorizeError(error, 'workflow');
      const httpStatus = error.response?.status;
      
      logger.warn(`Dify STT workflow attempt ${attempt}/${CONFIG.maxRetries} failed`, {
        jobId,
        chunkPath,
        errorCode,
        httpStatus,
        message: error.message
      });
      
      // Check if we should retry
      const shouldRetry = attempt < CONFIG.maxRetries && 
        (isRetryableStatus(httpStatus) || !error.response);
      
      if (shouldRetry) {
        const delay = calculateBackoff(attempt);
        logger.debug(`Retrying STT workflow in ${delay}ms`, { jobId, chunkPath, attempt });
        await sleep(delay);
      }
    }
  }
  
  // All retries exhausted
  const errorCode = categorizeError(lastError, 'workflow');
  const errorMessage = `${errorCode}: ${lastError.message}`;
  logger.error('Dify STT workflow failed after all retries', { jobId, chunkPath, errorCode });
  
  const error = new Error(errorMessage);
  error.code = errorCode;
  error.httpStatus = lastError.response?.status;
  throw error;
}

/**
 * Process single chunk with retry logic
 * 
 * @param {number} jobId - Job ID for logging
 * @param {object} chunk - Chunk object {index, path, ...}
 * @param {function} updateChunkStatus - Function to update chunk status in DB
 * @returns {Promise<{index: number, stt: string, success: boolean, error?: string}>}
 */
export async function processChunkWithRetry(jobId, chunk, updateChunkStatus) {
  for (let attempt = 1; attempt <= CONFIG.maxRetries; attempt++) {
    try {
      await updateChunkStatus(jobId, chunk.index, 'processing');
      
      logger.debug('Processing chunk', { jobId, chunkIndex: chunk.index, attempt });
      
      const sttResult = await processChunkWithDify(jobId, chunk.path);
      
      await updateChunkStatus(jobId, chunk.index, 'completed', sttResult);
      
      return {
        index: chunk.index,
        stt: sttResult,
        success: true
      };
    } catch (error) {
      logger.warn(`Chunk ${chunk.index} processing attempt ${attempt} failed`, { 
        jobId,
        error: error.message
      });
      
      if (attempt === CONFIG.maxRetries) {
        await updateChunkStatus(jobId, chunk.index, 'failed', null, error.message);
        return {
          index: chunk.index,
          stt: '',
          success: false,
          error: error.message
        };
      }
      
      // Exponential backoff
      const waitTime = Math.pow(2, attempt) * 1000;
      logger.debug(`Waiting ${waitTime}ms before retry`, { jobId, chunkIndex: chunk.index });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

/**
 * Process multiple chunks in parallel with concurrency control
 * 
 * @param {number} jobId - Job ID for logging
 * @param {Array<{index: number, path: string}>} chunks - Array of chunk objects
 * @param {function} updateChunkStatus - Function to update chunk status in DB
 * @param {function} updateJobStatus - Function to update job status
 * @returns {Promise<Array<{index: number, stt: string, success: boolean}>>}
 */
export async function processAllChunks(jobId, chunks, updateChunkStatus, updateJobStatus) {
  const results = new Array(chunks.length);
  const processing = [];
  let completedCount = 0;
  
  const totalChunks = chunks.length;
  
  logger.info('Starting parallel chunk processing', { 
    jobId, 
    totalChunks, 
    maxConcurrency: CONFIG.maxConcurrency 
  });
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    const chunkPromise = processChunkWithRetry(jobId, chunk, updateChunkStatus)
      .then(result => {
        results[result.index] = result;
        completedCount++;
        
        // Update progress
        const progress = Math.floor((completedCount / totalChunks) * 70) + 10; // 10-80% for chunk processing
        updateJobStatus(jobId, 'processing', progress, `STT処理中 (${completedCount}/${totalChunks})`);
        
        return result;
      });
    
    processing.push(chunkPromise);
    
    // Concurrency control: wait if we've reached max concurrent processing
    if (processing.length >= CONFIG.maxConcurrency) {
      await Promise.race(processing);
      // Remove completed promises
      const completedIndices = [];
      for (let j = 0; j < processing.length; j++) {
        const status = await Promise.race([processing[j], Promise.resolve('pending')]);
        if (status !== 'pending') {
          completedIndices.push(j);
        }
      }
      // Remove from end to avoid index issues
      for (let j = completedIndices.length - 1; j >= 0; j--) {
        processing.splice(completedIndices[j], 1);
      }
    }
  }
  
  // Wait for all remaining chunks
  await Promise.allSettled(processing);
  
  // Check for failures
  const failedChunks = results.filter(r => r && !r.success);
  if (failedChunks.length > 0) {
    logger.warn('Some chunks failed', { 
      jobId, 
      failedCount: failedChunks.length,
      failedIndices: failedChunks.map(c => c.index)
    });
  }
  
  logger.info('Chunk processing completed', { 
    jobId, 
    totalChunks, 
    successCount: results.filter(r => r && r.success).length,
    failedCount: failedChunks.length
  });
  
  return results;
}

/**
 * Calculate quality metrics from chunk results
 * 
 * @param {number} jobId - Job ID for logging
 * @param {Array<{success: boolean, error?: string}>} results - Chunk results
 * @param {number} totalChunks - Total number of chunks
 * @returns {{successRate: number, qualityStatus: string, warnings: Array, meetsThreshold: boolean}}
 */
export function calculateQuality(jobId, results, totalChunks) {
  const successfulChunks = results.filter(r => r && r.success);
  const failedChunks = results.filter(r => r && !r.success);
  
  const successRate = totalChunks > 0 ? successfulChunks.length / totalChunks : 0;
  const qualityStatus = failedChunks.length > 0 ? 'partial' : 'complete';
  const meetsThreshold = successRate >= CONFIG.minChunkSuccessRate;
  
  // Build warnings for failed chunks
  const warnings = failedChunks.map(chunk => ({
    code: ERROR_CODES.CHUNK_PROCESS_FAILED,
    chunk_index: chunk.index,
    error: chunk.error || 'Unknown error'
  }));
  
  logger.info('Quality calculation completed', {
    jobId,
    totalChunks,
    successCount: successfulChunks.length,
    failedCount: failedChunks.length,
    successRate: (successRate * 100).toFixed(1) + '%',
    qualityStatus,
    meetsThreshold
  });
  
  return {
    successRate,
    qualityStatus,
    warnings,
    meetsThreshold,
    successfulChunks,
    failedChunks
  };
}

/**
 * Merge successful STT results into combined text
 * 
 * @param {Array<{index: number, stt: string, success: boolean}>} results - Chunk results
 * @returns {string} Combined STT text
 */
export function mergeResults(results) {
  return results
    .filter(r => r && r.success)
    .sort((a, b) => a.index - b.index)
    .map(r => r.stt)
    .join('\n');
}

export default {
  uploadFileToDify,
  processChunkWithDify,
  processChunkWithRetry,
  processAllChunks,
  calculateQuality,
  mergeResults,
  CONFIG,
};
