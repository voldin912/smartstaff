/**
 * Follow Processing Orchestrator
 * 
 * Coordinates the follow audio processing pipeline with step tracking.
 * Reuses audio convert/split/stt from audioProcessing, but uses
 * follow-specific Dify workflow (summary) and persists to follows table.
 */

import fs from 'fs';
import logger from '../../utils/logger.js';
import { ERROR_CODES } from '../../config/axiosConfig.js';

// Reuse step modules from audioProcessing
import { convertToMp3, needsConversion } from '../audioProcessing/audioConverter.js';
import { splitAudioWithSilenceDetection, cleanupChunkFiles } from '../audioProcessing/audioSplitter.js';
import { processAllChunks, calculateQuality, mergeResults } from '../audioProcessing/sttProcessor.js';

// Follow-specific modules
import { executeFollowSummaryWorkflow } from './difyWorkflow.js';
import { completeFollowPersistence } from './recordPersister.js';

// Import job step service
import {
  initializeSteps,
  startStep,
  completeStep,
  failStep,
  skipStep,
} from '../jobStepService.js';

// Import heartbeat functions
import {
  acquireJobLock,
  startHeartbeatInterval,
  stopHeartbeatInterval,
  updateHeartbeat,
  endJob as endJobHeartbeat,
} from '../jobHeartbeat.js';

// Import pool for prompt lookup
import { pool } from '../../config/database.js';
import { DEFAULT_FOLLOW_SUMMARY_PROMPT } from './difyWorkflow.js';

/**
 * Step definitions
 */
const STEPS = {
  CONVERT: 'convert',
  SPLIT: 'split',
  STT: 'stt',
  DIFY_WORKFLOW: 'dify_workflow',
  PERSIST: 'persist',
  CLEANUP: 'cleanup',
};

/**
 * Fetch the per-company follow summary prompt, falling back to default.
 * 
 * @param {number} companyId - Company ID
 * @returns {Promise<string>} The prompt text
 */
async function getFollowPrompt(companyId) {
  try {
    if (companyId) {
      const [rows] = await pool.query(
        'SELECT follow_summary_prompt FROM companies WHERE id = ?',
        [companyId]
      );
      if (rows.length > 0 && rows[0].follow_summary_prompt) {
        return rows[0].follow_summary_prompt;
      }
    }
  } catch (error) {
    logger.warn('Failed to fetch company follow prompt, using default', {
      companyId,
      error: error.message,
    });
  }
  return DEFAULT_FOLLOW_SUMMARY_PROMPT;
}

/**
 * Main orchestrator - processes follow audio job through all steps
 * 
 * @param {number} jobId - Job ID
 * @param {string} audioFilePath - Path to audio file
 * @param {string} fileId - File ID
 * @param {number} userId - User ID
 * @param {number} companyId - Company ID
 * @param {string} staffId - Staff ID
 * @param {function} updateJobStatus - Function to update job status
 * @param {function} registerChunks - Function to register chunks
 * @param {function} updateChunkStatus - Function to update chunk status
 * @returns {Promise<{success: boolean, recordId?: number, error?: string}>}
 */
