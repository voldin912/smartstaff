/**
 * Unified External API Configuration
 * 
 * Centralized configuration for all external API calls (Dify, etc.)
 * Provides consistent timeout, retry, and error handling settings.
 */

// Unified external API configuration
export const API_CONFIG = {
  dify: {
    uploadTimeout: parseInt(process.env.DIFY_UPLOAD_TIMEOUT || '300000'),    // 5 minutes
    workflowTimeout: parseInt(process.env.DIFY_WORKFLOW_TIMEOUT || '240000'), // 4 minutes
    maxRetries: parseInt(process.env.DIFY_MAX_RETRIES || '3'),
    retryDelay: parseInt(process.env.DIFY_RETRY_DELAY || '2000'),             // Initial delay (exponential backoff)
    retryableStatuses: [408, 429, 500, 502, 503, 504],
  },
  // Minimum chunk success rate for job to be considered successful
  // Jobs with success rate below this will fail with INSUFFICIENT_SUCCESS_RATE
  minChunkSuccessRate: parseFloat(process.env.MIN_CHUNK_SUCCESS_RATE || '0.80'), // 80% minimum
};

// Standardized error codes for external API failures
export const ERROR_CODES = {
  // Dify Upload errors
  DIFY_UPLOAD_FAILED: 'DIFY_UPLOAD_FAILED',
  DIFY_UPLOAD_TIMEOUT: 'DIFY_UPLOAD_TIMEOUT',
  
  // Dify Workflow errors
  DIFY_WORKFLOW_FAILED: 'DIFY_WORKFLOW_FAILED',
  DIFY_WORKFLOW_TIMEOUT: 'DIFY_WORKFLOW_TIMEOUT',
  
  // Chunk processing errors
  CHUNK_PROCESS_FAILED: 'CHUNK_PROCESS_FAILED',
  
  // Quality threshold errors
  INSUFFICIENT_SUCCESS_RATE: 'INSUFFICIENT_SUCCESS_RATE',
  
  // Network errors
  NETWORK_ERROR: 'NETWORK_ERROR',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
};

/**
 * Determines if an HTTP status code is retryable
 * @param {number} status - HTTP status code
 * @returns {boolean}
 */
export function isRetryableStatus(status) {
  return API_CONFIG.dify.retryableStatuses.includes(status);
}

/**
 * Determines if an error is a timeout error
 * @param {Error} error - Axios error
 * @returns {boolean}
 */
export function isTimeoutError(error) {
  return error.code === 'ECONNABORTED' || 
         error.code === 'ETIMEDOUT' ||
         error.message?.includes('timeout');
}

/**
 * Categorizes an axios error into a standardized error code
 * @param {Error} error - Axios error
 * @param {string} operation - 'upload' | 'workflow'
 * @returns {string} - Standardized error code
 */
export function categorizeError(error, operation = 'workflow') {
  if (isTimeoutError(error)) {
    return operation === 'upload' ? ERROR_CODES.DIFY_UPLOAD_TIMEOUT : ERROR_CODES.DIFY_WORKFLOW_TIMEOUT;
  }
  
  if (error.code === 'ECONNREFUSED') {
    return ERROR_CODES.CONNECTION_REFUSED;
  }
  
  if (!error.response) {
    return ERROR_CODES.NETWORK_ERROR;
  }
  
  // HTTP error with response
  return operation === 'upload' ? ERROR_CODES.DIFY_UPLOAD_FAILED : ERROR_CODES.DIFY_WORKFLOW_FAILED;
}

/**
 * Calculates exponential backoff delay
 * @param {number} attempt - Current attempt number (1-based)
 * @param {number} baseDelay - Base delay in milliseconds
 * @returns {number} - Delay in milliseconds
 */
export function calculateBackoff(attempt, baseDelay = API_CONFIG.dify.retryDelay) {
  return Math.pow(2, attempt - 1) * baseDelay;
}

/**
 * Sleep for a specified duration
 * @param {number} ms - Duration in milliseconds
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  API_CONFIG,
  ERROR_CODES,
  isRetryableStatus,
  isTimeoutError,
  categorizeError,
  calculateBackoff,
  sleep,
};
