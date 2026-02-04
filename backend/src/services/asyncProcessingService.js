import { pool } from '../config/database.js';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import logger from '../utils/logger.js';
import cache from '../utils/cache.js';

ffmpeg.setFfmpegPath(ffmpegPath);

// Configuration
const CONFIG = {
  maxConcurrency: parseInt(process.env.CHUNK_CONCURRENCY || '10'),
  maxRetries: parseInt(process.env.CHUNK_MAX_RETRIES || '3'),
  maxChunkSize: 10 * 1024 * 1024,  // 10MB
  minChunkSize: 1 * 1024 * 1024,   // 1MB
  fallbackChunkSize: 4 * 1024 * 1024, // 4MB
  maxChunkDuration: parseInt(process.env.MAX_CHUNK_DURATION || '180'), // 3 min target
  maxChunkDurationHard: parseInt(process.env.MAX_CHUNK_DURATION_HARD || '210'), // 3.5 min absolute max
  silenceThreshold: parseInt(process.env.SILENCE_THRESHOLD || '-40'), // dB
  silenceDuration: parseFloat(process.env.SILENCE_DURATION || '0.5'), // seconds
  difyTimeout: 240000, // 4 minutes
  uploadTimeout: 300000, // 5 minutes
};


// ============================================
// Job Management Functions
// ============================================

/**
 * Create a new processing job
 */
export async function createProcessingJob(fileId, userId, companyId, staffId, localFilePath) {
  try {
    const [result] = await pool.query(
      `INSERT INTO processing_jobs 
       (file_id, user_id, company_id, staff_id, local_file_path, status, current_step) 
       VALUES (?, ?, ?, ?, ?, 'pending', 'ジョブ作成完了')`,
      [fileId, userId, companyId, staffId, localFilePath]
    );
    
    logger.info('Processing job created', { jobId: result.insertId, fileId, userId });
    return result.insertId;
  } catch (error) {
    logger.error('Error creating processing job', error);
    throw error;
  }
}

/**
 * Update job status and progress
 */
export async function updateJobStatus(jobId, status, progress = null, currentStep = null, errorMessage = null) {
  try {
    const updates = ['status = ?', 'updated_at = NOW()'];
    const params = [status];
    
    if (progress !== null) {
      updates.push('progress = ?');
      params.push(progress);
    }
    
    if (currentStep !== null) {
      updates.push('current_step = ?');
      params.push(currentStep);
    }
    
    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    
    if (status === 'completed' || status === 'failed') {
      updates.push('completed_at = NOW()');
    }
    
    params.push(jobId);
    
    await pool.query(
      `UPDATE processing_jobs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    logger.debug('Job status updated', { jobId, status, progress, currentStep });
  } catch (error) {
    logger.error('Error updating job status', error);
  }
}

/**
 * Update job chunk counts
 */
export async function updateJobChunkCounts(jobId, totalChunks = null, completedChunks = null) {
  try {
    const updates = ['updated_at = NOW()'];
    const params = [];
    
    if (totalChunks !== null) {
      updates.push('total_chunks = ?');
      params.push(totalChunks);
    }
    
    if (completedChunks !== null) {
      updates.push('completed_chunks = ?');
      params.push(completedChunks);
    }
    
    params.push(jobId);
    
    await pool.query(
      `UPDATE processing_jobs SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  } catch (error) {
    logger.error('Error updating job chunk counts', error);
  }
}

/**
 * Save STT result to job
 */
export async function saveJobSttResult(jobId, sttResult) {
  try {
    await pool.query(
      'UPDATE processing_jobs SET stt_result = ?, updated_at = NOW() WHERE id = ?',
      [sttResult, jobId]
    );
  } catch (error) {
    logger.error('Error saving job STT result', error);
  }
}

/**
 * Get job status for polling
 */
export async function getJobStatus(jobId, userId = null, role = null) {
  try {
    let query = `
      SELECT 
        id as jobId,
        file_id as fileId,
        user_id as userId,
        company_id as companyId,
        staff_id as staffId,
        status,
        progress,
        current_step as currentStep,
        total_chunks as totalChunks,
        completed_chunks as completedChunks,
        error_message as errorMessage,
        created_at as createdAt,
        updated_at as updatedAt,
        completed_at as completedAt
      FROM processing_jobs
      WHERE id = ?
    `;
    const params = [jobId];
    
    // Apply role-based filtering
    if (role === 'member' || role === 'company-manager') {
      query += ' AND user_id = ?';
      params.push(userId);
    }
    // Admin can see all jobs
    
    const [jobs] = await pool.query(query, params);
    
    if (jobs.length === 0) {
      return null;
    }
    
    return jobs[0];
  } catch (error) {
    logger.error('Error getting job status', error);
    throw error;
  }
}

/**
 * Get all jobs for a user
 */
export async function getUserJobs(userId, companyId, role, status = null, limit = 20) {
  try {
    let query = `
      SELECT 
        id as jobId,
        file_id as fileId,
        staff_id as staffId,
        status,
        progress,
        current_step as currentStep,
        total_chunks as totalChunks,
        completed_chunks as completedChunks,
        error_message as errorMessage,
        created_at as createdAt,
        completed_at as completedAt
      FROM processing_jobs
      WHERE 1=1
    `;
    const params = [];
    
    if (role === 'member') {
      query += ' AND user_id = ?';
      params.push(userId);
    } else if (role === 'company-manager') {
      query += ' AND company_id = ?';
      params.push(companyId);
    }
    // Admin sees all
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);
    
    const [jobs] = await pool.query(query, params);
    return jobs;
  } catch (error) {
    logger.error('Error getting user jobs', error);
    throw error;
  }
}

