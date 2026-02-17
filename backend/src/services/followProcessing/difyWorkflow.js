/**
 * Follow Dify Workflow Module
 * 
 * Handles the follow-specific Dify AI workflow execution (summary).
 * Uses DIFY_SECRET_KEY_FOLLOW_SUMMARY env var and accepts an editable prompt.
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

// Default follow summary prompt (fallback when companies.follow_summary_prompt is NULL)
export const DEFAULT_FOLLOW_SUMMARY_PROMPT = `あなたは派遣スタッフのフォロー面談を分析する専門家です。
以下のフォロー面談の文字起こしテキストを読み、指定された5つの観点から要約を作成してください。

■ 要約ルール
- 各項目は簡潔かつ具体的に記述すること（各項目2〜4文程度）
- 面談内容に該当する情報がない項目は「該当する発言なし」と記載すること
- 推測や補足ではなく、面談内容に基づいた事実と判断を記述すること
- 管理者が30秒で状況を把握できる文章を心がけること
- 出力は以下のフォーマットに厳密に従うこと

■ 出力フォーマット

【サマリー】
面談内容全体を30秒で把握できるよう、現在の状況・総合的な印象・対応の要否を簡潔にまとめる。

【主な課題】
問題の所在を即判断できるよう、本人が感じている課題や懸念点を記載する。放置した場合のリスクにも触れる。

【職場環境】
派遣先調整の要否を判断するため、人間関係・上司や同僚との関係・作業環境・職場ルールに関する状況を記載する。

【仕事ボリューム・内容】
業務負荷やミスマッチを判断するため、業務量・業務内容の適性・負荷の偏りについて記載する。

【モチベーション・メンタル面】
離職リスクの兆候を検知するため、仕事への意欲・精神的な状態・疲労感・継続意思について記載する。`;

// Configuration
const CONFIG = {
  maxRetries: API_CONFIG.dify.maxRetries,
  uploadTimeout: API_CONFIG.dify.uploadTimeout,
  workflowTimeout: API_CONFIG.dify.workflowTimeout,
  uploadDir: 'uploads/audio',
};

/**
 * Execute follow summary Dify workflow
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} combinedText - Combined STT text from all chunks
 * @param {string} prompt - The summary prompt (per-company or default)
 * @returns {Promise<{summary: string}>} Summary result
 * @throws {Error} With standardized error code
 */
export async function executeFollowSummaryWorkflow(jobId, combinedText, prompt) {
  // Ensure upload directory exists
  if (!fs.existsSync(CONFIG.uploadDir)) {
    fs.mkdirSync(CONFIG.uploadDir, { recursive: true });
  }

  // Save combined text to temp file
  const tempFilePath = path.join(CONFIG.uploadDir, `temp_follow_${jobId}_${Date.now()}.csv`);
  fs.writeFileSync(tempFilePath, combinedText);

  logger.info('Starting follow summary Dify workflow', {
    jobId,
    textLength: combinedText.length,
    promptLength: prompt.length,
  });

  try {
    // Upload text file to Dify with retry
    const txtFileId = await uploadTextFile(jobId, tempFilePath);

    // Call follow summary workflow with retry
    const result = await runFollowWorkflow(jobId, txtFileId, prompt);

    // Parse outputs
    const summary = parseFollowOutputs(jobId, result);

    logger.info('Follow summary Dify workflow completed', { jobId, summaryLength: summary.length });
    return { summary };

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
          Authorization: `Bearer ${process.env.DIFY_SECRET_KEY_FOLLOW_SUMMARY}`,
          ...form.getHeaders(),
        },
        timeout: CONFIG.uploadTimeout,
      });

      logger.debug('Follow text file uploaded to Dify', { jobId, fileId: response.data.id });
      return response.data.id;

    } catch (error) {
      lastError = error;
      const errorCode = categorizeError(error, 'upload');
      const httpStatus = error.response?.status;

      logger.warn(`Follow Dify text upload attempt ${attempt}/${CONFIG.maxRetries} failed`, {
        jobId,
        errorCode,
        httpStatus,
        message: error.message,
      });

      // Check if we should retry
      const shouldRetry = attempt < CONFIG.maxRetries &&
        (isRetryableStatus(httpStatus) || !error.response);

      if (shouldRetry) {
        const delay = calculateBackoff(attempt);
        logger.debug(`Retrying follow text upload in ${delay}ms`, { jobId, attempt });
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  const errorCode = categorizeError(lastError, 'upload');
  const errorMessage = `${errorCode}: Follow text file upload failed - ${lastError.message}`;
  logger.error('Follow Dify text upload failed after all retries', { jobId, errorCode });

  const error = new Error(errorMessage);
  error.code = errorCode;
  throw error;
}

/**
 * Run the follow summary Dify workflow with retry
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} txtFileId - Dify file ID
 * @param {string} prompt - The summary prompt
 * @returns {Promise<object>} Workflow result data
 */
async function runFollowWorkflow(jobId, txtFileId, prompt) {
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
              "type": "document",
            },
            "prompt": prompt,
          },
          user: 'voldin012',
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY_FOLLOW_SUMMARY}`,
            'Content-Type': 'application/json',
          },
          timeout: CONFIG.workflowTimeout,
        }
      );

      logger.debug('Follow summary Dify workflow response received', { jobId });
      return response.data.data;

    } catch (error) {
      lastError = error;
      const errorCode = categorizeError(error, 'workflow');
      const httpStatus = error.response?.status;

      logger.warn(`Follow Dify summary workflow attempt ${attempt}/${CONFIG.maxRetries} failed`, {
        jobId,
        errorCode,
        httpStatus,
        message: error.message,
      });

      // Check if we should retry
      const shouldRetry = attempt < CONFIG.maxRetries &&
        (isRetryableStatus(httpStatus) || !error.response);

      if (shouldRetry) {
        const delay = calculateBackoff(attempt);
        logger.debug(`Retrying follow summary workflow in ${delay}ms`, { jobId, attempt });
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  const errorCode = categorizeError(lastError, 'workflow');
  const errorMessage = `${errorCode}: Follow summary workflow failed - ${lastError.message}`;
  logger.error('Follow Dify summary workflow failed after all retries', { jobId, errorCode });

  const error = new Error(errorMessage);
  error.code = errorCode;
  throw error;
}

/**
 * Parse and validate follow Dify workflow outputs
 * 
 * @param {number} jobId - Job ID for logging
 * @param {object} difyResult - Raw Dify workflow result
 * @returns {string} The summary text
 */
function parseFollowOutputs(jobId, difyResult) {
  const outputs = difyResult.outputs || {};

  // Extract summary from outputs
  const summary = outputs.summary || outputs.text || '';

  logger.debug('Follow Dify outputs parsed', {
    jobId,
    hasSummary: !!summary,
    summaryLength: summary.length,
  });

  return summary;
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
      logger.debug('Follow temp file deleted', { jobId, filePath });
    } catch (error) {
      logger.warn('Failed to delete follow temp file', {
        jobId,
        filePath,
        error: error.message,
      });
      // Continue - cleanup failure should not affect job status
    }
  }
}

export default {
  executeFollowSummaryWorkflow,
  DEFAULT_FOLLOW_SUMMARY_PROMPT,
  CONFIG,
};
