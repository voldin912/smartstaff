/**
 * Audio Splitter Module
 * 
 * Handles audio file splitting with silence detection.
 * Part of the modular audio processing pipeline.
 */

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import logger from '../../utils/logger.js';

ffmpeg.setFfmpegPath(ffmpegPath);

// Configuration (can be overridden via environment variables)
const CONFIG = {
  maxChunkSize: 10 * 1024 * 1024,  // 10MB
  minChunkSize: 1 * 1024 * 1024,   // 1MB
  fallbackChunkSize: 4 * 1024 * 1024, // 4MB
  maxChunkDuration: parseInt(process.env.MAX_CHUNK_DURATION || '180'), // 3 min target
  maxChunkDurationHard: parseInt(process.env.MAX_CHUNK_DURATION_HARD || '210'), // 3.5 min absolute max
  silenceThreshold: parseInt(process.env.SILENCE_THRESHOLD || '-40'), // dB
  silenceDuration: parseFloat(process.env.SILENCE_DURATION || '0.5'), // seconds
};

/**
 * Detect silence points in audio file
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} audioFilePath - Path to audio file
 * @returns {Promise<Array<{start: number, end: number, midpoint: number}>>}
 */
export async function detectSilence(jobId, audioFilePath) {
  return new Promise((resolve, reject) => {
    const silencePoints = [];
    let silenceStart = null;
    
    ffmpeg(audioFilePath)
      .audioFilters(`silencedetect=noise=${CONFIG.silenceThreshold}dB:d=${CONFIG.silenceDuration}`)
      .format('null')
      .on('stderr', (stderrLine) => {
        // Parse silence_start
        const startMatch = stderrLine.match(/silence_start:\s*([\d.]+)/);
        if (startMatch) {
          silenceStart = parseFloat(startMatch[1]);
        }
        
        // Parse silence_end
        const endMatch = stderrLine.match(/silence_end:\s*([\d.]+)/);
        if (endMatch && silenceStart !== null) {
          const silenceEnd = parseFloat(endMatch[1]);
          // Use midpoint of silence as split point
          silencePoints.push({
            start: silenceStart,
            end: silenceEnd,
            midpoint: (silenceStart + silenceEnd) / 2
          });
          silenceStart = null;
        }
      })
      .on('end', () => {
        logger.debug('Silence detection completed', { 
          jobId,
          file: audioFilePath, 
          silencePointsCount: silencePoints.length 
        });
        resolve(silencePoints);
      })
      .on('error', (err) => {
        logger.warn('Silence detection failed, will use fallback', { jobId, error: err.message });
        resolve([]); // Return empty array to trigger fallback
      })
      .output('pipe:1')
      .run();
  });
}

/**
 * Get audio duration using ffprobe
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} audioFilePath - Path to audio file
 * @returns {Promise<number>} Duration in seconds
 */
export async function getAudioDuration(jobId, audioFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
      if (err) {
        logger.error('Failed to get audio duration', { jobId, error: err.message });
        reject(err);
        return;
      }
      const duration = metadata.format.duration;
      logger.debug('Audio duration retrieved', { jobId, duration });
      resolve(duration);
    });
  });
}

/**
 * Split audio at specific time points
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} audioFilePath - Path to audio file
 * @param {number[]} splitPoints - Array of times (in seconds) to split at
 * @param {string} outputDir - Directory for output chunks
 * @returns {Promise<Array<{index: number, path: string, startTime: number, endTime: number, duration: number}>>}
 */
