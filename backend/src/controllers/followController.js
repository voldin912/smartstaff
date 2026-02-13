import { pool } from '../config/database.js';
import axios from 'axios';
import pkg from 'nodejs-whisper';
import FormData from 'form-data';
const { nodewhisper } = pkg;
import fs from 'fs';
import PDFDocument from 'pdfkit';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import logger from '../utils/logger.js';
import {
  API_CONFIG,
  isRetryableStatus,
  categorizeError,
  calculateBackoff,
  sleep,
} from '../config/axiosConfig.js';


// import path from 'path'
// import { nodewhisper } from 'nodejs-whisper'

// // Need to provide exact path to your audio file.
// const filePath = path.resolve(__dirname, 'YourAudioFileName')

// await nodewhisper(filePath, {
// 	modelName: 'base.en', //Downloaded models name
// 	autoDownloadModelName: 'base.en', // (optional) auto download a model if model is not present
// 	removeWavFileAfterTranscription: false, // (optional) remove wav file once transcribed
// 	withCuda: false, // (optional) use cuda for faster processing
// 	logger: console, // (optional) Logging instance, defaults to console
// 	whisperOptions: {
// 		outputInCsv: false, // get output result in csv file
// 		outputInJson: false, // get output result in json file
// 		outputInJsonFull: false, // get output result in json file including more information
// 		outputInLrc: false, // get output result in lrc file
// 		outputInSrt: true, // get output result in srt file
// 		outputInText: false, // get output result in txt file
// 		outputInVtt: false, // get output result in vtt file
// 		outputInWords: false, // get output result in wts file for karaoke
// 		translateToEnglish: false, // translate from source language to english
// 		wordTimestamps: false, // word-level timestamps
// 		timestamps_length: 20, // amount of dialogue per timestamp pair
// 		splitOnWord: true, // split on word rather than on token
// 	},
// })

// // Model list
// const MODELS_LIST = [
// 	'tiny',
// 	'tiny.en',
// 	'base',
// 	'base.en',
// 	'small',
// 	'small.en',
// 	'medium',
// 	'medium.en',
// 	'large-v1',
// 	'large',
// 	'large-v3-turbo',
// ]

// Transcription Queue Manager
class TranscriptionQueue {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
  }

  async addToQueue(audioFilePath, options) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        audioFilePath,
        options,
        resolve,
        reject
      });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const { audioFilePath, options, resolve, reject } = this.queue.shift();

    try {
      const result = await nodewhisper(audioFilePath, options);
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.isProcessing = false;
      this.processQueue(); // Process next item in queue
    }
  }
}

const transcriptionQueue = new TranscriptionQueue();

ffmpeg.setFfmpegPath(ffmpegPath);

