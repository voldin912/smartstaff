/**
 * Audio Processing Module
 * 
 * Re-exports all audio processing components for easy importing.
 */

// Main orchestrator
export { 
  processAudioJob,
  STEPS,
  STEP_NAMES,
} from './orchestrator.js';

// Audio converter
export {
  convertToMp3,
  needsConversion,
  getAudioInfo,
} from './audioConverter.js';

// Audio splitter
export {
  detectSilence,
  getAudioDuration,
  splitAudioAtPoints,
  splitAudioWithSilenceDetection,
  splitAudioSimple,
  cleanupChunkFiles,
} from './audioSplitter.js';

// STT processor
export {
  uploadFileToDify,
  processChunkWithDify,
  processChunkWithRetry,
  processAllChunks,
  calculateQuality,
  mergeResults,
} from './sttProcessor.js';

// Dify workflow
export {
  executeMainWorkflow,
  parseOutputs,
} from './difyWorkflow.js';

// Record persister
export {
  saveRecord,
  updateJobRecord,
  invalidateCache,
  getRecordByJobId,
  completeRecordPersistence,
} from './recordPersister.js';

// Default export for convenience
export { default as orchestrator } from './orchestrator.js';
export { default as audioConverter } from './audioConverter.js';
export { default as audioSplitter } from './audioSplitter.js';
export { default as sttProcessor } from './sttProcessor.js';
export { default as difyWorkflow } from './difyWorkflow.js';
export { default as recordPersister } from './recordPersister.js';
