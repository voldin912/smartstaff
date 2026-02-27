import { pool } from '../config/database.js';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import jsforce from 'jsforce';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FONT_PATH = path.join(__dirname, '../../fonts/NotoSansJP-Regular.ttf');
import { decrypt } from '../utils/encryption.js';
import { withLock, shouldRunJob, recordJobRun } from '../utils/jobLock.js';
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
        DATE_FORMAT(CONVERT_TZ(r.date, '+00:00', '+09:00'), '%Y-%m-%d %H:%i:%s') as date,
        r.file_id as fileId,
        r.staff_id as staffId,
        r.staff_name as staffName,
        DATE_FORMAT(r.follow_date, '%Y-%m-%d') as followDate,
        r.title,
        r.summary,
        r.salesforce_event_id as salesforceEventId,
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
    const parsedJobId = parseInt(jobId, 10);
    if (isNaN(parsedJobId)) return res.status(400).json({ error: 'Invalid job ID' });

    const { role, company_id, id: userId } = req.user;

    const job = await getJobStatus(parsedJobId, userId, role);

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
      parseInt(limit) || 20,
      'follow'
    );

    res.json({ jobs });
  } catch (error) {
    logger.error('Error getting follow processing jobs', error);
    res.status(500).json({ error: 'Failed to get processing jobs' });
  }
};

// Retry a failed processing job
const retryProcessingJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const parsedJobId = parseInt(jobId, 10);
    if (isNaN(parsedJobId)) return res.status(400).json({ error: 'Invalid job ID' });

    const { role, company_id, id: userId } = req.user;

    const result = await retryFailedJob(parsedJobId, userId, company_id, role);

    res.json(result);
  } catch (error) {
    logger.error('Error retrying follow job', error);
    res.status(500).json({ error: error.message || 'Failed to retry job' });
  }
};

