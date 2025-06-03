import { pool } from '../config/database.js';
import axios from 'axios';
import pkg from 'nodejs-whisper';
import FormData from 'form-data';
const { nodewhisper } = pkg;
import fs from 'fs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';

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

// Get all records
const getRecords = async (req, res) => {
  try {
    const { role, company_id, id: userId } = req.user;
    
    let query = `
      SELECT 
        r.id, 
        DATE_FORMAT(r.date, '%d/%m/%y %H:%i:%s') as date,
        r.file_id as fileId, 
        r.employee_id as staffId, 
        r.stt,
        r.skill_sheet as skillSheet,
        r.lor,
        r.salesforce as salesforce,
        r.skills,
        r.audio_file_path as audioFilePath,
        u.company_id as userCompanyId
      FROM records r
      LEFT JOIN users u ON r.staff_id = u.id
    `;

    const queryParams = [];

    // Apply role-based filtering
    if (role === 'member') {
      // Members can only see their own records
      query += ' WHERE r.staff_id = ?';
      queryParams.push(userId);
    } else if (role === 'company-manager') {
      // Company managers can see records from their company
      query += ' WHERE u.company_id = ?';
      queryParams.push(company_id);
    }
    // Admin can see all records (no WHERE clause needed)

    query += ' ORDER BY r.date DESC';

    const [records] = await pool.query(query, queryParams);
    res.json(records);
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ error: 'Failed to fetch records' });
  }
};