export async function splitAudioAtPoints(jobId, audioFilePath, splitPoints, outputDir) {
  const chunks = [];
  const ext = path.extname(audioFilePath);
  const baseName = path.basename(audioFilePath, ext);
  
  logger.info('Splitting audio at points', { 
    jobId, 
    splitPointsCount: splitPoints.length,
    outputDir 
  });
  
  for (let i = 0; i < splitPoints.length; i++) {
    const startTime = i === 0 ? 0 : splitPoints[i - 1];
    const endTime = splitPoints[i];
    const duration = endTime - startTime;
    
    const chunkPath = path.join(outputDir, `${baseName}_chunk_${i}${ext}`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(audioFilePath)
        .setStartTime(startTime)
        .setDuration(duration)
        .output(chunkPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
    
    chunks.push({
      index: i,
      path: chunkPath,
      startTime,
      endTime,
      duration
    });
    
    logger.debug('Chunk created', { jobId, chunkIndex: i, startTime, endTime, duration });
  }
  
  // Add final chunk (from last split point to end)
  if (splitPoints.length > 0) {
    const lastStartTime = splitPoints[splitPoints.length - 1];
    const chunkPath = path.join(outputDir, `${baseName}_chunk_${splitPoints.length}${ext}`);
    
    await new Promise((resolve, reject) => {
      ffmpeg(audioFilePath)
        .setStartTime(lastStartTime)
        .output(chunkPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run();
    });
    
    chunks.push({
      index: splitPoints.length,
      path: chunkPath,
      startTime: lastStartTime,
      endTime: null, // To end of file
      duration: null
    });
    
    logger.debug('Final chunk created', { jobId, chunkIndex: splitPoints.length });
  }
  
  return chunks;
}

/**
 * Split audio with silence detection (main splitting method)
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} audioFilePath - Path to audio file
 * @returns {Promise<Array<{index: number, path: string, startTime: number, endTime: number, duration: number}>>}
 */
export async function splitAudioWithSilenceDetection(jobId, audioFilePath) {
  try {
    // Get audio duration
    const duration = await getAudioDuration(jobId, audioFilePath);
    logger.debug('Audio duration', { jobId, duration, file: audioFilePath });
    
    // Detect silence points
    const silencePoints = await detectSilence(jobId, audioFilePath);
    
    // Get file size
    const stats = fs.statSync(audioFilePath);
    const fileSize = stats.size;
    
    // Calculate approximate bytes per second
    const bytesPerSecond = fileSize / duration;
    
    // Calculate target chunk duration based on max chunk size
    const targetChunkDuration = CONFIG.maxChunkSize / bytesPerSecond;
    
    let splitPoints = [];
    
    if (silencePoints.length > 0) {
      // Hybrid silence-based splitting with soft/hard duration limits
      let lastSplitTime = 0;
      let i = 0;
      
      while (i < silencePoints.length) {
        const silence = silencePoints[i];
        const timeSinceLastSplit = silence.midpoint - lastSplitTime;
        const estimatedChunkSize = timeSinceLastSplit * bytesPerSecond;
        
        // Case 1: Chunk exceeds soft limit (3 min) or size limit - split at this silence
        if (timeSinceLastSplit >= CONFIG.maxChunkDuration || 
            estimatedChunkSize >= CONFIG.maxChunkSize * 0.8) {
          splitPoints.push(silence.midpoint);
          lastSplitTime = silence.midpoint;
        }
        // Case 2: Check if we need to force-split (hard limit exceeded with no silence)
        else if (i === silencePoints.length - 1 || 
                 silencePoints[i + 1].midpoint - lastSplitTime > CONFIG.maxChunkDurationHard) {
          // Next silence would exceed hard limit, check if current chunk is too long
          if (timeSinceLastSplit > CONFIG.maxChunkDuration * 0.5) {
            // Current chunk is reasonably sized, split here
            splitPoints.push(silence.midpoint);
            lastSplitTime = silence.midpoint;
          }
        }
        
        i++;
      }
      
      // Handle remaining audio after last silence point
      const remainingDuration = duration - lastSplitTime;
      if (remainingDuration > CONFIG.maxChunkDurationHard) {
        // Need to add force-split points for the remaining audio
        let currentTime = lastSplitTime + CONFIG.maxChunkDuration;
        while (currentTime < duration - 5) {
          splitPoints.push(currentTime);
          currentTime += CONFIG.maxChunkDuration;
        }
        logger.debug('Added force-split points for remaining audio', {
          jobId,
          remainingDuration,
          forceSplitCount: splitPoints.length
        });
      }
      
      // Remove split points too close to the end
      while (splitPoints.length > 0 && (duration - splitPoints[splitPoints.length - 1]) < 5) {
        splitPoints.pop();
      }
      
      logger.debug('Using silence-based splitting', { 
        jobId,
        splitPointsCount: splitPoints.length,
        silencePointsCount: silencePoints.length,
        maxChunkDuration: CONFIG.maxChunkDuration,
        maxChunkDurationHard: CONFIG.maxChunkDurationHard,
        estimatedChunks: splitPoints.length + 1
      });
    }
    
    // Fallback to time-based splitting if no suitable silence points found
    if (splitPoints.length === 0 && duration > CONFIG.maxChunkDuration) {
      // No silence points - use fixed interval splitting based on maxChunkDuration
      let currentTime = CONFIG.maxChunkDuration;
      
      while (currentTime < duration - 5) { // Leave at least 5 seconds for last chunk
        splitPoints.push(currentTime);
        currentTime += CONFIG.maxChunkDuration;
      }
      
      logger.debug('Using fixed-interval fallback (no silence detected)', { 
        jobId,
        splitPointsCount: splitPoints.length,
        intervalDuration: CONFIG.maxChunkDuration
      });
    }
    
    // If file is small enough, no splitting needed
    if (splitPoints.length === 0) {
      logger.debug('No splitting needed, file is small enough', { jobId });
      return [{
        index: 0,
        path: audioFilePath,
        startTime: 0,
        endTime: duration,
        duration: duration
      }];
    }
    
    // Create output directory for chunks
    const outputDir = path.dirname(audioFilePath);
    
    // Split audio at the calculated points
    const chunks = await splitAudioAtPoints(jobId, audioFilePath, splitPoints, outputDir);
    
    logger.info('Audio splitting completed', { 
      jobId, 
      chunkCount: chunks.length,
      method: silencePoints.length > 0 ? 'silence-based' : 'time-based'
    });
    
    return chunks;
    
  } catch (error) {
    logger.error('Error in silence detection splitting, falling back to simple split', { 
      jobId, 
      error: error.message 
    });
    return await splitAudioSimple(jobId, audioFilePath);
  }
}

/**
 * Simple fallback split (binary splitting)
 * Used when silence detection fails
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} audioFilePath - Path to audio file
 * @returns {Promise<Array<{index: number, path: string}>>}
 */
export async function splitAudioSimple(jobId, audioFilePath) {
  logger.info('Using simple binary split fallback', { jobId, audioFilePath });
  
  const fileBuffer = fs.readFileSync(audioFilePath);
  const chunks = [];
  const chunkSize = CONFIG.fallbackChunkSize;
  const ext = path.extname(audioFilePath);
  const baseName = path.basename(audioFilePath, ext);
  const outputDir = path.dirname(audioFilePath);
  
  for (let i = 0; i < fileBuffer.length; i += chunkSize) {
    const chunk = fileBuffer.slice(i, i + chunkSize);
    const chunkIndex = Math.floor(i / chunkSize);
    const chunkPath = path.join(outputDir, `${baseName}_chunk_${chunkIndex}${ext}`);
    
    fs.writeFileSync(chunkPath, chunk);
    
    chunks.push({
      index: chunkIndex,
      path: chunkPath,
      startTime: null,
      endTime: null,
      duration: null
    });
  }
  
  logger.info('Simple split completed', { jobId, chunkCount: chunks.length });
  
  return chunks;
}

/**
 * Clean up chunk files
 * 
 * @param {number} jobId - Job ID for logging
 * @param {Array<{path: string}>} chunks - Array of chunk objects
 * @param {string} originalPath - Original audio file path (to preserve)
 */
export function cleanupChunkFiles(jobId, chunks, originalPath) {
  let cleanedCount = 0;
  let failedCount = 0;
  
  for (const chunk of chunks) {
    if (chunk.path !== originalPath && fs.existsSync(chunk.path)) {
      try {
        fs.unlinkSync(chunk.path);
        cleanedCount++;
      } catch (error) {
        logger.warn('Failed to clean up chunk file', { 
          jobId, 
          path: chunk.path,
          error: error.message 
        });
        failedCount++;
      }
    }
  }
  
  logger.debug('Chunk cleanup completed', { jobId, cleanedCount, failedCount });
}

export default {
  detectSilence,
  getAudioDuration,
  splitAudioAtPoints,
  splitAudioWithSilenceDetection,
  splitAudioSimple,
  cleanupChunkFiles,
  CONFIG,
};