// ============================================
// Chunk Management Functions
// ============================================

/**
 * Register chunks for a job
 */
export async function registerChunks(jobId, chunkCount) {
  try {
    const values = [];
    for (let i = 0; i < chunkCount; i++) {
      values.push([jobId, i, 'pending']);
    }
    
    await pool.query(
      'INSERT INTO chunk_processing (job_id, chunk_index, status) VALUES ?',
      [values]
    );
    
    await updateJobChunkCounts(jobId, chunkCount, 0);
    
    logger.debug('Chunks registered', { jobId, chunkCount });
  } catch (error) {
    logger.error('Error registering chunks', error);
    throw error;
  }
}

/**
 * Update chunk status
 */
export async function updateChunkStatus(jobId, chunkIndex, status, sttResult = null, errorMessage = null) {
  try {
    const updates = ['status = ?', 'updated_at = NOW()'];
    const params = [status];
    
    if (sttResult !== null) {
      updates.push('stt_result = ?');
      params.push(sttResult);
    }
    
    if (errorMessage !== null) {
      updates.push('error_message = ?');
      params.push(errorMessage);
    }
    
    if (status === 'failed') {
      updates.push('retry_count = retry_count + 1');
    }
    
    params.push(jobId, chunkIndex);
    
    await pool.query(
      `UPDATE chunk_processing SET ${updates.join(', ')} WHERE job_id = ? AND chunk_index = ?`,
      params
    );
    
    // Update completed chunks count if completed
    if (status === 'completed') {
      await pool.query(
        'UPDATE processing_jobs SET completed_chunks = completed_chunks + 1, updated_at = NOW() WHERE id = ?',
        [jobId]
      );
    }
  } catch (error) {
    logger.error('Error updating chunk status', error);
  }
}

/**
 * Get failed chunks for retry
 */
export async function getFailedChunks(jobId) {
  try {
    const [chunks] = await pool.query(
      'SELECT chunk_index, retry_count FROM chunk_processing WHERE job_id = ? AND status = ? AND retry_count < ?',
      [jobId, 'failed', CONFIG.maxRetries]
    );
    return chunks;
  } catch (error) {
    logger.error('Error getting failed chunks', error);
    return [];
  }
}

// ============================================
// Audio Splitting with Silence Detection
// ============================================

/**
 * Detect silence points in audio file using ffmpeg
 */
export async function detectSilence(audioFilePath) {
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
          file: audioFilePath, 
          silencePointsCount: silencePoints.length 
        });
        resolve(silencePoints);
      })
      .on('error', (err) => {
        logger.warn('Silence detection failed, will use fallback', { error: err.message });
        resolve([]); // Return empty array to trigger fallback
      })
      .output('pipe:1')
      .run();
  });
}

/**
 * Get audio duration using ffprobe
 */
export async function getAudioDuration(audioFilePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata.format.duration);
    });
  });
}

/**
 * Split audio at specific time points
 */
export async function splitAudioAtPoints(audioFilePath, splitPoints, outputDir) {
  const chunks = [];
  const ext = path.extname(audioFilePath);
  const baseName = path.basename(audioFilePath, ext);
  
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
  }
  
  return chunks;
}

/**
 * Split audio with silence detection (improved method)
 */
export async function splitAudioWithSilenceDetection(audioFilePath) {
  try {
    // Get audio duration
    const duration = await getAudioDuration(audioFilePath);
    logger.debug('Audio duration', { duration, file: audioFilePath });
    
    // Detect silence points
    const silencePoints = await detectSilence(audioFilePath);
    
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
          remainingDuration,
          forceSplitCount: splitPoints.length
        });
      }
      
      // Remove split points too close to the end
      while (splitPoints.length > 0 && (duration - splitPoints[splitPoints.length - 1]) < 5) {
        splitPoints.pop();
      }
      
      logger.debug('Using silence-based splitting', { 
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
        splitPointsCount: splitPoints.length,
        intervalDuration: CONFIG.maxChunkDuration
      });
    }
    
    // If file is small enough, no splitting needed
    if (splitPoints.length === 0) {
      logger.debug('No splitting needed, file is small enough');
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
    return await splitAudioAtPoints(audioFilePath, splitPoints, outputDir);
    
  } catch (error) {
    logger.error('Error in silence detection splitting, falling back to simple split', error);
    return await splitAudioSimple(audioFilePath);
  }
}