// Get all records (lightweight list with pagination)
const getRecords = async (req, res) => {
  try {
    const { role, company_id, id: userId } = req.user;

    // Validate pagination parameters
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    logger.debug('User info', { role, company_id, userId });
    logger.debug('Pagination params', { limit, offset });

    // Count query (no JOIN needed)
    let countQuery = `SELECT COUNT(*) as total FROM follows r`;

    // Lightweight list query - no stt (potentially megabytes)
    let query = `
      SELECT
        r.id,
        r.user_id as ownerId,
        DATE_FORMAT(r.date, '%Y-%m-%d %H:%i:%s') as date,
        r.file_id as fileId,
        r.staff_id as staffId,
        r.staff_name as staffName,
        r.summary,
        r.company_id as companyId,
        u.name as userName
      FROM follows r
      LEFT JOIN users u ON r.user_id = u.id
    `;

    const queryParams = [];
    const countParams = [];

    // Apply role-based filtering using r.company_id
    if (role === 'member') {
      // Members can see records from all users in the same company
      query += ' WHERE r.company_id = ?';
      countQuery += ' WHERE r.company_id = ?';
      queryParams.push(company_id);
      countParams.push(company_id);
      logger.debug('Filtering for member', { company_id });
    } else if (role === 'company-manager') {
      // Company managers can see records from their company
      query += ' WHERE r.company_id = ?';
      countQuery += ' WHERE r.company_id = ?';
      queryParams.push(company_id);
      countParams.push(company_id);
      logger.debug('Filtering for company-manager', { company_id });
    } else if (role === 'admin') {
      logger.debug('Admin user - no filtering applied, showing all records');
    } else {
      logger.warn('Unknown role', { role });
      query += ' WHERE r.user_id = ?';
      countQuery += ' WHERE r.user_id = ?';
      queryParams.push(userId);
      countParams.push(userId);
    }

    query += ' ORDER BY r.created_at DESC';
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    // Execute both queries in parallel
    const [records] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, countParams);

    const total = countResult[0].total;
    const hasMore = offset + records.length < total;

    logger.debug('Records found', { count: records.length, total });

    res.json({
      records: records,
      pagination: {
        total: total,
        limit: limit,
        offset: offset,
        hasMore: hasMore,
        currentPage: Math.floor(offset / limit) + 1,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching records', error);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
};

const uploadFile = async (filePath) => {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), {
    filename: filePath.split('/').pop(), // ensure filename is included
    contentType: 'audio/mpeg', // explicitly set the correct MIME type
  });
  form.append('type', 'audio');
  form.append('purpose', 'workflow_input');
  form.append('user', 'voldin012');

  const response = await axios.post('https://api.dify.ai/v1/files/upload', form, {
    headers: {
      Authorization: `Bearer ${process.env.DIFY_SECRET_KEY}`,
      ...form.getHeaders()
    }
  });

  logger.debug('API response', { data: response.data });

  return response.data.id;
}

const getTxtPathFromMp3 = (mp3Path) => {
  return mp3Path.replace(/\.(mp3|wav|m4a|flac|aac)$/i, '.csv');
}

// Upload audio file and create record
const uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { staffId, fileId } = req.body;
    let audioFilePath = req.file.path;
    const ext = path.extname(audioFilePath).toLowerCase();
    // If file is .m4a, convert to .wav
    if (ext === '.m4a') {
      const wavPath = audioFilePath.replace(/\.m4a$/i, '.mp3');
      await new Promise((resolve, reject) => {
        ffmpeg(audioFilePath)
          .toFormat('mp3')
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(wavPath);
      });
      // Optionally remove the original m4a file
      if (fs.existsSync(audioFilePath)) {
        try {
          fs.unlinkSync(audioFilePath);
          logger.debug('Original m4a file deleted', { audioFilePath });
        } catch (error) {
          logger.warn('Failed to delete original m4a file', { audioFilePath, error: error.message });
          // Continue - cleanup failure should not affect processing
        }
      }
      audioFilePath = wavPath;
    }
    
    // Function to split audio into chunks
    const splitAudioIntoChunks = async (filePath, chunkSize = 4 * 1024 * 1024) => {
      const fileBuffer = fs.readFileSync(filePath);
      const chunks = [];
      for (let i = 0; i < fileBuffer.length; i += chunkSize) {
        chunks.push(fileBuffer.slice(i, i + chunkSize));
      }
      return chunks;
    };

    // Function to process a single chunk with retry logic
    const processChunk = async (chunk, index) => {
      const tempFilePath = `${audioFilePath}_chunk_${index}.mp3`;
      fs.writeFileSync(tempFilePath, chunk);
      const maxRetries = API_CONFIG.dify.maxRetries;

      try {
        const tempFileId = await uploadFile(tempFilePath);
        
        // Process chunk with Dify workflow - with retry logic
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const difyResponse = await axios.post(
              'https://api.dify.ai/v1/workflows/run',
              {
                inputs: {
                  "audioFile": {
                    "transfer_method": "local_file",
                    "upload_file_id": tempFileId,
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
                timeout: API_CONFIG.dify.workflowTimeout
              }
            );

            // Clean up temp file on success
            if (fs.existsSync(tempFilePath)) {
              try {
                fs.unlinkSync(tempFilePath);
                logger.debug('Chunk temp file deleted', { tempFilePath });
              } catch (unlinkError) {
                logger.warn('Failed to delete chunk temp file', { tempFilePath, error: unlinkError.message });
              }
            }
            
            return difyResponse.data.data.outputs.stt;
          } catch (error) {
            lastError = error;
            const errorCode = categorizeError(error, 'workflow');
            const httpStatus = error.response?.status;
            
            logger.warn(`Follow chunk ${index} attempt ${attempt}/${maxRetries} failed`, {
              errorCode,
              httpStatus,
              message: error.message
            });
            
            // Check if we should retry
            const shouldRetry = attempt < maxRetries && 
              (isRetryableStatus(httpStatus) || !error.response);
            
            if (shouldRetry) {
              const delay = calculateBackoff(attempt);
              logger.debug(`Retrying follow chunk in ${delay}ms`, { index, attempt });
              await sleep(delay);
            }
          }
        }
        
        // All retries exhausted
        const errorCode = categorizeError(lastError, 'workflow');
        logger.error(`Follow chunk ${index} failed after all retries`, { errorCode });
        throw lastError;
        
      } catch (error) {
        logger.error(`Error processing follow chunk ${index}`, { error: error.message });
        // Clean up temp file on error
        if (fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkError) {
            logger.warn('Failed to delete chunk temp file on error', { tempFilePath, error: unlinkError.message });
          }
        }
        return '';
      }
    };

    // Split audio into chunks and process them
    const chunks = await splitAudioIntoChunks(audioFilePath);
    
    // Process chunks sequentially with waiting time between each chunk
    const chunkResults = [];
    for (let i = 0; i < chunks.length; i++) {
      const result = await processChunk(chunks[i], i);
      chunkResults.push(result);
      
      // Wait 0.5 seconds between each chunk processing
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Combine all chunk results
    logger.debug('Chunk processing', { chunkCount: chunks.length });
    const combinedText = chunkResults.join('\n');
    logger.debug('Combined text length', { length: combinedText?.length || 0 });
    const txtFilePath = getTxtPathFromMp3(audioFilePath);
    fs.writeFileSync(txtFilePath, combinedText);

    // Process combined text with main Dify workflow
    try {
      const txtFileId = await uploadFile(txtFilePath);
      
      // Retry logic for Dify API calls using unified config
      let difyResponse;
      let lastError = null;
      const maxRetries = API_CONFIG.dify.maxRetries;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          difyResponse = await axios.post(
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
              timeout: API_CONFIG.dify.workflowTimeout
            }
          );
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error;
          const errorCode = categorizeError(error, 'workflow');
          const httpStatus = error.response?.status;
          
          logger.warn(`Dify API attempt ${attempt}/${maxRetries} failed`, { 
            errorCode,
            httpStatus,
            message: error.message 
          });
          
          // Check if we should retry
          const shouldRetry = attempt < maxRetries && 
            (isRetryableStatus(httpStatus) || !error.response);
          
          if (!shouldRetry) {
            throw error; // Don't retry non-retryable errors
          }
          
          if (attempt < maxRetries) {
            // Wait before retry (exponential backoff)
            const waitTime = calculateBackoff(attempt);
            logger.debug(`Waiting ${waitTime}ms before retry ${attempt + 1}`);
            await sleep(waitTime);
          } else {
            throw error; // Re-throw the error if all retries failed
          }
        }
      }

      const {status, outputs } = difyResponse.data.data;
      logger.debug('Dify outputs', { outputs });
      if (status === 'succeeded') {
        // Insert record into database
        // Note: summary will be populated by a follow-specific Dify workflow in a future step
        const query = `
        INSERT INTO follows (file_id, user_id, company_id, staff_id, audio_file_path, stt, date)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;

        const userId = req.user.id;
        const companyId = req.user.company_id;
        const [result] = await pool.query(query, [
          fileId,
          userId,
          companyId,
          staffId,
          audioFilePath,
          combinedText
        ]);

        // Return the created record with formatted date
        const [newRecord] = await pool.query(
          `SELECT 
            id, 
            DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') as date,
            file_id as fileId, 
            staff_id as staffId,
            staff_name as staffName,
            summary,
            company_id as companyId
          FROM follows 
          WHERE id = ?`,
          [result.insertId]
        );

        res.status(200).json(newRecord[0]);
      } else {
        logger.debug('Dify response outputs', { outputs: difyResponse.data.data.outputs });
        res.status(500).json({ message: 'Failed to get response from Dify' });
      }
    } catch (difyError) {
      logger.error('Error calling Dify API', difyError);
      
      if (difyError.code === 'ECONNABORTED' || difyError.response?.status === 504) {
        res.status(504).json({ 
          error: 'Dify API Timeout',
          message: 'The Dify API took too long to respond. Please try again with a smaller file or contact support.',
          details: 'Gateway timeout - the server did not respond within the expected time'
        });
      } else if (difyError.response) {
        res.status(difyError.response.status).json({ 
          error: 'Dify API Error',
          message: `Dify API returned error: ${difyError.response.status} ${difyError.response.statusText}`,
          details: difyError.response.data
        });
      } else {
        res.status(500).json({ 
          error: 'Failed to process audio file',
          message: 'An unexpected error occurred while processing the audio file',
          details: difyError.message
        });
      }
    }
  } catch (error) {
    logger.error('Error uploading audio', error);
    res.status(500).json({ error: 'Failed to upload audio file' });
  }
};

const downloadSTT = async (req, res) => {
  try {
    const { recordId } = req.params;
    // Get STT data and file_id from database
    const [records] = await pool.query(
      'SELECT stt, file_id FROM follows WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const sttData = records[0].stt;
    const fileId = records[0].file_id;
    // Create PDF
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    // Encode the filename to handle special characters
    const encodedFilename = encodeURIComponent(`STT-${fileId}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    doc.pipe(res);
    doc.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    const paragraphs = sttData
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter(p => p.trim() !== '');
    doc.font('NotoSansJP').fontSize(12);
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) doc.moveDown();
      doc.text(paragraph, {
        align: 'left',
        lineGap: 5,
        features: ['kern', 'liga'],
        encoding: 'utf8'
      });
    });
    doc.end();
  } catch (error) {
    logger.error('Error downloading STT', error);
    res.status(500).json({ error: 'Failed to download STT' });
  }
};

