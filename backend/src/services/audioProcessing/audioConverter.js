/**
 * Audio Converter Module
 * 
 * Handles audio format conversion (m4a/wav to mp3).
 * Part of the modular audio processing pipeline.
 */

import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import logger from '../../utils/logger.js';

ffmpeg.setFfmpegPath(ffmpegPath);

// Supported input formats that need conversion
const CONVERTIBLE_FORMATS = ['.m4a', '.wav', '.aac', '.flac', '.ogg', '.wma'];
const TARGET_FORMAT = '.mp3';

/**
 * Check if audio file needs conversion
 * 
 * @param {string} filePath - Path to audio file
 * @returns {boolean} True if conversion is needed
 */
export function needsConversion(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return CONVERTIBLE_FORMATS.includes(ext);
}

/**
 * Convert audio file to MP3 format
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} inputPath - Path to input audio file
 * @returns {Promise<{success: boolean, outputPath: string, converted: boolean}>}
 */
export async function convertToMp3(jobId, inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  
  // If already mp3, no conversion needed
  if (ext === TARGET_FORMAT) {
    logger.debug('Audio already in MP3 format, skipping conversion', { jobId, inputPath });
    return {
      success: true,
      outputPath: inputPath,
      converted: false
    };
  }

  // Check if format is supported for conversion
  if (!CONVERTIBLE_FORMATS.includes(ext)) {
    logger.warn('Unsupported audio format for conversion', { jobId, format: ext, inputPath });
    // Try to proceed anyway, ffmpeg might handle it
  }

  const outputPath = inputPath.replace(new RegExp(`\\${ext}$`, 'i'), TARGET_FORMAT);

  logger.info('Starting audio conversion', { 
    jobId, 
    inputFormat: ext, 
    outputFormat: TARGET_FORMAT,
    inputPath,
    outputPath
  });

  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .on('start', (commandLine) => {
        logger.debug('FFmpeg conversion started', { jobId, command: commandLine });
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          logger.debug('Conversion progress', { jobId, percent: progress.percent.toFixed(1) });
        }
      })
      .on('end', () => {
        logger.info('Audio conversion completed', { jobId, outputPath });
        
        // Clean up original file
        cleanupOriginalFile(jobId, inputPath);
        
        resolve({
          success: true,
          outputPath,
          converted: true
        });
      })
      .on('error', (err) => {
        logger.error('Audio conversion failed', { jobId, error: err.message, inputPath });
        reject(new Error(`Audio conversion failed: ${err.message}`));
      })
      .save(outputPath);
  });
}

/**
 * Clean up original file after conversion
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} filePath - Path to file to delete
 */
function cleanupOriginalFile(jobId, filePath) {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.debug('Original audio file deleted after conversion', { jobId, filePath });
    } catch (error) {
      logger.warn('Failed to delete original audio file', { 
        jobId, 
        filePath, 
        error: error.message 
      });
      // Non-fatal - continue processing
    }
  }
}

/**
 * Get audio file info using ffprobe
 * 
 * @param {number} jobId - Job ID for logging
 * @param {string} filePath - Path to audio file
 * @returns {Promise<{duration: number, format: string, bitrate: number}>}
 */
export async function getAudioInfo(jobId, filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        logger.error('Failed to get audio info', { jobId, filePath, error: err.message });
        reject(new Error(`Failed to get audio info: ${err.message}`));
        return;
      }

      const info = {
        duration: metadata.format.duration || 0,
        format: metadata.format.format_name || 'unknown',
        bitrate: metadata.format.bit_rate || 0,
        channels: metadata.streams?.[0]?.channels || 0,
        sampleRate: metadata.streams?.[0]?.sample_rate || 0
      };

      logger.debug('Audio info retrieved', { jobId, ...info });
      resolve(info);
    });
  });
}

export default {
  needsConversion,
  convertToMp3,
  getAudioInfo,
  CONVERTIBLE_FORMATS,
  TARGET_FORMAT,
};