/**
 * Simple fallback split (binary splitting like original)
 */
export async function splitAudioSimple(audioFilePath) {
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
  
  return chunks;
}

// ============================================
// Dify API Integration
// ============================================

/**
 * Upload file to Dify
 */
export async function uploadFileToDify(filePath) {
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

  return response.data.id;
}

/**
 * Process chunk with Dify STT workflow
 */
export async function processChunkWithDify(chunkPath) {
  // Upload file to Dify
  const fileId = await uploadFileToDify(chunkPath);
  
  // Call STT workflow
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
  
  return response.data.data.outputs.stt;
}

/**
 * Execute main Dify workflow (skill sheet, lor, salesforce)
 */
export async function executeDifyWorkflow(combinedText) {
  // Save combined text to temp file
  const tempFilePath = path.join('uploads/audio', `temp_${Date.now()}.csv`);
  fs.writeFileSync(tempFilePath, combinedText);
  
  try {
    // Upload text file to Dify
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFilePath), {
      filename: path.basename(tempFilePath),
      contentType: 'text/csv',
    });
    form.append('type', 'document');
    form.append('purpose', 'workflow_input');
    form.append('user', 'voldin012');

    const uploadResponse = await axios.post('https://api.dify.ai/v1/files/upload', form, {
      headers: {
        Authorization: `Bearer ${process.env.DIFY_SECRET_KEY}`,
        ...form.getHeaders()
      },
      timeout: CONFIG.uploadTimeout
    });
    
    const txtFileId = uploadResponse.data.id;
    
    // Call main workflow
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
        timeout: CONFIG.difyTimeout
      }
    );
    
    return response.data.data;
  } finally {
    // Clean up temp file
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
}

// ============================================
// Parallel Processing with Retry
// ============================================

/**
 * Process a single chunk with retry logic
 */