const updateStaffId = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { staffId } = req.body;

    if (!staffId) {
      return res.status(400).json({ error: 'staffId is required' });
    }

    // Permission check scoped by company_id
    let permissionQuery = 'SELECT id, company_id FROM follows WHERE id = ?';
    const permissionParams = [recordId];

    if (role === 'member' || role === 'company-manager') {
      permissionQuery += ' AND company_id = ?';
      permissionParams.push(company_id);
    }
    // Admin can edit all records - no additional condition

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    const [result] = await pool.query(
      'UPDATE follows SET staff_id = ? WHERE id = ?',
      [staffId, recordId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating staffId', error);
    res.status(500).json({ error: 'Failed to update staffId' });
  }
};

// Update staff name
const updateStaffName = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { staffName } = req.body;

    if (typeof staffName !== 'string') {
      return res.status(400).json({ error: 'Invalid staff name data' });
    }

    // Permission check scoped by company_id
    let permissionQuery = 'SELECT id, company_id FROM follows WHERE id = ?';
    const permissionParams = [recordId];

    if (role === 'member' || role === 'company-manager') {
      permissionQuery += ' AND company_id = ?';
      permissionParams.push(company_id);
    }

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    const [result] = await pool.query(
      'UPDATE follows SET staff_name = ? WHERE id = ?',
      [staffName, recordId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating staff name', error);
    res.status(500).json({ error: 'Failed to update staff name' });
  }
};