export async function processFollowAudioJob(
  jobId,
  audioFilePath,
  fileId,
  userId,
  companyId,
  staffId,
  updateJobStatus,
  registerChunks,
  updateChunkStatus
) {
  logger.info('Follow Orchestrator: Starting follow audio processing', { jobId, audioFilePath });

  // Acquire job lock (atomic grab)
  const lockResult = await acquireJobLock(jobId);
  if (!lockResult.acquired) {
    logger.warn('Follow Orchestrator: Failed to acquire job lock', { jobId, reason: lockResult.reason });
    return { success: false, error: `Failed to acquire job lock: ${lockResult.reason}` };
  }

  // Initialize step tracking
  await initializeSteps(jobId);

  // Start heartbeat interval
  startHeartbeatInterval(jobId);

  // Context for passing data between steps
  const context = {
    jobId,
    audioFilePath,
    fileId,
    userId,
    companyId,
    staffId,
    // Will be populated by steps
    processedFilePath: audioFilePath,
    chunks: [],
    chunkResults: [],
    qualityData: null,
    combinedText: '',
    summary: '',
  };

  let currentStepName = null;

  try {
    // ========================================
    // Step 1: Convert audio (if needed)
    // ========================================
    currentStepName = STEPS.CONVERT;
    await updateJobStatus(jobId, 'processing', 5, '音声変換中...');

    if (needsConversion(audioFilePath)) {
      await startStep(jobId, STEPS.CONVERT);

      const conversionResult = await convertToMp3(jobId, audioFilePath);
      context.processedFilePath = conversionResult.outputPath;

      await completeStep(jobId, STEPS.CONVERT, {
        converted: conversionResult.converted,
        outputPath: conversionResult.outputPath,
      });
    } else {
      await skipStep(jobId, STEPS.CONVERT, 'Audio already in MP3 format');
    }
    await updateHeartbeat(jobId);

    // ========================================
    // Step 2: Split audio
    // ========================================
    currentStepName = STEPS.SPLIT;
    await updateJobStatus(jobId, 'processing', 10, '音声ファイルを分割しています...');
    await startStep(jobId, STEPS.SPLIT);

    context.chunks = await splitAudioWithSilenceDetection(jobId, context.processedFilePath);

    // Register chunks in database
    await registerChunks(jobId, context.chunks.length);

    await completeStep(jobId, STEPS.SPLIT, {
      chunkCount: context.chunks.length,
    });
    await updateHeartbeat(jobId);

    // ========================================
    // Step 3: STT processing
    // ========================================
    currentStepName = STEPS.STT;
    await updateJobStatus(jobId, 'processing', 15, 'STT処理中...');
    await startStep(jobId, STEPS.STT);

    context.chunkResults = await processAllChunks(
      jobId,
      context.chunks,
      updateChunkStatus,
      updateJobStatus
    );

    // Calculate quality metrics
    context.qualityData = calculateQuality(jobId, context.chunkResults, context.chunks.length);

    // Check minimum success rate threshold
    if (!context.qualityData.meetsThreshold) {
      const errorMsg = `${ERROR_CODES.INSUFFICIENT_SUCCESS_RATE}: Success rate ${(context.qualityData.successRate * 100).toFixed(1)}% is below minimum threshold`;
      throw new Error(errorMsg);
    }

    // Merge successful results
    context.combinedText = mergeResults(context.chunkResults);

    await completeStep(jobId, STEPS.STT, {
      totalChunks: context.chunks.length,
      successCount: context.qualityData.successfulChunks.length,
      failedCount: context.qualityData.failedChunks.length,
      successRate: (context.qualityData.successRate * 100).toFixed(1) + '%',
    });
    await updateHeartbeat(jobId);

    // ========================================
    // Step 4: Follow Summary Dify workflow
    // ========================================
    currentStepName = STEPS.DIFY_WORKFLOW;
    await updateJobStatus(jobId, 'processing', 85, 'フォロー要約ワークフロー実行中...');
    await startStep(jobId, STEPS.DIFY_WORKFLOW);

    // Fetch per-company prompt (or default)
    const prompt = await getFollowPrompt(companyId);

    const difyResult = await executeFollowSummaryWorkflow(jobId, context.combinedText, prompt);
    context.summary = difyResult.summary || '';

    await completeStep(jobId, STEPS.DIFY_WORKFLOW, {
      hasSummary: !!context.summary,
      summaryLength: context.summary.length,
    });
    await updateHeartbeat(jobId);

    // ========================================
    // Step 5: Persist to follows table
    // ========================================
    currentStepName = STEPS.PERSIST;
    await updateJobStatus(jobId, 'processing', 95, 'データを保存しています...');
    await startStep(jobId, STEPS.PERSIST);

    const persistResult = await completeFollowPersistence(jobId, {
      fileId,
      userId,
      companyId,
      staffId,
      audioFilePath: context.processedFilePath,
      sttText: context.combinedText,
      summary: context.summary,
    });

    if (!persistResult.success) {
      throw new Error('Failed to persist follow record: ' + (persistResult.error || 'Unknown error'));
    }

    await completeStep(jobId, STEPS.PERSIST, {
      recordId: persistResult.recordId,
    });
    await updateHeartbeat(jobId);

    // ========================================
    // Step 6: Cleanup
    // ========================================
    currentStepName = STEPS.CLEANUP;
    await startStep(jobId, STEPS.CLEANUP);

    cleanupChunkFiles(jobId, context.chunks, context.processedFilePath);

    await completeStep(jobId, STEPS.CLEANUP, {
      cleanedChunks: context.chunks.length,
    });

    // ========================================
    // Complete job
    // ========================================
    stopHeartbeatInterval(jobId);
    await endJobHeartbeat(jobId, 'completed', 'none');

    const completionMessage = context.qualityData.qualityStatus === 'partial'
      ? `処理完了（一部チャンク失敗: 成功率 ${(context.qualityData.successRate * 100).toFixed(1)}%）`
      : '処理完了';

    await updateJobStatus(jobId, 'completed', 100, completionMessage);

    logger.info('Follow Orchestrator: Follow audio processing completed successfully', {
      jobId,
      recordId: persistResult.recordId,
      qualityStatus: context.qualityData.qualityStatus,
      successRate: (context.qualityData.successRate * 100).toFixed(1) + '%',
    });

    return {
      success: true,
      recordId: persistResult.recordId,
      qualityStatus: context.qualityData.qualityStatus,
    };

  } catch (error) {
    logger.error('Follow Orchestrator: Follow audio processing failed', {
      jobId,
      step: currentStepName,
      error: error.message,
    });

    // Record step failure
    if (currentStepName) {
      await failStep(jobId, currentStepName, error);
    }

    // Stop heartbeat and mark job as failed
    stopHeartbeatInterval(jobId);
    await endJobHeartbeat(jobId, 'failed', error.message);

    await updateJobStatus(jobId, 'failed', null, `失敗: ${currentStepName}`, error.message);

    return {
      success: false,
      error: error.message,
      failedStep: currentStepName,
    };

  } finally {
    // Ensure heartbeat interval is always stopped
    stopHeartbeatInterval(jobId);
  }
}

/**
 * Get step names for reference
 */
export const STEP_NAMES = Object.values(STEPS);

export default {
  processFollowAudioJob,
  STEPS,
  STEP_NAMES,
};