const uploadFile = async (filePath) => {
  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));

  const response = await axios.post('https://api.dify.ai/v1/files/upload', form, {
    headers: {
      Authorization: `Bearer ${process.env.DIFY_SECRET_KEY}`,
      ...form.getHeaders()
    }
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
  const {status, outputs } = difyResponse.data.data;
  if (status === 'succeeded') {
    console.log(outputs.response);
    res.json({ message: outputs.response });
  }
  else {
    res.json({ message: 'Failed to get response from Dify' });
  }
};

const getTxtPathFromMp3 = (mp3Path) => {
  return mp3Path.replace(/\.mp3$/i, '.wav.csv');
}

// Upload audio file and create record
const uploadAudio = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { staffId, fileId } = req.body;
    const audioFilePath = req.file.path;
    console.log(audioFilePath);
    const txtFilePath = getTxtPathFromMp3(audioFilePath);

    // Use the queue for transcription
    const transcriptionResult = await transcriptionQueue.addToQueue(audioFilePath, {
      modelName: 'large-v1',
      autoDownloadModelName: 'large-v1',
      removeWavFileAfterTranscription: true,
      whisperOptions: {
        task: 'transcribe',
        language: 'ja',
        outputFormat: 'verbose_json',
        outputInCsv: true
      },
      logger: console
    });

    // Call Dify API
    try {
      const txtFileId = await uploadFile(txtFilePath);
      const difyResponse = await axios.post(
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
          }
        }
      );

      const {status, outputs } = difyResponse.data.data;
      if (status === 'succeeded') {
        // Debug logging
        console.log("outputs.skillsheet:", outputs.skillsheet);
        console.log("outputs.skills: ", typeof outputs.skillsheet);
        
        // Clean and parse skillsheet if it's a string
        const cleanSkillsheet = typeof outputs.skillsheet === 'string' 
          ? outputs.skillsheet.replace(/```json\n?|\n?```/g, '').trim()
          : outputs.skillsheet;
        
        const skillsheetData = typeof cleanSkillsheet === 'string'
          ? JSON.parse(cleanSkillsheet)
          : cleanSkillsheet;
        
        // Extract work content array from skillsheet
        const workContentArray = Object.values(skillsheetData).map(career => career['work content']);
        console.log("workContentArray", workContentArray);

        // Insert record into database
        const query = `
        INSERT INTO records (file_id, staff_id, employee_id, audio_file_path, stt, skill_sheet, lor, salesforce, skills, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      const [result] = await pool.query(query, [
        fileId, 
        staffId, 
        staffId,
        audioFilePath, 
        transcriptionResult, 
        outputs.skillsheet, 
        outputs.lor,
        JSON.stringify(workContentArray),
        outputs.skills
      ]);

      // Return the created record with formatted date
      const [newRecord] = await pool.query(
        `SELECT 
          id, 
          DATE_FORMAT(date, '%d/%m/%y %H:%i:%s') as date,
          file_id as fileId, 
          employee_id as staffId, 
          audio_file_path as audioFilePath,
          stt,
          skill_sheet as skillSheet,
          lor,
          salesforce as salesforce
        FROM records 
        WHERE id = ?`,
        [result.insertId]
      );

      // res.status(201).json(newRecord[0]); 
      res.status(200).json(newRecord[0]);
      }
      else {
        res.status(500).json({ message: 'Failed to get response from Dify' });
      }
    } catch (difyError) {
      console.error('Error calling Dify API:', difyError);
      // Continue with the response even if Dify API call fails
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
    res.setHeader('Content-Disposition', `attachment; filename=stt_${fileId}.pdf`);
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
    const skillSheet = typeof cleanSkillsheet === 'string'
      ? JSON.parse(cleanSkillsheet)
      : cleanSkillsheet;
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
    console.log("skillsData", cleanSkillsData, records[0].skills);
    // Create PDF
    const doc = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=skill_sheet_${fileId}.pdf`);
    doc.pipe(res);
    doc.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    doc.font('NotoSansJP').fontSize(16).text('Personal Data Sheet', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12);
    doc.text('______________________________________________________________');
    doc.moveDown(0.5);
    doc.text('＋＋プロフィール＋＋');
    doc.text('______________________________________________________________');
    doc.moveDown(0.5);
    doc.text(`氏名：${staffId}`);
    doc.moveDown(0.5);
    doc.text('______________________________________________________________');
    doc.moveDown(0.5);
    doc.text('■経歴詳細');
    doc.moveDown();
    Object.keys(skillSheet).forEach((key, idx) => {
      const c = skillSheet[key];
      doc.text(`[期間]${c.from}～${c.to}`);
      doc.text(`[雇用形態]${c['employee type']}`);
      doc.text(`[会社]${c['company name']}`);
      doc.text('[経験職種]');
      const experiences = c['work content'].split('、');
      experiences.forEach(exp => {
        doc.text(`・${exp.trim()}`);
      });
      doc.text('______________________________________________________________');
      doc.moveDown();
    });
    // --- Footer: Skills Section ---
    if (cleanSkillsData) {
      doc.addPage();
      doc.font('NotoSansJP').fontSize(14).text('＋＋語学力・資格・スキル＋＋', {align: 'left'});
      doc.moveDown();
      // 語学力
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
      // 資格
      doc.font('NotoSansJP').fontSize(12).text('■資格');
      if (Array.isArray(cleanSkillsData['資格']) && cleanSkillsData['資格'].length > 0 && cleanSkillsData['資格'].some(q => q && q.trim() !== '')) {
        doc.text('  ' + cleanSkillsData['資格'].filter(q => q && q.trim() !== '').join('、'));
      } else {
        doc.text('  なし');
      }
      doc.moveDown(0.5);
      // スキル
      doc.font('NotoSansJP').fontSize(12).text('■スキル');
      if (Array.isArray(cleanSkillsData['スキル']) && cleanSkillsData['スキル'].length > 0) {
        doc.text('  ' + cleanSkillsData['スキル'].join('、'));
      } else {
        doc.text('  なし');
      }
      doc.moveDown();
      
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
    const { staffId } = req.body;
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
    const { skill_sheet, skills } = req.body;
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
    const {salesforceData} = req.body;
    // console.log("salesforceData", salesforceData);  
    if (!Array.isArray(salesforceData)) {
      return res.status(400).json({ error: 'Invalid salesforce data' });
    }
    const [result] = await pool.query(
      'UPDATE records SET salesforce = ? WHERE id = ?',
      [JSON.stringify(salesforceData), recordId]
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
      'SELECT salesforce, file_id FROM records WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const salesforceArr = JSON.parse(records[0].salesforce || '[]');
    const fileId = records[0].file_id;

    // Create PDF
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=salesforce_${fileId}.pdf`);
    doc.pipe(res);

    // Register and use Japanese font
    doc.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    doc.font('NotoSansJP').fontSize(16).text('セールスフォース', { align: 'center' });
    doc.moveDown();

    salesforceArr.forEach((content, idx) => {
      doc.font('NotoSansJP').fontSize(12).text(`経歴 ${idx + 1}`, { underline: true });
      doc.moveDown(0.2);
      doc.font('NotoSansJP').fontSize(12).text(content);
      doc.moveDown();
    });

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
      'SELECT file_id, audio_file_path, skill_sheet, salesforce, employee_id, skills FROM records WHERE id = ?',
      [recordId]
    );
    if (records.length === 0) {
      return res.status(404).json({ error: 'Record not found' });
    }
    const { file_id, audio_file_path, skill_sheet, salesforce, employee_id, skills } = records[0];
    // Clean and parse skillsheet if it's a string
    const cleanSkillsheet = typeof skill_sheet === 'string' 
      ? skill_sheet.replace(/```json\n?|\n?```/g, '').trim()
      : skill_sheet;
    const skillSheetObj = typeof cleanSkillsheet === 'string'
      ? JSON.parse(cleanSkillsheet)
      : cleanSkillsheet;
    // Parse skills JSON
    let skillsData = null;
    try {
      skillsData = typeof skills === 'string' ? JSON.parse(skills) : skills;
    } catch (e) {
      skillsData = null;
    }
    // Prepare archive
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename=bulk_${file_id}.zip`);
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    // 1. Add audio file
    if (audio_file_path && fs.existsSync(audio_file_path)) {
      archive.file(audio_file_path, { name: `audio_${file_id}${audio_file_path.slice(audio_file_path.lastIndexOf('.'))}` });
    }

    // 2. Add skillsheet PDF (in memory) - Updated to match downloadSkillSheet layout
    const skillSheetPDF = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    skillSheetPDF.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    skillSheetPDF.font('NotoSansJP').fontSize(16).text('Personal Data Sheet', { align: 'center' });
    skillSheetPDF.moveDown();
    skillSheetPDF.fontSize(12);
    skillSheetPDF.text('______________________________________________________________');
    skillSheetPDF.moveDown(0.5);
    skillSheetPDF.text('＋＋プロフィール＋＋');
    skillSheetPDF.text('______________________________________________________________');
    skillSheetPDF.moveDown(0.5);
    skillSheetPDF.text(`氏名：${employee_id}`);
    skillSheetPDF.moveDown(0.5);
    skillSheetPDF.text('______________________________________________________________');
    skillSheetPDF.moveDown(0.5);
    skillSheetPDF.text('●経歴詳細');
    skillSheetPDF.moveDown();
    Object.keys(skillSheetObj).forEach((key, idx) => {
      const c = skillSheetObj[key];
      skillSheetPDF.text(`[期間]${c.from}～${c.to}`);
      skillSheetPDF.text(`[雇用形態]${c['employee type']}`);
      skillSheetPDF.text(`[会社]${c['company name']}`);
      skillSheetPDF.text('[経験職種]');
      const experiences = c['work content'].split('、');
      experiences.forEach(exp => {
        skillSheetPDF.text(`・${exp.trim()}`);
      });
      skillSheetPDF.text('______________________________________________________________');
      skillSheetPDF.moveDown();
    });
    // --- Footer: Skills Section ---
    if (skillsData) {
      skillSheetPDF.addPage();
      skillSheetPDF.font('NotoSansJP').fontSize(14).text('＋＋語学力・資格・スキル＋＋', {align: 'left'});
      skillSheetPDF.moveDown();
      // 語学力
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
      // 資格
      skillSheetPDF.font('NotoSansJP').fontSize(12).text('■資格');
      if (Array.isArray(skillsData['資格']) && skillsData['資格'].length > 0 && skillsData['資格'].some(q => q && q.trim() !== '')) {
        skillSheetPDF.text('  ' + skillsData['資格'].filter(q => q && q.trim() !== '').join('、'));
      } else {
        skillSheetPDF.text('  なし');
      }
      skillSheetPDF.moveDown(0.5);
      // スキル
      skillSheetPDF.font('NotoSansJP').fontSize(12).text('■スキル');
      if (Array.isArray(skillsData['スキル']) && skillsData['スキル'].length > 0) {
        skillSheetPDF.text('  ' + skillsData['スキル'].join('、'));
      } else {
        skillSheetPDF.text('  なし');
      }
      skillSheetPDF.moveDown();
      skillSheetPDF.font('NotoSansJP').fontSize(10).fillColor('gray').text('・ヒアリングした結果データが取得できない場合は不要項目として表示しない。', {indent: 10});
      skillSheetPDF.fillColor('black');
    }
    skillSheetPDF.end();
    archive.append(skillSheetPDF, { name: `skill_sheet_${file_id}.pdf` });

    // 3. Add salesforce PDF (in memory)
    const salesforceArr = JSON.parse(salesforce || '[]');
    const salesforcePDF = new PDFDocument({ size: 'A4', margins: { top: 50, bottom: 50, left: 50, right: 50 } });
    salesforcePDF.registerFont('NotoSansJP', 'C:/Users/ALPHA/BITREP/auth-crud/backend/fonts/NotoSansJP-Regular.ttf');
    salesforcePDF.font('NotoSansJP').fontSize(16).text('セールスフォース', { align: 'center' });
    salesforcePDF.moveDown();
    salesforceArr.forEach((content, idx) => {
      salesforcePDF.font('NotoSansJP').fontSize(12).text(`経歴 ${idx + 1}`, { underline: true });
      salesforcePDF.moveDown(0.2);
      salesforcePDF.font('NotoSansJP').fontSize(12).text(content);
      salesforcePDF.moveDown();
    });
    salesforcePDF.end();
    archive.append(salesforcePDF, { name: `salesforce_${file_id}.pdf` });

    // Finalize archive
    archive.finalize();
  } catch (error) {
    console.error('Error downloading bulk:', error);
    res.status(500).json({ error: 'Failed to download bulk zip' });
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
  downloadBulk
};