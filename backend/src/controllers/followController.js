import { pool } from '../config/database.js';
import axios from 'axios';
import pkg from 'nodejs-whisper';
import FormData from 'form-data';
const { nodewhisper } = pkg;
import fs from 'fs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import logger from '../utils/logger.js';
import {
  API_CONFIG,
  ERROR_CODES,
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

// Get all records
const getRecords = async (req, res) => {
  try {
    const { role, company_id, id: userId } = req.user;
    
    logger.debug('User info', { role, company_id, userId });
    
    let query = `
      SELECT 
        r.id, 
        DATE_FORMAT(r.date, '%Y-%m-%d %H:%i:%s') as date,
        r.file_id as fileId, 
        r.staff_id as staffId, 
        r.stt,
        r.skill_sheet as skillSheet,
        r.lor,
        r.salesforce as salesforce,
        r.skills,
        r.audio_file_path as audioFilePath,
        u.name as userName,
        r.hope as hope
      FROM follows r
      LEFT JOIN users u ON r.user_id = u.id
    `;

    const queryParams = [];

    // Apply role-based filtering
    if (role === 'member') {
      // Members can only see their own records
      query += ' WHERE r.user_id = ?';
      queryParams.push(userId);
      logger.debug('Filtering for member', { user_id: userId });
    } else if (role === 'company-manager') {
      // Company managers can see records from their company
      // Note: follows table doesn't have company_id yet, so keep using JOIN for now
      // This will be updated in a future migration
      query += ' WHERE u.company_id = ?';
      queryParams.push(company_id);
      logger.debug('Filtering for company-manager', { company_id });
    } else if (role === 'admin') {
      logger.debug('Admin user - no filtering applied, showing all records');
      // For admin, we want to see all records, so no WHERE clause
    } else {
      logger.warn('Unknown role', { role });
      // Default to showing only user's own records for unknown roles
      query += ' WHERE r.user_id = ?';
      queryParams.push(userId);
    }

    query += ' ORDER BY r.created_at DESC';
    
    logger.debug('Final query', { query });
    logger.debug('Query params', { queryParams });

    const [records] = await pool.query(query, queryParams);
    logger.debug('Records found', { count: records.length });
    
    res.json(records);
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

const testAPI = async (req, res) => {
  logger.debug('testAPI called');
  const txtFilePath = 'C:/Users/ALPHA/BITREP/auth-crud/backend/uploads/audio/1747786259632-912707972.wav.csv';
  const fileId = await uploadFile(txtFilePath);
  const difyResponse = await axios.post(
    'https://api.dify.ai/v1/workflows/run',
    {
      inputs: {
        "txtFile": {
          "transfer_method": "local_file",
          "upload_file_id": fileId,
          "type": "document"
        }
      },
      user: 'voldin912'
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.DIFY_SECRET_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );
  logger.debug('Dify response', { response: difyResponse });
  const {status, outputs } = difyResponse.data.data;
  if (status === 'succeeded') {
    logger.debug('Dify outputs response', { response: outputs.response });
    res.json({ message: outputs.response });
  }
  else {
    res.json({ message: 'Failed to get response from Dify' });
  }
};

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
      let skillsheetData = {};
      if (status === 'succeeded') {
        // Clean and parse skillsheet if it's a string
        const cleanSkillsheet = typeof outputs.skillsheet === 'string' 
          ? outputs.skillsheet.replace(/```json\n?|\n?```/g, '').trim()
          : outputs.skillsheet;
        
          if (typeof cleanSkillsheet === "string") {
            try {
              skillsheetData = JSON.parse(cleanSkillsheet);
            } catch (e) {
              logger.error('Invalid JSON in cleanSkillsheet', e);
              skillsheetData = {}; // or null / fallback value
            }
          } else {
            skillsheetData = cleanSkillsheet;
          }
        
        // Extract work content array from skillsheet
        const workContentArray = Object.values(skillsheetData).map(career => career['summary']);
        logger.debug('Work content array', { workContentArray });
        logger.debug('Outputs skills', { skills: outputs.skills });

        // Insert record into database
        const query = `
        INSERT INTO follows (file_id, user_id, staff_id, audio_file_path, stt, skill_sheet, lor, salesforce, skills, hope, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

        const userId = req.user.id; // Get user ID from auth
        const [result] = await pool.query(query, [
          fileId, 
          userId,  // user_id references users table
          staffId, // staff_id for Salesforce integration
          audioFilePath, 
          combinedText, 
          outputs.skillsheet, 
          outputs.lor,
          JSON.stringify(workContentArray),
          outputs.skills,
          outputs.hope
        ]);

        // Return the created record with formatted date
        const [newRecord] = await pool.query(
          `SELECT 
            id, 
            DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') as date,
            file_id as fileId, 
            staff_id as staffId, 
            audio_file_path as audioFilePath,
            stt,
            skill_sheet as skillSheet,
            lor,
            salesforce as salesforce
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

// Helper to draw a solid horizontal line
function drawSolidLine(doc, shouldStroke = false) {
  const { left, right } = doc.page.margins;
  const y = doc.y + 5;
  if(shouldStroke) {
    doc.lineWidth(1);
    doc.moveTo(left, y).lineTo(doc.page.width - right, y).stroke();
  }
  else {
    doc.lineWidth(0.5);
    doc.moveTo(left, y).lineTo(doc.page.width - right, y).stroke();
  }
  doc.moveDown(0.5);
}

const downloadSkillSheet = async (req, res) => {
  try {
    const { recordId } = req.params;
    const [records] = await pool.query(
      'SELECT skill_sheet, file_id, staff_id, skills FROM follows WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    // Clean and parse skillsheet if it's a string
    const cleanSkillsheet = typeof records[0].skill_sheet === 'string' 
      ? records[0].skill_sheet.replace(/```json\n?|\n?```/g, '').trim()
      : records[0].skill_sheet;

    let skillSheet = {}

    if (typeof cleanSkillsheet === "string") {
      try {
        skillSheet = JSON.parse(cleanSkillsheet);
      } catch (e) {
        logger.error('Invalid JSON in cleanSkillsheet', e);
        skillSheet = {}; // or null / fallback value
      }
    } else {
      skillSheet = cleanSkillsheet;
    }
    
    const fileId = records[0].file_id;
    const staffId = records[0].staff_id;
    // Parse and clean skills JSON
    let cleanSkillsData = null;
    try {
      if (typeof records[0].skills === 'string') {
        const cleaned = records[0].skills.replace(/```json\n?|\n?```/g, '').trim();
        cleanSkillsData = JSON.parse(cleaned);
      } else {
        cleanSkillsData = records[0].skills;
      }
    } catch (e) {
      cleanSkillsData = null;
    }

    // Create PDF with wider content area
    const doc = new PDFDocument({ 
      size: 'A4',
      margins: { 
        top: 100,
        bottom: 100,
        left: 40,
        right: 40
      }
    });
    res.setHeader('Content-Type', 'application/pdf');
    // Encode the filename to handle special characters
    const encodedFilename = encodeURIComponent(`スキルシート-${fileId}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    doc.pipe(res);
    doc.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');

    // Title - Centered
    doc.font('NotoSansJP').fontSize(16).text('Personal Data Sheet', { align: 'center' });
    doc.moveDown();

    // Profile Section
    doc.fontSize(12);
    drawSolidLine(doc);
    doc.text('＋＋プロフィール＋＋');
    drawSolidLine(doc);
    doc.text(`■氏名：${staffId}`);
    drawSolidLine(doc, true);

    // Career History Section
    doc.text('■経歴詳細');
    drawSolidLine(doc);
    doc.moveDown();

    // Career entries
    Object.keys(skillSheet).forEach((key, idx) => {
      const c = skillSheet[key];
      doc.text(`[期間]${c.from}～${c.to}`);
      doc.text(`[雇用形態]${c['employee type']}`);
      doc.text('[経験職種]');
      if (c['work content']) {
        const experiences = c['work content'];
        // Handle both string and array formats
        if (Array.isArray(experiences)) {
          experiences.forEach(exp => {
            if (exp && exp.trim()) {
              doc.text(`  ${exp.trim()}`);
            }
          });
        } else if (typeof experiences === 'string') {
          // Split by newlines if it's a string
          const expArray = experiences.split('\n').filter(exp => exp.trim());
          expArray.forEach(exp => {
            doc.text(`  ${exp.trim()}`);
          });
        }
      } else {
        doc.text('  なし');
      }
      drawSolidLine(doc, true);
    });

    // Skills Section
    if (cleanSkillsData) {
      doc.addPage();
      drawSolidLine(doc, true);
      doc.font('NotoSansJP').fontSize(14).text('＋＋語学力・資格・スキル＋＋');
      drawSolidLine(doc);
      doc.moveDown();

      // Language Skills
      doc.font('NotoSansJP').fontSize(12).text('■語学力');
      if (Array.isArray(cleanSkillsData['語学力']) && cleanSkillsData['語学力'].length > 0) {
        cleanSkillsData['語学力'].forEach(lang => {
          if (lang.言語 || lang.レベル) {
            doc.text(`  ${lang.言語 ? '言語：' + lang.言語 : ''}${lang.レベル ? '　レベル：' + lang.レベル : ''}`);
          }
        });
      } else {
        doc.text('  なし');
      }
      doc.moveDown(0.5);

      // Qualifications
      doc.font('NotoSansJP').fontSize(12).text('■資格');
      if (Array.isArray(cleanSkillsData['資格']) && cleanSkillsData['資格'].length > 0 && cleanSkillsData['資格'].some(q => q && q.trim() !== '')) {
        doc.text('  ' + cleanSkillsData['資格'].filter(q => q && q.trim() !== '').join('、'));
      } else {
        doc.text('  なし');
      }
      doc.moveDown(0.5);

      // Skills
      doc.font('NotoSansJP').fontSize(12).text('■スキル');
      if (cleanSkillsData['スキル']) {
        // Split the skills string by newlines and add each skill on a new line
        const skills = cleanSkillsData['スキル'];
        doc.text(skills);
      } else {
        doc.text('  なし');
      }
      doc.moveDown(2);

      // Footer note
      doc.font('NotoSansJP').fontSize(10).text('株式会社レゾナゲート', { indent: 10, align: 'center' });
      doc.fillColor('black');
    }

    doc.end();
  } catch (error) {
    logger.error('Error downloading skill sheet', error);
    res.status(500).json({ error: 'Failed to download skill sheet' });
  }
};

const updateStaffId = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { staffId } = req.body;
    if (!staffId) {
      return res.status(400).json({ error: 'staffId is required' });
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

const updateSkillSheet = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { skill_sheet, skills } = req.body;
    logger.debug('Updating skill sheet', { skillSheet: skill_sheet, skills });
    if (!skill_sheet || typeof skill_sheet !== 'object') {
      return res.status(400).json({ error: 'Invalid skill sheet data' });
    }
    const [result] = await pool.query(
      'UPDATE follows SET skill_sheet = ?, skills = ? WHERE id = ?',
      [JSON.stringify(skill_sheet), JSON.stringify(skills), recordId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating skill sheet', error);
    res.status(500).json({ error: 'Failed to update skill sheet' });
  }
};

const getSkillSheet = async (req, res) => {
  try {
    const { recordId } = req.params;
    const [records] = await pool.query('SELECT skill_sheet FROM follows WHERE id = ?', [recordId]);
    res.json(records[0].skill_sheet);
  } catch (error) {
    logger.error('Error getting skill sheet', error);
    res.status(500).json({ error: 'Failed to get skill sheet' });
  }
};

const updateSalesforce = async (req, res) => {
  try {
    const { recordId } = req.params;
    const {salesforceData, hope} = req.body;
    // console.log("salesforceData", salesforceData);  
    if (!Array.isArray(salesforceData)) {
      return res.status(400).json({ error: 'Invalid salesforce data' });
    }
    const [result] = await pool.query(
      'UPDATE follows SET salesforce = ?, hope = ? WHERE id = ?',
      [JSON.stringify(salesforceData), hope, recordId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating salesforce data', error);
    res.status(500).json({ error: 'Failed to update salesforce data' });
  }
};

const downloadSalesforce = async (req, res) => {
  try {
    const { recordId } = req.params;
    // Get salesforce data and file_id from database
    const [records] = await pool.query(
      'SELECT salesforce, file_id, hope FROM follows WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const salesforceArr = JSON.parse(records[0].salesforce || '[]');
    const fileId = records[0].file_id;
    const hope = records[0].hope;

    // Create PDF
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });
    res.setHeader('Content-Type', 'application/pdf');
    // Encode the filename to handle special characters
    const encodedFilename = encodeURIComponent(`セールスフォース-${fileId}.pdf`);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    doc.pipe(res);

    // Register and use Japanese font
    doc.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    doc.font('NotoSansJP').fontSize(16).text('セールスフォース', { align: 'center' });
    doc.moveDown();

    // Add career history
    salesforceArr.forEach((content, idx) => {
      doc.font('NotoSansJP').fontSize(12).text(`経歴 ${idx + 1}`, { underline: true });
      doc.moveDown(0.2);
      doc.font('NotoSansJP').fontSize(12).text(content);
      doc.moveDown();
    });

    // Add hope data if it exists
    if (hope) {
      doc.font('NotoSansJP').fontSize(14).text('スタッフ希望条件', { underline: true });
      doc.moveDown(0.2);
      doc.font('NotoSansJP').fontSize(12).text(hope);
      doc.moveDown(2); // Add more space after hope data
    }

    doc.end();
  } catch (error) {
    logger.error('Error downloading Salesforce', error);
    res.status(500).json({ error: 'Failed to download Salesforce PDF' });
  }
};

const downloadBulk = async (req, res) => {
  try {
    const { recordId } = req.params;
    // Get record info
    const [records] = await pool.query(
      'SELECT file_id, audio_file_path, skill_sheet, salesforce, staff_id, skills, stt, hope FROM follows WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const { file_id, audio_file_path, skill_sheet, salesforce, staff_id, skills, stt, hope } = records[0];
    
    // Clean and parse skillsheet if it's a string
    const cleanSkillsheet = typeof skill_sheet === 'string' 
      ? skill_sheet.replace(/```json\n?|\n?```/g, '').trim()
      : skill_sheet;

    let skillSheetObj = {};

    if (typeof cleanSkillsheet === "string") {
      try {
        skillSheetObj = JSON.parse(cleanSkillsheet);
      } catch (e) {
        logger.error('Invalid JSON in cleanSkillsheet', e);
        skillSheetObj = {}; // or null / fallback value
      }
    } else {
      skillSheetObj = cleanSkillsheet;
    }

    // Parse skills JSON
    let skillsData = null;
    try {
      if (typeof skills === 'string') {
        const cleanedSkills = skills.replace(/```json\n?|\n?```/g, '').trim();
        skillsData = JSON.parse(cleanedSkills);
      } else {
        skillsData = skills;
      }
    } catch (e) {
      logger.error('Error parsing skills data', e);
      skillsData = null;
    }

    // Prepare archive
    res.setHeader('Content-Type', 'application/zip');
    // Encode the filename to handle special characters
    const encodedFilename = encodeURIComponent(`一括データ-${file_id}.zip`);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
    
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    // Handle archive errors
    archive.on('error', (err) => {
      logger.error('Archive error', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to create archive' });
      }
    });

    // Pipe archive to response
    archive.pipe(res);

    // 1. Add audio file
    if (audio_file_path && fs.existsSync(audio_file_path)) {
      archive.file(audio_file_path, { name: `audio_${file_id}${path.extname(audio_file_path)}` });
    }

    // 2. Add STT PDF
    const sttPDF = new PDFDocument({
      size: 'A4',
      margins: {
        top: 50,
        bottom: 50,
        left: 50,
        right: 50
      }
    });
    sttPDF.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    const paragraphs = stt
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter(p => p.trim() !== '');
    sttPDF.font('NotoSansJP').fontSize(12);
    paragraphs.forEach((paragraph, index) => {
      if (index > 0) sttPDF.moveDown();
      sttPDF.text(paragraph, {
        align: 'left',
        lineGap: 5,
        features: ['kern', 'liga'],
        encoding: 'utf8'
      });
    });
    sttPDF.end();
    archive.append(sttPDF, { name: `STT-${file_id}.pdf` });

    // 3. Add skillsheet PDF
    const skillSheetPDF = new PDFDocument({ 
      size: 'A4',
      margins: { 
        top: 100,
        bottom: 100,
        left: 40,
        right: 40
      }
    });
    skillSheetPDF.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');

    // Title - Centered
    skillSheetPDF.font('NotoSansJP').fontSize(16).text('Personal Data Sheet', { align: 'center' });
    skillSheetPDF.moveDown();

    // Profile Section
    skillSheetPDF.fontSize(12);
    drawSolidLine(skillSheetPDF);
    skillSheetPDF.text('＋＋プロフィール＋＋');
    drawSolidLine(skillSheetPDF);
    skillSheetPDF.text(`■氏名：${staff_id}`);
    drawSolidLine(skillSheetPDF, true);

    // Career History Section
    skillSheetPDF.text('■経歴詳細');
    drawSolidLine(skillSheetPDF);
    skillSheetPDF.moveDown();

    // Career entries
    Object.keys(skillSheetObj).forEach((key, idx) => {
      const c = skillSheetObj[key];
      skillSheetPDF.text(`[期間]${c.from}～${c.to}`);
      skillSheetPDF.text(`[雇用形態]${c['employee type']}`);
      skillSheetPDF.text('[経験職種]');
      if (c['work content']) {
        const experiences = c['work content'];
        skillSheetPDF.text(`${experiences}`);
      } else {
        skillSheetPDF.text('なし');
      }
      drawSolidLine(skillSheetPDF, true);
    });

    // Skills Section
    if (skillsData) {
      skillSheetPDF.addPage();
      drawSolidLine(skillSheetPDF, true);
      skillSheetPDF.font('NotoSansJP').fontSize(14).text('＋＋語学力・資格・スキル＋＋');
      drawSolidLine(skillSheetPDF);
      skillSheetPDF.moveDown();

      // Language Skills
      skillSheetPDF.font('NotoSansJP').fontSize(12).text('■語学力');
      if (Array.isArray(skillsData['語学力']) && skillsData['語学力'].length > 0) {
        skillsData['語学力'].forEach(lang => {
          if (lang.言語 || lang.レベル) {
            skillSheetPDF.text(`  ${lang.言語 ? '言語：' + lang.言語 : ''}${lang.レベル ? '　レベル：' + lang.レベル : ''}`);
          }
        });
      } else {
        skillSheetPDF.text('  なし');
      }
      skillSheetPDF.moveDown(0.5);

      // Qualifications
      skillSheetPDF.font('NotoSansJP').fontSize(12).text('■資格');
      if (Array.isArray(skillsData['資格']) && skillsData['資格'].length > 0 && skillsData['資格'].some(q => q && q.trim() !== '')) {
        skillSheetPDF.text('  ' + skillsData['資格'].filter(q => q && q.trim() !== '').join('、'));
      } else {
        skillSheetPDF.text('  なし');
      }
      skillSheetPDF.moveDown(0.5);

      // Skills
      skillSheetPDF.font('NotoSansJP').fontSize(12).text('■スキル');
      if (skillsData['スキル']) {
        // Split the skills string by newlines and add each skill on a new line
        const skills = typeof skillsData['スキル'] === 'string' && skillsData['スキル'].includes('\n')
          ? skillsData['スキル'].split('\n')
          : Array.isArray(skillsData['スキル']) 
            ? skillsData['スキル']
            : [];
        skills.forEach(skill => {
          if (skill && skill.trim()) {
            skillSheetPDF.text('  ' + skill.trim());
          }
        });
      } else {
        skillSheetPDF.text('  なし');
      }
      skillSheetPDF.moveDown(2);

      // Footer note
      skillSheetPDF.font('NotoSansJP').fontSize(10).text('株式会社レゾナゲート', { indent: 10, align: 'center' });
      skillSheetPDF.fillColor('black');
    }
    skillSheetPDF.end();
    archive.append(skillSheetPDF, { name: `スキルシート-${file_id}.pdf` });

    // 4. Add salesforce PDF
    const salesforceArr = JSON.parse(salesforce || '[]');
    const salesforcePDF = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });
    salesforcePDF.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    salesforcePDF.font('NotoSansJP').fontSize(16).text('セールスフォース', { align: 'center' });
    salesforcePDF.moveDown();

    // Add career history
    salesforceArr.forEach((content, idx) => {
      salesforcePDF.font('NotoSansJP').fontSize(12).text(`経歴 ${idx + 1}`, { underline: true });
      salesforcePDF.moveDown(0.2);
      salesforcePDF.font('NotoSansJP').fontSize(12).text(content);
      salesforcePDF.moveDown();
    });

    // Add hope data if it exists
    if (hope) {
      salesforcePDF.font('NotoSansJP').fontSize(14).text('スタッフ希望条件', { underline: true });
      salesforcePDF.moveDown(0.2);
      salesforcePDF.font('NotoSansJP').fontSize(12).text(hope);
      salesforcePDF.moveDown(2);
    }

    salesforcePDF.end();
    archive.append(salesforcePDF, { name: `セールスフォース-${file_id}.pdf` });

    // Finalize archive
    await archive.finalize();
  } catch (error) {
    logger.error('Error downloading bulk', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download bulk zip' });
    }
  }
};

const updateLoR = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { lor } = req.body;

    if (typeof lor !== 'string') {
      return res.status(400).json({ error: 'Invalid LoR data' });
    }

    const [result] = await pool.query(
      'UPDATE follows SET lor = ? WHERE id = ?',
      [lor, recordId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error updating LoR', error);
    res.status(500).json({ error: 'Failed to update LoR' });
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
  testAPI,
  downloadSTT,
  downloadSkillSheet,
  updateStaffId,
  updateSkillSheet,
  getSkillSheet,
  updateSalesforce,
  downloadSalesforce,
  downloadBulk,
  updateLoR,
  getPrompt,
  updatePrompt
};
