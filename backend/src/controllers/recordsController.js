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

// Get all records with pagination
const getRecords = async (req, res) => {
  try {
    const { role, company_id, id: userId } = req.user;
    
    // Get pagination parameters from query string
    const limit = parseInt(req.query.limit) || 50; // Default 50 records per page
    const offset = parseInt(req.query.offset) || 0; // Default start from 0
    
    // Validate pagination parameters
    if (limit < 1 || limit > 200) {
      return res.status(400).json({ error: 'Limit must be between 1 and 200' });
    }
    if (offset < 0) {
      return res.status(400).json({ error: 'Offset must be 0 or greater' });
    }

    console.log('User info:', { role, company_id, userId });
    console.log('Pagination params:', { limit, offset });

    // Build base query for counting total records (no JOIN needed for counting)
    let countQuery = `
      SELECT COUNT(*) as total
      FROM records r
    `;
    
    // Build main query for fetching records (lightweight fields only)
    // JOIN only needed for userName field
    let query = `
      SELECT 
        r.id, 
        r.staff_id as ownerId,
        DATE_FORMAT(r.date, '%Y-%m-%d %H:%i:%s') as date,
        r.file_id as fileId, 
        r.employee_id as staffId, 
        r.staff_name as staffName,
        r.memo,
        r.company_id as companyId,
        u.name as userName
      FROM records r
      LEFT JOIN users u ON r.staff_id = u.id
    `;

    const queryParams = [];
    const countParams = [];

    // Apply role-based filtering using r.company_id (no JOIN needed)
    if (role === 'member') {
      // Members can see records from all users in the same company
      query += ' WHERE r.company_id = ?';
      countQuery += ' WHERE r.company_id = ?';
      queryParams.push(company_id);
      countParams.push(company_id);
      console.log('Filtering for member - company_id:', company_id);
    } else if (role === 'company-manager') {
      // Company managers can see records from their company
      query += ' WHERE r.company_id = ?';
      countQuery += ' WHERE r.company_id = ?';
      queryParams.push(company_id);
      countParams.push(company_id);
      console.log('Filtering for company-manager - company_id:', company_id);
    } else if (role === 'admin') {
      console.log('Admin user - no filtering applied, showing all records');
      // For admin, we want to see all records, so no WHERE clause
    } else {
      console.log('Unknown role:', role);
      // Default to showing only user's own records for unknown roles
      query += ' WHERE r.staff_id = ?';
      countQuery += ' WHERE r.staff_id = ?';
      queryParams.push(userId);
      countParams.push(userId);
    }

    query += ' ORDER BY r.date DESC';
    query += ' LIMIT ? OFFSET ?';
    queryParams.push(limit, offset);

    console.log('Final query:', query);
    console.log('Query params:', queryParams);

    // Execute both queries in parallel
    const [records] = await pool.query(query, queryParams);
    const [countResult] = await pool.query(countQuery, countParams);
    
    const total = countResult[0].total;
    const hasMore = offset + records.length < total;

    console.log('Records found:', records.length, 'Total:', total);

    // Return paginated response
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
    console.error('Error fetching records:', error);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
};

// Get single record detail with all fields
const getRecordDetail = async (req, res) => {
  try {
    const { role, company_id, id: userId } = req.user;
    const recordId = parseInt(req.params.recordId);

    if (!recordId || isNaN(recordId)) {
      return res.status(400).json({ error: 'Invalid record ID' });
    }

    console.log('Fetching record detail:', { recordId, role, company_id, userId });

    // Build query for fetching full record detail
    let query = `
      SELECT 
        r.id, 
        r.staff_id as ownerId,
        DATE_FORMAT(r.date, '%Y-%m-%d %H:%i:%s') as date,
        r.file_id as fileId, 
        r.employee_id as staffId, 
        r.staff_name as staffName,
        r.memo,
        r.stt,
        r.skill_sheet as skillSheet,
        r.lor,
        r.salesforce as salesforce,
        r.skills,
        r.audio_file_path as audioFilePath,
        r.company_id as companyId,
        u.name as userName,
        r.hope as hope
      FROM records r
      LEFT JOIN users u ON r.staff_id = u.id
      WHERE r.id = ?
    `;

    const queryParams = [recordId];

    // Apply role-based filtering using r.company_id (no JOIN needed for filtering)
    if (role === 'member') {
      query += ' AND r.company_id = ?';
      queryParams.push(company_id);
      console.log('Filtering for member - company_id:', company_id);
    } else if (role === 'company-manager') {
      query += ' AND r.company_id = ?';
      queryParams.push(company_id);
      console.log('Filtering for company-manager - company_id:', company_id);
    } else if (role === 'admin') {
      console.log('Admin user - no additional filtering applied');
      // For admin, we want to see all records, so no additional WHERE clause
    } else {
      console.log('Unknown role:', role);
      // Default to showing only user's own records for unknown roles
      query += ' AND r.staff_id = ?';
      queryParams.push(userId);
    }

    console.log('Detail query:', query);
    console.log('Query params:', queryParams);

    const [records] = await pool.query(query, queryParams);

    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found or access denied' });
    }

    console.log('Record detail found:', records[0].id);

    res.json(records[0]);
  } catch (error) {
    console.error('Error fetching record detail:', error);
    res.status(500).json({ error: 'Failed to fetch record detail' });
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
    },
    timeout: 300000 // 5 minutes timeout for file uploads
  });

  console.log(response.data);

  return response.data.id;
}