export async function processChunkWithRetry(jobId, chunk, maxRetries = CONFIG.maxRetries) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await updateChunkStatus(jobId, chunk.index, 'processing');
      
      logger.debug('Processing chunk', { jobId, chunkIndex: chunk.index, attempt });
      
      const sttResult = await processChunkWithDify(chunk.path);
      
      await updateChunkStatus(jobId, chunk.index, 'completed', sttResult);
      
      return {
        index: chunk.index,
        stt: sttResult,
        success: true
      };
    } catch (error) {
      logger.warn(`Chunk ${chunk.index} processing attempt ${attempt} failed`, { 
        error: error.message,
        jobId
      });
      
      if (attempt === maxRetries) {
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
 */
export async function processChunksInParallel(jobId, chunks, maxConcurrency = CONFIG.maxConcurrency) {
  const results = new Array(chunks.length);
  const processing = [];
  let completedCount = 0;
  
  const totalChunks = chunks.length;
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    const chunkPromise = processChunkWithRetry(jobId, chunk)
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
    if (processing.length >= maxConcurrency) {
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
  
  return results;
}

// ============================================
// Main Processing Function
// ============================================

/**
 * Main async processing function for audio job
 */
export async function processAudioJob(jobId, audioFilePath, fileId, userId, companyId, staffId) {
  try {
    // Update status to processing
    await updateJobStatus(jobId, 'processing', 5, '処理を開始しています...');
    
    // Step 1: Split audio with silence detection
    await updateJobStatus(jobId, 'processing', 10, '音声ファイルを分割しています...');
    const chunks = await splitAudioWithSilenceDetection(audioFilePath);
    
    logger.info('Audio split completed', { jobId, chunkCount: chunks.length });
    
    // Step 2: Register chunks in database
    await registerChunks(jobId, chunks.length);
    await updateJobStatus(jobId, 'processing', 15, `${chunks.length}チャンクに分割完了`);
    
    // Step 3: Process chunks in parallel
    await updateJobStatus(jobId, 'processing', 20, 'STT処理を開始しています...');
    const chunkResults = await processChunksInParallel(jobId, chunks);
    
    // Step 4: Merge results
    await updateJobStatus(jobId, 'processing', 80, '結果をマージしています...');
    const combinedText = chunkResults
      .filter(r => r && r.success)
      .sort((a, b) => a.index - b.index)
      .map(r => r.stt)
      .join('\n');
    
    if (!combinedText) {
      throw new Error('STT処理に失敗しました。全てのチャンクでエラーが発生しました。');
    }
    
    // Save combined STT result
    await saveJobSttResult(jobId, combinedText);
    
    // Save text file for reference
    const txtFilePath = audioFilePath.replace(/\.(mp3|wav|m4a|flac|aac)$/i, '.csv');
    fs.writeFileSync(txtFilePath, combinedText);
    
    // Step 5: Execute Dify workflow
    await updateJobStatus(jobId, 'processing', 85, 'AIワークフローを実行しています...');
    const difyResult = await executeDifyWorkflow(combinedText);
    
    if (difyResult.status !== 'succeeded') {
      throw new Error('Difyワークフローの実行に失敗しました。');
    }
    
    const { outputs } = difyResult;
    
    // Step 6: Parse and save to records
    await updateJobStatus(jobId, 'processing', 95, 'データベースに保存しています...');
    
    // Clean and parse skillsheet
    let skillsheetData = {};
    const cleanSkillsheet = typeof outputs.skillsheet === 'string'
      ? outputs.skillsheet.replace(/```json\n?|\n?```/g, '').trim()
      : outputs.skillsheet;
    
    if (typeof cleanSkillsheet === "string") {
      try {
        skillsheetData = JSON.parse(cleanSkillsheet);
      } catch (e) {
        logger.error('Invalid JSON in skillsheet', e);
        skillsheetData = {};
      }
    } else {
      skillsheetData = cleanSkillsheet;
    }
    
    // Extract work content array
    const workContentArray = Object.values(skillsheetData).map(career => career['summary']);
    
    // Insert record
    const [recordResult] = await pool.query(
      `INSERT INTO records 
       (file_id, user_id, company_id, staff_id, audio_file_path, stt, skill_sheet, lor, salesforce, skills, hope, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        fileId,
        userId,
        companyId,
        staffId,
        audioFilePath,
        combinedText,
        outputs.skillsheet,
        outputs.lor,
        JSON.stringify(workContentArray),
        outputs.skills,
        outputs.hope
      ]
    );
    
    // Invalidate cache
    if (companyId) {
      cache.invalidatePattern(`records:company:${companyId}:*`);
      cache.invalidatePattern(`dashboard:stats:company:${companyId}`);
    }
    
    // Step 7: Clean up chunk files
    for (const chunk of chunks) {
      if (chunk.path !== audioFilePath && fs.existsSync(chunk.path)) {
        try {
          fs.unlinkSync(chunk.path);
        } catch (e) {
          logger.warn('Failed to clean up chunk file', { path: chunk.path });
        }
      }
    }
    
    // Mark job as completed
    await updateJobStatus(jobId, 'completed', 100, '処理が完了しました');
    
    logger.info('Audio job completed successfully', { 
      jobId, 
      recordId: recordResult.insertId,
      fileId
    });
    
    return {
      success: true,
      recordId: recordResult.insertId
    };
    
  } catch (error) {
    logger.error('Error processing audio job', { jobId, error: error.message });
    await updateJobStatus(jobId, 'failed', null, 'エラーが発生しました', error.message);
    
    throw error;
  }
}

/**
 * Retry a failed job
 */
export async function retryFailedJob(jobId, userId, companyId, role) {
  try {
    // Get job details
    const job = await getJobStatus(jobId, userId, role);
    
    if (!job) {
      throw new Error('Job not found or access denied');
    }
    
    if (job.status !== 'failed') {
      throw new Error('Only failed jobs can be retried');
    }
    
    // Reset job status
    await pool.query(
      `UPDATE processing_jobs 
       SET status = 'pending', progress = 0, current_step = 'リトライ準備中', 
           error_message = NULL, completed_at = NULL, updated_at = NOW()
       WHERE id = ?`,
      [jobId]
    );
    
    // Reset chunk statuses
    await pool.query(
      'UPDATE chunk_processing SET status = \'pending\', retry_count = 0, error_message = NULL WHERE job_id = ?',
      [jobId]
    );
    
    // Start processing in background
    setImmediate(() => {
      processAudioJob(jobId, job.localFilePath, job.fileId, job.userId, job.companyId, job.staffId)
        .catch(error => {
          logger.error('Error retrying job', { jobId, error: error.message });
        });
    });
    
    return { success: true, message: 'Job retry started' };
  } catch (error) {
    logger.error('Error retrying failed job', error);
    throw error;
  }
}

/**
 * Clean up old completed/failed jobs
 */
export async function cleanupOldJobs(daysToKeep = 7) {
  try {
    const [result] = await pool.query(
      `DELETE FROM processing_jobs 
       WHERE status IN ('completed', 'failed') 
       AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [daysToKeep]
    );
    
    logger.info('Old jobs cleaned up', { deletedCount: result.affectedRows });
    return result.affectedRows;
  } catch (error) {
    logger.error('Error cleaning up old jobs', error);
    return 0;
  }
}