// Update summary
const updateSummary = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { summary } = req.body;

    if (typeof summary !== 'string') {
      return res.status(400).json({ error: 'Invalid summary data' });
    }

    if (summary.length > 30000) {
      return res.status(400).json({ error: 'Summary exceeds 30000 character limit' });
    }

    // Permission check scoped by company_id
    let permissionQuery = 'SELECT id, company_id FROM follows WHERE id = ?';
    const permissionParams = [recordId];

    if (role === 'member' || role === 'company-manager') {
      permissionQuery += ' AND company_id = ?';
      permissionParams.push(company_id);
    }

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    const [result] = await pool.query(
      'UPDATE follows SET summary = ? WHERE id = ?',
      [summary, recordId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating summary', error);
    res.status(500).json({ error: 'Failed to update summary' });
  }
};

// Delete record with role-based permissions
const deleteRecord = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;

    let query = `
      SELECT r.id, r.company_id as recordCompanyId, r.user_id as ownerId, r.audio_file_path
      FROM follows r
      WHERE r.id = ?
    `;
    const queryParams = [recordId];

    // Apply role-based access control
    if (role === 'member') {
      // Members can only delete their own records
      query += ' AND r.user_id = ?';
      queryParams.push(userId);
    } else if (role === 'company-manager') {
      // Company managers can delete records from their company
      query += ' AND r.company_id = ?';
      queryParams.push(company_id);
    } else if (role === 'admin') {
      // Admin can delete all records - no additional WHERE condition
    } else {
      // Unknown role - default to member behavior
      query += ' AND r.user_id = ?';
      queryParams.push(userId);
    }

    const [records] = await pool.query(query, queryParams);

    if (records.length === 0) {
      return res.status(404).json({ error: 'レコードが見つからないか、削除する権限がありません。' });
    }

    // Get audio_file_path before deletion
    const audioFilePath = records[0].audio_file_path;

    // Delete the audio file if it exists
    if (audioFilePath && fs.existsSync(audioFilePath)) {
      try {
        fs.unlinkSync(audioFilePath);
        logger.debug('Audio file deleted', { recordId, audioFilePath });
      } catch (fileError) {
        // Log error but don't fail the deletion if file deletion fails
        logger.warn('Failed to delete audio file', { recordId, audioFilePath, error: fileError.message });
      }
    }

    // Delete the record
    await pool.query('DELETE FROM follows WHERE id = ?', [recordId]);

    logger.debug('Follow record deleted', { recordId });

    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (error) {
    logger.error('Error deleting record', error);
    res.status(500).json({ error: 'Failed to delete record' });
  }
};

// Get prompt
const getPrompt = async (req, res) => {
  try {
    const { role, company_id } = req.user;
    
    // For now, we'll store prompt per company (or use a default)
    // You may want to create a prompts table or store in a config table
    // For simplicity, returning a default prompt that can be stored in environment or database
    const defaultPrompt = process.env.DEFAULT_SUMMARY_PROMPT || '';
    
    res.json({ prompt: defaultPrompt });
  } catch (error) {
    logger.error('Error fetching prompt', error);
    res.status(500).json({ error: 'Failed to fetch prompt' });
  }
};

// Update prompt
const updatePrompt = async (req, res) => {
  try {
    const { prompt } = req.body;
    const { role, company_id } = req.user;
    
    // For now, we'll just return success
    // You may want to store this in a database table (e.g., prompts table with company_id)
    // TODO: Implement database storage for prompts
    
    res.json({ success: true, message: 'Prompt updated successfully' });
  } catch (error) {
    logger.error('Error updating prompt', error);
    res.status(500).json({ error: 'Failed to update prompt' });
  }
};

export {
  getRecords,
  uploadAudio,
  downloadSTT,
  updateStaffId,
  updateStaffName,
  updateSummary,
  deleteRecord,
  getPrompt,
  updatePrompt
};