const testAPI = async (req, res) => {
  console.log('testAPI');
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
  console.log(difyResponse);
  const { status, outputs } = difyResponse.data.data;
  if (status === 'succeeded') {
    console.log(outputs.response);
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
      console.error('Upload error: No file in request');
      console.error('Request body:', req.body);
      console.error('Request files:', req.files);
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { staffId, fileId } = req.body;
    const userId = req.user.id; // Get the actual user ID from auth middleware
    const companyId = req.user.company_id; // Get company_id from user

    if (!staffId || !fileId) {
      console.error('Upload error: Missing required fields');
      console.error('Request body:', req.body);
      console.error('staffId:', staffId, 'fileId:', fileId);
      return res.status(400).json({ error: 'Missing required fields: staffId and fileId are required' });
    }
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
      fs.unlinkSync(audioFilePath);
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

    // Function to process a single chunk
    const processChunk = async (chunk, index) => {
      const tempFilePath = `${audioFilePath}_chunk_${index}.mp3`;
      fs.writeFileSync(tempFilePath, chunk);

      try {
        // Retry logic for file upload
        let tempFileId;
        let uploadRetryCount = 0;
        const maxUploadRetries = 3;

        while (uploadRetryCount < maxUploadRetries) {
          try {
            tempFileId = await uploadFile(tempFilePath);
            // console.log("tempFileId", tempFileId);
            break; // Success, exit retry loop
          } catch (error) {
            uploadRetryCount++;
            console.error(`Chunk ${index} - File upload attempt ${uploadRetryCount} failed:`, error.message);

            if (uploadRetryCount >= maxUploadRetries) {
              // All upload retries failed, clean up and return empty string
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
              console.error(`Chunk ${index} - All ${maxUploadRetries} file upload attempts failed`);
              return '';
            }

            // Wait before retry (exponential backoff)
            const waitTime = Math.pow(2, uploadRetryCount) * 1000; // 2s, 4s, 8s
            console.log(`Chunk ${index} - Waiting ${waitTime}ms before file upload retry ${uploadRetryCount + 1}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        
        // Retry logic for Dify workflow API calls
        let difyResponse;
        let workflowRetryCount = 0;
        const maxWorkflowRetries = 3;

        while (workflowRetryCount < maxWorkflowRetries) {
          try {
            // Process chunk with Dify workflow
            difyResponse = await axios.post(
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
                timeout: 240000 // 4 minutes timeout
              }
            );
            break; // Success, exit retry loop
          } catch (error) {
            workflowRetryCount++;
            console.error(`Chunk ${index} - Dify workflow API attempt ${workflowRetryCount} failed:`, error.message);

            if (workflowRetryCount >= maxWorkflowRetries) {
              // All retries failed, clean up and return empty string
              if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
              }
              console.error(`Chunk ${index} - All ${maxWorkflowRetries} workflow attempts failed`);
              return '';
            }

            // Wait before retry (exponential backoff)
            const waitTime = Math.pow(2, workflowRetryCount) * 1000; // 2s, 4s, 8s
            console.log(`Chunk ${index} - Waiting ${waitTime}ms before workflow retry ${workflowRetryCount + 1}...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }

        // console.log("dify Response", difyResponse.data.data)

        // Clean up temp file
        if (fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        // console.log("difyResponse", difyResponse.data.data.outputs.stt);
        return difyResponse.data.data.outputs.stt;
      } catch (error) {
        console.error(`Error processing chunk ${index}:`, error);
        // Clean up temp file on error
        if (fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkError) {
            console.error(`Failed to clean up temp file ${tempFilePath}:`, unlinkError);
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
    console.log("chunk len", chunks.length)
    const combinedText = chunkResults.join('\n');
    console.log("combinedText", combinedText);
    const txtFilePath = getTxtPathFromMp3(audioFilePath);
    fs.writeFileSync(txtFilePath, combinedText);

    // Process combined text with main Dify workflow
    try {
      const txtFileId = await uploadFile(txtFilePath);

      // Retry logic for Dify API calls
      let difyResponse;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
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
              timeout: 240000 // 4分のタイムアウト
            }
          );
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          console.error(`Dify API attempt ${retryCount} failed:`, error.message);

          if (retryCount >= maxRetries) {
            throw error; // Re-throw the error if all retries failed
          }

          // Wait before retry (exponential backoff)
          const waitTime = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
          console.log(`Waiting ${waitTime}ms before retry ${retryCount + 1}...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }

      const { status, outputs } = difyResponse.data.data;
      console.log("outputs", outputs)
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
            console.error("Invalid JSON in cleanSkillsheet:", e);
            skillsheetData = {}; // or null / fallback value
          }
        } else {
          skillsheetData = cleanSkillsheet;
        }

        // Extract work content array from skillsheet
        const workContentArray = Object.values(skillsheetData).map(career => career['summary']);
        console.log("workContentArray", workContentArray);
        console.log("outputs.skills", outputs.skills);

        // Insert record into database
        const query = `
        INSERT INTO records (file_id, staff_id, company_id, employee_id, audio_file_path, stt, skill_sheet, lor, salesforce, skills, hope, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

        const [result] = await pool.query(query, [
          fileId,
          userId,  // Use req.user.id instead of staffId for staff_id
          companyId, // Add company_id
          staffId, // This is employee_id (string)
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
            employee_id as staffId, 
            staff_name as staffName,
            memo,
            audio_file_path as audioFilePath,
            stt,
            skill_sheet as skillSheet,
            lor,
            salesforce as salesforce,
            skills,
            hope
          FROM records 
          WHERE id = ?`,
          [result.insertId]
        );

        res.status(200).json(newRecord[0]);
      } else {
        console.log("difyResponse", difyResponse.data.data.outputs);
        res.status(500).json({ message: 'Failed to get response from Dify' });
      }
    } catch (difyError) {
      console.error('Error calling Dify API:', difyError);

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
    console.error('Error uploading audio:', error);
    res.status(500).json({ error: 'Failed to upload audio file' });
  }
};

const downloadSTT = async (req, res) => {
  try {
    const { recordId } = req.params;
    // Get STT data and file_id from database
    const [records] = await pool.query(
      'SELECT stt, file_id FROM records WHERE id = ?',
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
    console.error('Error downloading STT:', error);
    res.status(500).json({ error: 'Failed to download STT' });
  }
};

// Helper to draw a solid horizontal line
function drawSolidLine(doc, shouldStroke = false) {
  const { left, right } = doc.page.margins;
  const y = doc.y + 5;
  if (shouldStroke) {
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
      'SELECT skill_sheet, file_id, employee_id, skills FROM records WHERE id = ?',
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
        console.error("Invalid JSON in cleanSkillsheet:", e);
        skillSheet = {}; // or null / fallback value
      }
    } else {
      skillSheet = cleanSkillsheet;
    }

    const fileId = records[0].file_id;
    const staffId = records[0].employee_id;
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
    console.error('Error downloading skill sheet:', error);
    res.status(500).json({ error: 'Failed to download skill sheet' });
  }
};

const updateStaffId = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { staffId } = req.body;

    // Check permission: members can edit records from same company
    let permissionQuery = `
      SELECT r.*, r.company_id as recordCompanyId, r.staff_id as ownerId
      FROM records r
      WHERE r.id = ?
    `;
    const permissionParams = [recordId];

    if (role === 'member') {
      // Members can edit records from same company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    } else if (role === 'company-manager') {
      // Company managers can edit records from their company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    }
    // Admin can edit all records - no additional condition

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    if (!staffId) {
      return res.status(400).json({ error: 'staffId is required' });
    }
    const [result] = await pool.query(
      'UPDATE records SET employee_id = ? WHERE id = ?',
      [staffId, recordId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating staffId:', error);
    res.status(500).json({ error: 'Failed to update staffId' });
  }
};

const updateSkillSheet = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { skill_sheet, skills } = req.body;

    // Check permission: members can edit records from same company
    let permissionQuery = `
      SELECT r.*, r.company_id as recordCompanyId, r.staff_id as ownerId
      FROM records r
      WHERE r.id = ?
    `;
    const permissionParams = [recordId];

    if (role === 'member') {
      // Members can edit records from same company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    } else if (role === 'company-manager') {
      // Company managers can edit records from their company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    }
    // Admin can edit all records - no additional condition

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    console.log("skillSheet", skill_sheet);
    console.log("skills", skills);
    if (!skill_sheet || typeof skill_sheet !== 'object') {
      return res.status(400).json({ error: 'Invalid skill sheet data' });
    }
    const [result] = await pool.query(
      'UPDATE records SET skill_sheet = ?, skills = ? WHERE id = ?',
      [JSON.stringify(skill_sheet), JSON.stringify(skills), recordId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating skill sheet:', error);
    res.status(500).json({ error: 'Failed to update skill sheet' });
  }
};

const getSkillSheet = async (req, res) => {
  try {
    const { recordId } = req.params;
    const [records] = await pool.query('SELECT skill_sheet FROM records WHERE id = ?', [recordId]);
    res.json(records[0].skill_sheet);
  } catch (error) {
    console.error('Error getting skill sheet:', error);
    res.status(500).json({ error: 'Failed to get skill sheet' });
  }
};

const updateSalesforce = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { salesforceData, hope } = req.body;

    // Check permission: members can edit records from same company
    let permissionQuery = `
      SELECT r.*, r.company_id as recordCompanyId, r.staff_id as ownerId
      FROM records r
      WHERE r.id = ?
    `;
    const permissionParams = [recordId];

    if (role === 'member') {
      // Members can edit records from same company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    } else if (role === 'company-manager') {
      // Company managers can edit records from their company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    }
    // Admin can edit all records - no additional condition

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    if (!Array.isArray(salesforceData)) {
      return res.status(400).json({ error: 'Invalid salesforce data' });
    }
    const [result] = await pool.query(
      'UPDATE records SET salesforce = ?, hope = ? WHERE id = ?',
      [JSON.stringify(salesforceData), hope, recordId]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating salesforce data:', error);
    res.status(500).json({ error: 'Failed to update salesforce data' });
  }
};

const downloadSalesforce = async (req, res) => {
  try {
    const { recordId } = req.params;
    // Get salesforce data and file_id from database
    const [records] = await pool.query(
      'SELECT salesforce, file_id, hope FROM records WHERE id = ?',
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
    console.error('Error downloading Salesforce:', error);
    res.status(500).json({ error: 'Failed to download Salesforce PDF' });
  }
};

const downloadBulk = async (req, res) => {
  try {
    const { recordId } = req.params;
    // Get record info
    const [records] = await pool.query(
      'SELECT file_id, audio_file_path, skill_sheet, salesforce, employee_id, skills, stt, hope FROM records WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const { file_id, audio_file_path, skill_sheet, salesforce, employee_id, skills, stt, hope } = records[0];

    // Clean and parse skillsheet if it's a string
    const cleanSkillsheet = typeof skill_sheet === 'string'
      ? skill_sheet.replace(/```json\n?|\n?```/g, '').trim()
      : skill_sheet;

    let skillSheetObj = {};

    if (typeof cleanSkillsheet === "string") {
      try {
        skillSheetObj = JSON.parse(cleanSkillsheet);
      } catch (e) {
        console.error("Invalid JSON in cleanSkillsheet:", e);
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
      console.error('Error parsing skills data:', e);
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
      console.error('Archive error:', err);
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
    skillSheetPDF.text(`■氏名：${employee_id}`);
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
    console.error('Error downloading bulk:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to download bulk zip' });
    }
  }
};

const updateLoR = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { lor } = req.body;

    // Check permission: members can edit records from same company
    let permissionQuery = `
      SELECT r.*, r.company_id as recordCompanyId, r.staff_id as ownerId
      FROM records r
      WHERE r.id = ?
    `;
    const permissionParams = [recordId];

    if (role === 'member') {
      // Members can edit records from same company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    } else if (role === 'company-manager') {
      // Company managers can edit records from their company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    }
    // Admin can edit all records - no additional condition

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    if (typeof lor !== 'string') {
      return res.status(400).json({ error: 'Invalid LoR data' });
    }

    const [result] = await pool.query(
      'UPDATE records SET lor = ? WHERE id = ?',
      [lor, recordId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating LoR:', error);
    res.status(500).json({ error: 'Failed to update LoR' });
  }
};

// Delete record with role-based permissions
const deleteRecord = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;

    let query = `
      SELECT r.*, r.company_id as recordCompanyId
      FROM records r
      WHERE r.id = ?
    `;
    const queryParams = [recordId];

    // Apply role-based access control
    if (role === 'member') {
      // Members can only delete their own records
      query += ' AND r.staff_id = ?';
      queryParams.push(userId);
    } else if (role === 'company-manager') {
      // Company managers can delete records from their company
      query += ' AND r.company_id = ?';
      queryParams.push(company_id);
    } else if (role === 'admin') {
      // Admin can delete all records - no additional WHERE condition
    } else {
      // Unknown role - default to member behavior
      query += ' AND r.staff_id = ?';
      queryParams.push(userId);
    }

    const [records] = await pool.query(query, queryParams);

    if (records.length === 0) {
      return res.status(404).json({ error: 'レコードが見つからないか、削除する権限がありません。' });
    }

    // Delete the record (physical deletion)
    await pool.query('DELETE FROM records WHERE id = ?', [recordId]);

    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ error: 'Failed to delete record' });
  }
};

// Update staff name
const updateStaffName = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { staffName } = req.body;

    // Check permission: members can edit records from same company
    let permissionQuery = `
      SELECT r.*, r.company_id as recordCompanyId, r.staff_id as ownerId
      FROM records r
      WHERE r.id = ?
    `;
    const permissionParams = [recordId];

    if (role === 'member') {
      // Members can edit records from same company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    } else if (role === 'company-manager') {
      // Company managers can edit records from their company
      permissionQuery += ' AND r.company_id = ?';
      permissionParams.push(company_id);
    }
    // Admin can edit all records - no additional condition

    const [records] = await pool.query(permissionQuery, permissionParams);

    if (records.length === 0) {
      return res.status(403).json({ error: 'このレコードを編集する権限がありません。' });
    }

    try {
      const { recordId } = req.params;
      const { staffName } = req.body;

      if (typeof staffName !== 'string') {
        return res.status(400).json({ error: 'Invalid staff name data' });
      }

      const [result] = await pool.query(
        'UPDATE records SET staff_name = ? WHERE id = ?',
        [staffName, recordId]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'Record not found' });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error updating staff name:', error);
      res.status(500).json({ error: 'Failed to update staff name' });
    }
  } catch (error) {
    console.error('Error updating staff name:', error);
    res.status(500).json({ error: 'Failed to update staff name' });
  }
};

// Update memo
const updateMemo = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { memo } = req.body;

    if (typeof memo !== 'string') {
      return res.status(400).json({ error: 'Invalid memo data' });
    }

    const [result] = await pool.query(
      'UPDATE records SET memo = ? WHERE id = ?',
      [memo, recordId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating memo:', error);
    res.status(500).json({ error: 'Failed to update memo' });
  }
};

// Auto-delete records older than specified months (default: 4 months)
const autoDeleteOldRecords = async () => {
  try {
    // Get retention period from environment variable or use default of 4 months
    const months = parseInt(process.env.AUTO_DELETE_RETENTION_MONTHS || '4');

    // Delete records older than specified months
    const [result] = await pool.query(
      `DELETE FROM records 
       WHERE date < DATE_SUB(NOW(), INTERVAL ? MONTH)`,
      [months]
    );

    if (result.affectedRows > 0) {
      console.log(`Auto-deleted ${result.affectedRows} record(s) older than ${months} month(s)`);
    }
  } catch (error) {
    console.error('Error in auto-delete old records:', error);
  }
};

export {
  getRecords,
  getRecordDetail,
  uploadAudio,
  testAPI,
  downloadSTT,
  downloadSkillSheet,
  updateStaffId,
  updateStaffName,
  updateMemo,
  updateSkillSheet,
  getSkillSheet,
  updateSalesforce,
  downloadSalesforce,
  downloadBulk,
  updateLoR,
  deleteRecord,
  autoDeleteOldRecords
};