const downloadSTT = async (req, res) => {
  try {
    const { recordId } = req.params;
    const id = parseInt(recordId, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid record ID' });

    const { role, company_id } = req.user;

    // Company-scoped authorization check
    let sttQuery = 'SELECT stt, file_id FROM follows WHERE id = ?';
    const sttParams = [id];

    if (role !== 'admin') {
      sttQuery += ' AND company_id = ?';
      sttParams.push(company_id);
    }

    const [records] = await pool.query(sttQuery, sttParams);
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
    doc.registerFont('NotoSansJP', FONT_PATH);
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
    const id = parseInt(recordId, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid record ID' });

    const { role, company_id, id: userId } = req.user;
    const { staffId } = req.body;

    if (typeof staffId !== 'string' || staffId.length === 0) {
      return res.status(400).json({ error: 'staffId is required' });
    }

    if (staffId.length > 255) {
      return res.status(400).json({ error: 'Staff ID exceeds 255 character limit' });
    }

    // Permission check scoped by company_id
    let permissionQuery = 'SELECT id, company_id FROM follows WHERE id = ?';
    const permissionParams = [id];

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
      [staffId, id]
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
    const id = parseInt(recordId, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid record ID' });

    const { role, company_id, id: userId } = req.user;
    const { staffName } = req.body;

    if (typeof staffName !== 'string') {
      return res.status(400).json({ error: 'Invalid staff name data' });
    }

    if (staffName.length > 255) {
      return res.status(400).json({ error: 'Staff name exceeds 255 character limit' });
    }

    // Permission check scoped by company_id
    let permissionQuery = 'SELECT id, company_id FROM follows WHERE id = ?';
    const permissionParams = [id];

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
      [staffName, id]
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
    const id = parseInt(recordId, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid record ID' });

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

    if (followDate && !/^\d{4}-\d{2}-\d{2}$/.test(followDate)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Permission check scoped by company_id
    let permissionQuery = 'SELECT id, company_id FROM follows WHERE id = ?';
    const permissionParams = [id];

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
      [dateValue, titleValue, summary, id]
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
    const id = parseInt(recordId, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid record ID' });

    const { role, company_id, id: userId } = req.user;

    let query = `
      SELECT r.id, r.company_id as recordCompanyId, r.user_id as ownerId, r.salesforce_event_id, r.staff_id
      FROM follows r
      WHERE r.id = ?
    `;
    const queryParams = [id];

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

    const followRecord = records[0];

    // Delete linked Salesforce Event if it exists
    if (followRecord.salesforce_event_id) {
      try {
        const recordCompanyId = followRecord.recordCompanyId;
        const actualCompanyId = role === 'admin' ? 'admin' : String(recordCompanyId);

        const [settingsRows] = await pool.query(
          'SELECT * FROM salesforce WHERE company_id = ?',
          [actualCompanyId]
        );

        if (settingsRows.length > 0) {
          const settings = settingsRows[0];
          const decryptedPassword = decrypt(settings.password);
          const decryptedSecurityToken = decrypt(settings.security_token);

          if (decryptedPassword && decryptedSecurityToken) {
            const conn = new jsforce.Connection({ loginUrl: settings.base_url });
            await conn.login(settings.username, decryptedPassword + decryptedSecurityToken);

            const deleteResult = await conn.sobject('Event').destroy(followRecord.salesforce_event_id);
            if (deleteResult.success) {
              logger.info('Salesforce Event deleted', { eventId: followRecord.salesforce_event_id, followId: id });
            } else {
              logger.warn('Failed to delete Salesforce Event', { eventId: followRecord.salesforce_event_id, errors: deleteResult.errors });
            }
          }
        }
      } catch (sfError) {
        // Log but don't block record deletion if Salesforce cleanup fails
        logger.warn('Failed to delete linked Salesforce Event', { eventId: followRecord.salesforce_event_id, error: sfError.message });
      }
    }

    // Delete the record (audio files are already deleted after processing)
    await pool.query('DELETE FROM follows WHERE id = ?', [id]);

    logger.debug('Follow record deleted', { recordId: id });

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

    if (prompt.length > 3000) {
      return res.status(400).json({ error: 'Prompt exceeds 3000 character limit' });
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

// Sync follow record to Salesforce as an Event (create or update)
const syncSalesforce = async (req, res) => {
  try {
    const { followId, staffId, title, followDate, summary } = req.body;

    if (!followId) {
      return res.status(400).json({ message: 'Follow IDが指定されていません' });
    }
    const parsedFollowId = parseInt(followId, 10);
    if (isNaN(parsedFollowId)) {
      return res.status(400).json({ message: 'Invalid follow ID' });
    }
    if (!staffId) {
      return res.status(400).json({ message: 'Staff IDが指定されていません' });
    }
    if (!title) {
      return res.status(400).json({ message: 'タイトルが指定されていません' });
    }
    if (!followDate) {
      return res.status(400).json({ message: '実施日時が指定されていません' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(followDate)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }
    if (!summary) {
      return res.status(400).json({ message: '要約が指定されていません' });
    }

    const { role, company_id } = req.user;

    // Company-scoped authorization: verify user's company owns this follow record
    let authQuery = 'SELECT id, salesforce_event_id FROM follows WHERE id = ?';
    const authParams = [parsedFollowId];

    if (role !== 'admin') {
      authQuery += ' AND company_id = ?';
      authParams.push(company_id);
    }

    const [followRows] = await pool.query(authQuery, authParams);
    if (followRows.length === 0) {
      return res.status(403).json({ message: 'このレコードにアクセスする権限がありません' });
    }

    const existingEventId = followRows[0].salesforce_event_id;
    const actualCompanyId = role === 'admin' ? 'admin' : String(company_id);

    logger.info('[syncFollowSalesforce] Starting sync', { followId: parsedFollowId, staffId, actualCompanyId, existingEventId });

    // 1. Get Salesforce credentials
    const [settingsRows] = await pool.query(
      'SELECT * FROM salesforce WHERE company_id = ?',
      [actualCompanyId]
    );
    const settings = settingsRows[0];

    if (!settings) {
      return res.status(400).json({ message: 'Salesforce設定が見つかりません' });
    }

    // 2. Decrypt credentials
    const decryptedPassword = decrypt(settings.password);
    const decryptedSecurityToken = decrypt(settings.security_token);

    if (!decryptedPassword || !decryptedSecurityToken) {
      logger.error('[syncFollowSalesforce] Failed to decrypt credentials');
      return res.status(500).json({ message: '認証情報の復号化に失敗しました' });
    }

    // 3. Login to Salesforce
    logger.info('[syncFollowSalesforce] Logging in to Salesforce...');
    const conn = new jsforce.Connection({ loginUrl: settings.base_url });
    await conn.login(settings.username, decryptedPassword + decryptedSecurityToken);
    logger.info('[syncFollowSalesforce] Successfully logged in');

    // 4. Query Account by StaffID__c
    logger.info('[syncFollowSalesforce] Querying Account for StaffID__c:', staffId);
    const accounts = await conn.sobject('Account')
      .find({ StaffID__c: staffId })
      .limit(1)
      .execute();

    if (!accounts.length) {
      logger.warn('[syncFollowSalesforce] Account not found for staffId:', staffId);
      return res.status(404).json({ message: '指定したStaff IDのアカウントが見つかりません' });
    }

    const accountId = accounts[0].Id;
    logger.info('[syncFollowSalesforce] Account found:', { accountId, name: accounts[0].Name });

    // 5. Build StartDateTime and EndDateTime with explicit JST time-of-day.
    // Avoid using server-local getHours()/getMinutes() so UTC hosts remain correct.
    const jstNowParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tokyo',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date());
    const getPart = (type) => jstNowParts.find(p => p.type === type)?.value || '00';
    const hours = getPart('hour');
    const minutes = getPart('minute');
    const seconds = getPart('second');
    const dateTimeStr = `${followDate}T${hours}:${minutes}:${seconds}+09:00`;

    // 6. Create or Update Event
    if (existingEventId) {
      // Update existing Event
      logger.info('[syncFollowSalesforce] Updating existing Event:', { existingEventId });

      const updateResult = await conn.sobject('Event').update({
        Id: existingEventId,
        Subject: title,
        StartDateTime: dateTimeStr,
        EndDateTime: dateTimeStr,
        Description: summary,
        WhatId: accountId,
      });

      if (updateResult.success) {
        logger.info('[syncFollowSalesforce] Event updated successfully:', { eventId: existingEventId });
        return res.json({ message: 'Salesforce連携を更新しました', eventId: existingEventId, isUpdate: true });
      } else {
        logger.error('[syncFollowSalesforce] Event update failed:', updateResult.errors);
        return res.status(500).json({ message: 'Salesforceイベントの更新に失敗しました' });
      }
    } else {
      // Create new Event
      const eventData = {
        Subject: title,
        StartDateTime: dateTimeStr,
        EndDateTime: dateTimeStr,
        Description: summary,
        WhatId: accountId,
      };

      logger.info('[syncFollowSalesforce] Creating new Event:', {
        Subject: title.substring(0, 50) + (title.length > 50 ? '...' : ''),
        StartDateTime: dateTimeStr,
        EndDateTime: dateTimeStr,
        DescriptionLength: summary.length,
        WhatId: accountId,
      });

      const result = await conn.sobject('Event').create(eventData);

      if (result.success) {
        // Store the Event ID in the follows table
        await pool.query(
          'UPDATE follows SET salesforce_event_id = ? WHERE id = ?',
          [result.id, parsedFollowId]
        );

        logger.info('[syncFollowSalesforce] Event created and ID stored:', { eventId: result.id, followId: parsedFollowId });
        return res.json({ message: 'Salesforce連携が完了しました', eventId: result.id, isUpdate: false });
      } else {
        logger.error('[syncFollowSalesforce] Event creation failed:', result.errors);
        return res.status(500).json({ message: 'Salesforceへの連携に失敗しました' });
      }
    }
  } catch (error) {
    logger.error('[syncFollowSalesforce] Error:', { message: error.message, stack: error.stack });
    return res.status(500).json({ message: 'Salesforce連携中にエラーが発生しました' });
  }
};

// Auto-delete follow records older than specified months (default: 2 months)
// Audio files are already deleted immediately after processing, so only DB rows need cleanup
// @param {object} connection - Database connection to use (must be same connection as lock)
const _autoDeleteOldFollowsInternal = async (connection) => {
  try {
    const months = parseInt(process.env.AUTO_DELETE_RETENTION_MONTHS || '2');

    const [result] = await connection.query(
      `DELETE FROM follows 
       WHERE date < DATE_SUB(NOW(), INTERVAL ? MONTH)`,
      [months]
    );

    if (result.affectedRows > 0) {
      logger.info(`Auto-deleted ${result.affectedRows} follow record(s) older than ${months} month(s)`);
    } else {
      logger.info(`No follow records found to delete (older than ${months} month(s))`);
    }

    return { success: true, deletedCount: result.affectedRows };
  } catch (error) {
    logger.error('Error in auto-delete old follows', error);
    throw error;
  }
};

// Safe wrapper with distributed locking and idempotency
const autoDeleteOldFollows = async () => {
  const LOCK_NAME = 'auto_delete_old_follows';
  const JOB_NAME = 'auto_delete_old_follows';
  const LOCK_TIMEOUT = 30;

  const intervalHours = parseInt(process.env.AUTO_DELETE_INTERVAL_HOURS || '24');

  try {
    const idempotencyCheck = await shouldRunJob(JOB_NAME, intervalHours);

    if (!idempotencyCheck.shouldRun) {
      const lastRunStr = idempotencyCheck.lastRun ? new Date(idempotencyCheck.lastRun).toISOString() : 'unknown';
      logger.info(`Skipping auto-delete follows job: last run was ${lastRunStr}`);
      return { success: false, reason: 'recently_executed', lastRun: idempotencyCheck.lastRun };
    }

    const lockResult = await withLock(LOCK_NAME, LOCK_TIMEOUT, async (connection) => {
      const idempotencyCheckAfterLock = await shouldRunJob(JOB_NAME, intervalHours, connection);
      if (!idempotencyCheckAfterLock.shouldRun) {
        logger.info('Auto-delete follows job skipped: another instance may have already executed it');
        return { success: false, reason: 'recently_executed_after_lock' };
      }

      logger.info('Starting auto-delete old follows job...');
      const deletionResult = await _autoDeleteOldFollowsInternal(connection);

      await recordJobRun(JOB_NAME, connection);

      logger.info('Auto-delete old follows job completed successfully', deletionResult);
      return { success: true, deletedCount: deletionResult.deletedCount };
    });

    if (!lockResult.acquired) {
      logger.warn('Auto-delete follows job skipped: could not acquire lock (another instance may be running)');
      return { success: false, reason: 'lock_not_acquired' };
    }

    return lockResult.result;

  } catch (error) {
    logger.error('Error in auto-delete old follows job', error);
    return { success: false, reason: 'error', error: error.message };
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
  syncSalesforce,
  autoDeleteOldFollows,
};
