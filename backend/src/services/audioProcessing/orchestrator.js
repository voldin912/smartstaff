/**
 * Audio Processing Orchestrator
 * 
 * Coordinates the audio processing pipeline with step tracking.
 * Manages the state machine for job execution.
 */

import fs from 'fs';
import logger from '../../utils/logger.js';
import { ERROR_CODES } from '../../config/axiosConfig.js';

// Import step modules
import { convertToMp3, needsConversion } from './audioConverter.js';
import { splitAudioWithSilenceDetection, cleanupChunkFiles } from './audioSplitter.js';
import { processAllChunks, calculateQuality, mergeResults } from './sttProcessor.js';
import { executeMainWorkflow, parseOutputs } from './difyWorkflow.js';
import { completeRecordPersistence } from './recordPersister.js';

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
 * Main orchestrator - processes audio job through all steps
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
export async function processAudioJob(
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
  logger.info('Orchestrator: Starting audio processing', { jobId, audioFilePath });
  
  // Acquire job lock (atomic grab)
  const lockResult = await acquireJobLock(jobId);
  if (!lockResult.acquired) {
    logger.warn('Orchestrator: Failed to acquire job lock', { jobId, reason: lockResult.reason });
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
    difyResult: null,
    outputs: null,
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
        outputPath: conversionResult.outputPath
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
      chunkCount: context.chunks.length
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
      successRate: (context.qualityData.successRate * 100).toFixed(1) + '%'
    });
    await updateHeartbeat(jobId);
    
    // ========================================
    // Step 4: Dify workflow
    // ========================================
    currentStepName = STEPS.DIFY_WORKFLOW;
    await updateJobStatus(jobId, 'processing', 85, 'Difyワークフロー実行中...');
    await startStep(jobId, STEPS.DIFY_WORKFLOW);
    
    context.difyResult = await executeMainWorkflow(jobId, context.combinedText);
    context.outputs = parseOutputs(jobId, context.difyResult);
    
    await completeStep(jobId, STEPS.DIFY_WORKFLOW, {
      hasSkillsheet: !!context.outputs.skillsheet,
      hasLor: !!context.outputs.lor,
      workContentItems: context.outputs.workContent.length
    });
    await updateHeartbeat(jobId);
    
    // ========================================
    // Step 5: Persist to database
    // ========================================
    currentStepName = STEPS.PERSIST;
    await updateJobStatus(jobId, 'processing', 95, 'データを保存しています...');
    await startStep(jobId, STEPS.PERSIST);
    
    const persistResult = await completeRecordPersistence(jobId, {
      fileId,
      userId,
      companyId,
      staffId,
      audioFilePath: context.processedFilePath,
      sttText: context.combinedText,
      skillsheet: context.outputs.skillsheet,
      lor: context.outputs.lor,
      workContent: context.outputs.workContent,
      skills: context.outputs.skills,
      hope: context.outputs.hope,
      qualityStatus: context.qualityData.qualityStatus,
      successRate: context.qualityData.successRate,
      warnings: context.qualityData.warnings
    });
    
    if (!persistResult.success) {
      throw new Error('Failed to persist record: ' + (persistResult.error || 'Unknown error'));
    }
    
    await completeStep(jobId, STEPS.PERSIST, {
      recordId: persistResult.recordId
    });
    await updateHeartbeat(jobId);
    
    // ========================================
    // Step 6: Cleanup
    // ========================================
    currentStepName = STEPS.CLEANUP;
    await startStep(jobId, STEPS.CLEANUP);
    
    cleanupChunkFiles(jobId, context.chunks, context.processedFilePath);
    
    await completeStep(jobId, STEPS.CLEANUP, {
      cleanedChunks: context.chunks.length
    });
    
    // ========================================
    // Complete job
    // ========================================
    stopHeartbeatInterval(jobId);
    await endJobHeartbeat(jobId, 'completed', 'none');
    
    // Set completion message based on quality status
    const completionMessage = context.qualityData.qualityStatus === 'partial'
      ? `処理完了（一部チャンク失敗: 成功率 ${(context.qualityData.successRate * 100).toFixed(1)}%）`
      : '処理完了';
    
    await updateJobStatus(jobId, 'completed', 100, completionMessage);
    
    logger.info('Orchestrator: Audio processing completed successfully', {
      jobId,
      recordId: persistResult.recordId,
      qualityStatus: context.qualityData.qualityStatus,
      successRate: (context.qualityData.successRate * 100).toFixed(1) + '%'
    });
    
    return {
      success: true,
      recordId: persistResult.recordId,
      qualityStatus: context.qualityData.qualityStatus
    };
    
  } catch (error) {
    logger.error('Orchestrator: Audio processing failed', {
      jobId,
      step: currentStepName,
      error: error.message
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
      failedStep: currentStepName
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
  processAudioJob,
  STEPS,
  STEP_NAMES,
};
