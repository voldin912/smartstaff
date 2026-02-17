import { pool } from '../config/database.js';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import logger from '../utils/logger.js';
import { createProcessingJob, getJobStatus, getUserJobs, retryFailedJob } from '../services/asyncProcessingService.js';
import { addAudioProcessingJob } from '../queues/audioQueue.js';
import { DEFAULT_FOLLOW_SUMMARY_PROMPT } from '../services/followProcessing/difyWorkflow.js';

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
        DATE_FORMAT(r.follow_date, '%Y-%m-%d') as followDate,
        r.title,
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
      query += ' WHERE r.company_id = ?';
      countQuery += ' WHERE r.company_id = ?';
      queryParams.push(company_id);
      countParams.push(company_id);
      logger.debug('Filtering for member', { company_id });
    } else if (role === 'company-manager') {
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

// Upload audio file - async pattern (returns jobId immediately)
const uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      logger.error('Upload error: No file in request', { body: req.body, files: req.files });
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { staffId, fileId } = req.body;
    const userId = req.user.id;
    const companyId = req.user.company_id;

    if (!staffId || !fileId) {
      logger.error('Upload error: Missing required fields', { body: req.body, staffId, fileId });
      return res.status(400).json({ error: 'Missing required fields: staffId and fileId are required' });
    }

    let audioFilePath = req.file.path;
    const ext = path.extname(audioFilePath).toLowerCase();

    // If file is .m4a, convert to .mp3
    if (ext === '.m4a') {
      const mp3Path = audioFilePath.replace(/\.m4a$/i, '.mp3');
      await new Promise((resolve, reject) => {
        ffmpeg(audioFilePath)
          .toFormat('mp3')
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(mp3Path);
      });
      // Remove the original m4a file
      if (fs.existsSync(audioFilePath)) {
        try {
          fs.unlinkSync(audioFilePath);
          logger.debug('Original m4a file deleted', { audioFilePath });
        } catch (error) {
          logger.warn('Failed to delete original m4a file', { audioFilePath, error: error.message });
          // Continue - cleanup failure should not affect job creation
        }
      }
      audioFilePath = mp3Path;
    }

    // Create processing job in database with job_type = 'follow'
    const jobId = await createProcessingJob(fileId, userId, companyId, staffId, audioFilePath, 'follow');

    logger.info('Follow processing job created, starting async processing', {
      jobId,
      fileId,
      userId,
      audioFilePath,
    });

    // Add job to persistent queue with jobType for routing (non-blocking, survives restarts)
    await addAudioProcessingJob({
      jobId,
      audioFilePath,
      fileId,
      userId,
      companyId,
      staffId,
      jobType: 'follow',
    });

    // Return job ID immediately (non-blocking response)
    res.status(200).json({
      jobId: jobId,
      message: 'アップロードを受け付けました。処理を開始します。',
      status: 'pending',
    });

  } catch (error) {
    logger.error('Error uploading follow audio', error);
    res.status(500).json({ error: 'Failed to upload audio file' });
  }
};

// Get processing job status (for polling)
const getProcessingJobStatus = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { role, company_id, id: userId } = req.user;

    const job = await getJobStatus(parseInt(jobId), userId, role);

    if (!job) {
      return res.status(404).json({ error: 'Job not found or access denied' });
    }

    res.json(job);
  } catch (error) {
    logger.error('Error getting follow job status', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
};

// Get all processing jobs for current user (filtered by job_type = 'follow')
const getProcessingJobs = async (req, res) => {
  try {
    const { role, company_id, id: userId } = req.user;
    const { status, limit } = req.query;

    const jobs = await getUserJobs(
      userId,
      company_id,
      role,
      status || null,
      parseInt(limit) || 20
    );

    // Filter to only follow jobs
    const followJobs = jobs.filter(j => j.job_type === 'follow');

    res.json({ jobs: followJobs });
  } catch (error) {
    logger.error('Error getting follow processing jobs', error);
    res.status(500).json({ error: 'Failed to get processing jobs' });
  }
};

// Retry a failed processing job
const retryProcessingJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const { role, company_id, id: userId } = req.user;

    const result = await retryFailedJob(parseInt(jobId), userId, company_id, role);

    res.json(result);
  } catch (error) {
    logger.error('Error retrying follow job', error);
    res.status(500).json({ error: error.message || 'Failed to retry job' });
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

// Update summary (with follow_date and title)
const updateSummary = async (req, res) => {
  try {
    const { recordId } = req.params;
    const { role, company_id, id: userId } = req.user;
    const { summary, followDate, title } = req.body;

    if (typeof summary !== 'string') {
      return res.status(400).json({ error: 'Invalid summary data' });
    }

    if (summary.length > 3000) {
      return res.status(400).json({ error: 'Summary exceeds 3000 character limit' });
    }

    if (title !== undefined && typeof title !== 'string') {
      return res.status(400).json({ error: 'Invalid title data' });
    }

    if (title && title.length > 1000) {
      return res.status(400).json({ error: 'Title exceeds 1000 character limit' });
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

    const dateValue = followDate || null;
    const titleValue = title !== undefined ? title : '';

    const [result] = await pool.query(
      'UPDATE follows SET follow_date = ?, title = ?, summary = ? WHERE id = ?',
      [dateValue, titleValue, summary, recordId]
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
      query += ' AND r.user_id = ?';
      queryParams.push(userId);
    } else if (role === 'company-manager') {
      query += ' AND r.company_id = ?';
      queryParams.push(company_id);
    } else if (role === 'admin') {
      // Admin can delete all records - no additional WHERE condition
    } else {
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

// Get prompt - fetches from companies.follow_summary_prompt with fallback to default
const getPrompt = async (req, res) => {
  try {
    const { role, company_id } = req.user;

    let prompt = DEFAULT_FOLLOW_SUMMARY_PROMPT;

    if (company_id) {
      const [rows] = await pool.query(
        'SELECT follow_summary_prompt FROM companies WHERE id = ?',
        [company_id]
      );
      if (rows.length > 0 && rows[0].follow_summary_prompt) {
        prompt = rows[0].follow_summary_prompt;
      }
    }

    res.json({ prompt });
  } catch (error) {
    logger.error('Error fetching prompt', error);
    res.status(500).json({ error: 'Failed to fetch prompt' });
  }
};

// Update prompt - persists to companies.follow_summary_prompt
const updatePrompt = async (req, res) => {
  try {
    const { prompt } = req.body;
    const { role, company_id } = req.user;

    if (typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Invalid prompt data' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'Company ID not found for user' });
    }

    // Store the prompt (or set to NULL if empty to revert to default)
    const promptValue = prompt.trim() === '' ? null : prompt;

    await pool.query(
      'UPDATE companies SET follow_summary_prompt = ? WHERE id = ?',
      [promptValue, company_id]
    );

    logger.info('Follow summary prompt updated', { company_id, promptLength: prompt.length });

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
  updatePrompt,
  getProcessingJobStatus,
  getProcessingJobs,
  retryProcessingJob,
};
