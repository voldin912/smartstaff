import { pool } from '../config/database.js';
import jsforce from 'jsforce';

// Get Salesforce settings
export const getSalesforceSettings = async (req, res) => {
  try {
    const { role, company_id } = req.user;
    
    // If user is admin, get all settings
    if (role === 'admin') {
      const [rows] = await pool.query('SELECT * FROM salesforce');
      return res.json(rows);
    }
    
    // For regular users, get their company's settings
    const [rows] = await pool.query('SELECT * FROM salesforce WHERE company_id = ?', [company_id]);
    res.json(rows[0] || null);
  } catch (error) {
    console.error('Error fetching Salesforce settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// Update Salesforce settings
export const updateSalesforceSettings = async (req, res) => {
  try {
    const { role, company_id } = req.user;
    const { base_url, username, password, security_token } = req.body;
    console.log("req.body", req.body);
    
    console.log("req.body", base_url, username, password, security_token);
    // If user is admin and target_company_id is provided, update that company's settings
    const actualCompanyId = role === 'admin' ? 'admin' : String(company_id);

    console.log("role, company_id", role, company_id);
    
    const [existing] = await pool.query(
      'SELECT * FROM salesforce WHERE company_id = ?',
      [actualCompanyId]
    );

    if (existing.length > 0) {
      // Update existing record
      await pool.query(
        'UPDATE salesforce SET base_url = ?, username = ?, password = ?, security_token = ? WHERE company_id = ?',
        [base_url, username, password, security_token, actualCompanyId]
      );
    } else {
      // Insert new record
      await pool.query(
        'INSERT INTO salesforce (company_id, base_url, username, password, security_token) VALUES (?, ?, ?, ?, ?)',
        [actualCompanyId, base_url, username, password, security_token]
      );
    }

    res.json({ message: 'Salesforce settings updated successfully' });
  } catch (error) {
    console.error('Error updating Salesforce settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

async function sfLogin(conn, username, password, security_token) {
  return new Promise((resolve, reject) => {
      conn.login(username, password + security_token, (err, userInfo) => {
          if (err) {
              console.log("err", err);
              resolve(err)
          } else {
              resolve(userInfo)
          }
      })
  })
}

// Get Salesforce objects
export const getSalesforceObjects = async (req, res) => {
  try {
    const { base_url, username, password, security_token } = req.body;

    if (!base_url || !username || !password || !security_token) {
      return res.status(400).json({ message: 'Missing required credentials' });
    }

    // Create a new connection to Salesforce
    const conn = new jsforce.Connection({
      loginUrl: base_url
    });

    let userInfo;
    try {
      userInfo = await conn.login(username, password + security_token);
      console.log("Login successful for user:", userInfo);
    } catch (error) {
      console.error('Salesforce login error:', error);
      return res.status(401).json({ 
        message: 'Failed to authenticate with Salesforce',
        error: error.message
      });
    }

    // Get all objects with detailed metadata
    const metadata = await conn.describeGlobal();
    const objects = await Promise.all(
      metadata.sobjects
        .filter(obj => obj.queryable && obj.createable && obj.updateable)
        .map(async (obj) => {
          try {
            // Get detailed metadata for each object
            const describe = await conn.describe(obj.name);
            return {
              name: obj.name,
              label: obj.label,
              labelPlural: obj.labelPlural,
              keyPrefix: obj.keyPrefix,
              fields: describe.fields.map(field => ({
                name: field.name,
                label: field.label,
                type: field.type,
                length: field.length,
                required: field.nillable === false,
                unique: field.unique,
                picklistValues: field.picklistValues || [],
                referenceTo: field.referenceTo || []
              })),
              createable: obj.createable,
              updateable: obj.updateable,
              deletable: obj.deletable,
              queryable: obj.queryable,
              searchable: obj.searchable,
              triggerable: obj.triggerable,
              custom: obj.custom,
              customSetting: obj.customSetting,
              deprecatedAndHidden: obj.deprecatedAndHidden,
              hasSubtypes: obj.hasSubtypes,
              isSubtype: obj.isSubtype,
              isInterface: obj.isInterface,
              isApexTriggerable: obj.isApexTriggerable,
              isWorkflowEnabled: obj.isWorkflowEnabled,
              isFeedEnabled: obj.isFeedEnabled,
              isSearchable: obj.isSearchable,
              isLayoutable: obj.isLayoutable,
              isCompactLayoutable: obj.isCompactLayoutable,
              isProcessEnabled: obj.isProcessEnabled,
              isReplicateable: obj.isReplicateable,
              isRetrieveable: obj.isRetrieveable,
              isUndeletable: obj.isUndeletable,
              isMergeable: obj.isMergeable,
              isQueryable: obj.isQueryable,
              isTriggerable: obj.isTriggerable,
              isUpdateable: obj.isUpdateable,
              isCreateable: obj.isCreateable,
              isDeletable: obj.isDeletable,
              isCustom: obj.isCustom,
              isCustomSetting: obj.isCustomSetting,
              isDeprecatedAndHidden: obj.isDeprecatedAndHidden,
              isHasSubtypes: obj.isHasSubtypes,
              isIsSubtype: obj.isIsSubtype,
              isIsInterface: obj.isIsInterface,
              isIsApexTriggerable: obj.isIsApexTriggerable,
              isIsWorkflowEnabled: obj.isIsWorkflowEnabled,
              isIsFeedEnabled: obj.isIsFeedEnabled,
              isIsSearchable: obj.isIsSearchable,
              isIsLayoutable: obj.isIsLayoutable,
              isIsCompactLayoutable: obj.isIsCompactLayoutable,
              isIsProcessEnabled: obj.isIsProcessEnabled,
              isIsReplicateable: obj.isIsReplicateable,
              isIsRetrieveable: obj.isIsRetrieveable,
              isIsUndeletable: obj.isIsUndeletable,
              isIsMergeable: obj.isIsMergeable,
              isIsQueryable: obj.isIsQueryable,
              isIsTriggerable: obj.isIsTriggerable,
              isIsUpdateable: obj.isIsUpdateable,
              isIsCreateable: obj.isIsCreateable,
              isIsDeletable: obj.isIsDeletable
            };
          } catch (error) {
            console.error(`Error getting metadata for ${obj.name}:`, error);
            return {
              name: obj.name,
              label: obj.label,
              error: 'Failed to get detailed metadata'
            };
          }
        })
    );

    // Sort objects by label
    objects.sort((a, b) => a.label.localeCompare(b.label));

    res.json({
      success: true,
      objects: objects,
      totalObjects: objects.length
    });
  } catch (error) {
    console.error('Error fetching Salesforce objects:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to fetch Salesforce objects',
      error: error.message 
    });
  }
};

// Save career mappings
export const saveCareerMappings = async (req, res) => {
  try {
    const { role, company_id } = req.user;
    const {careerMappings, staffMemo} = req.body;
    const mappings = careerMappings
    console.log("mapping staffmemo", mappings, staffMemo)
    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ message: '無効なマッピングデータです' });
    }
    console.log(role, company_id);
    // Use admin as company_id for admin users
    const actualCompanyId = role === 'admin' ? 'admin' : String(company_id);

    // Start a transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Get existing mappings for this company
      const [existingMappings] = await connection.query(
        'SELECT career_index FROM career_mappings WHERE company_id = ?',
        [actualCompanyId]
      );
      const existingIndices = new Set(existingMappings.map(m => m.career_index));
      console.log("existingIndices", existingIndices);
      
      // Process each mapping
      for (const mapping of mappings) {
        const { careerNumber, fields } = mapping;
        const { jobDescription } = fields;
        if (existingIndices.has(careerNumber)) {
          // Update existing mapping
          await connection.query(
            `UPDATE career_mappings SET
              job_description_field = ?, staff_memo = ?
            WHERE company_id = ? AND career_index = ?`,
            [
              jobDescription,
              staffMemo,
              actualCompanyId,
              Number(careerNumber)
            ]
          );
        } else {
          // Insert new mapping
          await connection.query(
            `INSERT INTO career_mappings (
              company_id, career_index, job_description_field, staff_memo
            ) VALUES (?, ?, ?, ?)`,
            [
              actualCompanyId,
              Number(careerNumber),
              jobDescription, 
              staffMemo
            ]
          );
        }
      }

      await connection.commit();
      res.json({ message: '職務経歴フィールドマッピングの保存が完了しました' });
    } catch (error) {
      await connection.rollback();
      console.log(error)
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Error saving career mappings:', error);
    res.status(500).json({ message: 'サーバーエラーが発生しました' });
  }
};

// Get career mappings
export const getCareerMappings = async (req, res) => {
  try {
    const { role, company_id } = req.user;
    
    // Use admin as company_id for admin users
    const actualCompanyId = role === 'admin' ? 'admin' : String(company_id);

    const [mappings] = await pool.query(
      `SELECT 
        career_index as careerNumber,
        job_description_field as jobDescription,
        staff_memo as staffMemo
      FROM career_mappings 
      WHERE company_id = ?
      ORDER BY career_index ASC`,
      [actualCompanyId]
    );

    // Transform the data to match the expected format
    const formattedMappings = mappings.map(mapping => ({
      careerNumber: mapping.careerNumber,
      fields: {
        jobDescription: mapping.jobDescription || '',
        staffMemo: mapping.staffMemo || ''
      }
    }));

    // Ensure we always return 15 mappings, filling in empty ones if needed
    const allMappings = Array.from({ length: 15 }, (_, i) => {
      const existingMapping = formattedMappings.find(m => m.careerNumber === i + 1);
      if (existingMapping) {
        return existingMapping;
      }
      return {
        careerNumber: i + 1,
        fields: {
          jobDescription: '',
          staffMemo: ''
        }
      };
    });

    res.json(allMappings);
  } catch (error) {
    console.error('Error fetching career mappings:', error);
    res.status(500).json({ message: 'サーバーエラーが発生しました' });
  }
};

// Helper function to parse existing field content
function parseFieldContent(content) {
  if (!content) return { skillSheet: null, salesforce: null, salesMemo: null, lastUpdated: {} };
  
  try {
    // Try to parse as JSON (old format)
    const parsed = JSON.parse(content);
    return {
      skillSheet: parsed.skillSheet || null,
      salesforce: parsed.salesforce || null,
      salesMemo: parsed.salesMemo || null,
      lastUpdated: parsed.lastUpdated || {}
    };
  } catch {
    // If not JSON, check if it's the new clean format
    if (content.includes('【スキルシート情報】') || content.includes('【Salesforce情報】') || content.includes('【営業担当メモ】')) {
      return parseCleanFormat(content);
    }
    
    // If not clean format, treat as legacy format
    // Check if the content looks like staff memo (hope content)
    // This is a simple heuristic - you might want to adjust this logic
    if (content.includes('希望') || content.includes('メモ') || content.includes('担当') || 
        content.includes('営業') || content.includes('対応') || content.length < 200) {
      return {
        skillSheet: null,
        salesforce: null,
        salesMemo: content,
        lastUpdated: { salesMemo: new Date().toISOString() }
      };
    }
    
    // Otherwise treat as skill sheet content
    return {
      skillSheet: content,
      salesforce: null,
      salesMemo: null,
      lastUpdated: { skillSheet: new Date().toISOString() }
    };
  }
}

// Helper function to parse clean formatted content
function parseCleanFormat(content) {
  const result = {
    skillSheet: null,
    salesforce: null,
    salesMemo: null,
    lastUpdated: {}
  };
  
  // Split by separator
  const sections = content.split(/\n\n---\n\n/);
  
  sections.forEach(section => {
    const lines = section.trim().split('\n');
    if (lines.length < 2) return;
    
    const headerLine = lines[0];
    const contentLines = lines.slice(2); // Skip header and empty line
    
    if (headerLine.includes('【スキルシート情報】')) {
      result.skillSheet = contentLines.join('\n').trim();
      // Extract timestamp if available
      const timestampMatch = headerLine.match(/最終更新: (.+?)\)/);
      if (timestampMatch) {
        result.lastUpdated.skillSheet = new Date(timestampMatch[1]).toISOString();
      }
    } else if (headerLine.includes('【Salesforce情報】')) {
      result.salesforce = contentLines.join('\n').trim();
      // Extract timestamp if available
      const timestampMatch = headerLine.match(/最終更新: (.+?)\)/);
      if (timestampMatch) {
        result.lastUpdated.salesforce = new Date(timestampMatch[1]).toISOString();
      }
    } else if (headerLine.includes('【営業担当メモ】')) {
      result.salesMemo = contentLines.join('\n').trim();
      // Extract timestamp if available
      const timestampMatch = headerLine.match(/最終更新: (.+?)\)/);
      if (timestampMatch) {
        result.lastUpdated.salesMemo = new Date(timestampMatch[1]).toISOString();
      }
    }
  });
  
  return result;
}

// Helper function to merge data according to business rules
function mergeFieldData(existingData, newData, newType) {
  const now = new Date().toISOString();
  
  // If existing data is empty, just use new data
  if (!existingData.skillSheet && !existingData.salesforce && !existingData.salesMemo) {
    return {
      [newType]: newData,
      lastUpdated: { [newType]: now }
    };
  }
  
  // If new data is empty, return existing data
  if (!newData) {
    return existingData;
  }
  
  let result = { ...existingData };
  
  if (newType === 'skillSheet') {
    if (existingData.skillSheet) {
      // Rule: If skill sheet already exists, overwrite when type is skill sheet
      result.skillSheet = newData;
      result.lastUpdated = { ...result.lastUpdated, skillSheet: now };
    } else {
      // Rule: If only salesforce exists, add skill sheet data
      result.skillSheet = newData;
      result.lastUpdated = { ...result.lastUpdated, skillSheet: now };
    }
  } else if (newType === 'salesforce') {
    if (existingData.salesforce) {
      // Rule: If salesforce already exists, overwrite when type is salesforce
      result.salesforce = newData;
      result.lastUpdated = { ...result.lastUpdated, salesforce: now };
    } else {
      // Rule: If only skill sheet exists, add salesforce data
      result.salesforce = newData;
      result.lastUpdated = { ...result.lastUpdated, salesforce: now };
    }
  } else if (newType === 'hope') {
    // Treat hope as salesMemo for consistency
    if (existingData.salesMemo) {
      // Rule: If sales memo already exists, overwrite when type is hope
      result.salesMemo = newData;
      result.lastUpdated = { ...result.lastUpdated, salesMemo: now };
    } else {
      // Rule: Add sales memo data if it doesn't exist
      result.salesMemo = newData;
      result.lastUpdated = { ...result.lastUpdated, salesMemo: now };
    }
  }
  
  return result;
}

// Helper function to format data for Salesforce storage
function formatForSalesforce(mergedData) {
  // If we have multiple types of data, store as clean formatted text
  if (mergedData.skillSheet || mergedData.salesforce || mergedData.salesMemo) {
    return formatMergedDataForDisplay(mergedData);
  }
  
  return '';
}

// Helper function to format merged data for clean display
function formatMergedDataForDisplay(mergedData) {
  const { skillSheet, salesforce, salesMemo, lastUpdated } = mergedData;
  
  let displayText = '';
  let sections = [];
  
  // Add sections in specific order: salesMemo first, skillSheet second, salesforce third
  
  // 1. Add sales memo section if exists (FIRST)
  if (salesMemo) {
    sections.push({
      type: 'salesMemo',
      content: salesMemo,
      lastUpdated: lastUpdated.salesMemo
    });
  }
  
  // 2. Add skill sheet section if exists (SECOND)
  if (skillSheet) {
    sections.push({
      type: 'skillSheet',
      content: skillSheet,
      lastUpdated: lastUpdated.skillSheet
    });
  }
  
  // 3. Add salesforce section if exists (THIRD)
  if (salesforce) {
    sections.push({
      type: 'salesforce',
      content: salesforce,
      lastUpdated: lastUpdated.salesforce
    });
  }
  
  // Format sections with clear separators
  sections.forEach((section, index) => {
    if (index > 0) {
      displayText += '\n\n---\n\n'; // Clear separator between sections
    }
    
    let sectionLabel;
    switch (section.type) {
      case 'skillSheet':
        sectionLabel = 'スキルシート情報';
        break;
      case 'salesforce':
        sectionLabel = 'Salesforce情報';
        break;
      case 'salesMemo':
        sectionLabel = '営業担当メモ';
        break;
      default:
        sectionLabel = 'その他情報';
    }
    
    const lastUpdated = section.lastUpdated ? new Date(section.lastUpdated).toLocaleString('ja-JP') : '';
    
    displayText += `【${sectionLabel}】`;
    if (lastUpdated) {
      displayText += ` (最終更新: ${lastUpdated})`;
    }
    displayText += '\n\n';
    displayText += section.content;
  });
  
  return displayText.trim();
}

// Helper function to extract and format merged data for display
function extractMergedData(content) {
  if (!content) return { skillSheet: null, salesforce: null, salesMemo: null, lastUpdated: {} };
  
  try {
    // Try to parse as JSON (new format)
    const parsed = JSON.parse(content);
    return {
      skillSheet: parsed.skillSheet || null,
      salesforce: parsed.salesforce || null,
      salesMemo: parsed.salesMemo || null,
      lastUpdated: parsed.lastUpdated || {}
    };
  } catch {
    // If not JSON, treat as legacy format
    return {
      skillSheet: content,
      salesforce: null,
      salesMemo: null,
      lastUpdated: { skillSheet: new Date().toISOString() }
    };
  }
}

export const syncAccountWithSalesforce = async (req, res) => {
  const { staffId, type, skillSheet, salesforce, hope } = req.body;
  if (!staffId) {
    return res.status(400).json({ message: 'Staff IDが指定されていません' });
  }

  try {
    // 1. Get Salesforce credentials for this company/user
    const { role, company_id } = req.user;
    const actualCompanyId = role === 'admin' ? 'admin' : String(company_id);
    const [settingsRows] = await pool.query(
      'SELECT * FROM salesforce WHERE company_id = ?',
      [actualCompanyId]
    );
    const settings = settingsRows[0];
    if (!settings) {
      return res.status(400).json({ message: 'Salesforce設定が見つかりません' });
    }

    // 2. Login to Salesforce
    const conn = new jsforce.Connection({ loginUrl: settings.base_url });
    await conn.login(settings.username, settings.password + settings.security_token);

    // 3. Query Account by staffId (StaffID__c)
    const accounts = await conn.sobject('Account')
      .find({ StaffID__c: staffId })
      .limit(1)
      .execute();

    if (!accounts.length) {
      return res.status(404).json({ message: '指定したStaff IDのアカウントが見つかりません' });
    }
    
    console.log("salesforce", type, salesforce, skillSheet, hope);
    
    // 4. Prepare the array of work contents
    let workContents = [];
    if (type === 'skillSheet' && skillSheet) {
      // Clean the skillSheet data by removing markdown code blocks and other symbols
      let cleanedSkillSheet = skillSheet;
      
      // Remove markdown code blocks (```json, ```, etc.)
      cleanedSkillSheet = cleanedSkillSheet.replace(/```json*\n?/g, '');
      cleanedSkillSheet = cleanedSkillSheet.replace(/```/g, '');
      
      // Remove extra whitespace and newlines
      cleanedSkillSheet = cleanedSkillSheet.trim();
      
      let parsed = typeof cleanedSkillSheet === 'string' ? JSON.parse(cleanedSkillSheet) : cleanedSkillSheet;
      workContents = Object.values(parsed).map(career => career['work content'] || '').filter(Boolean);
    } else if (type === 'salesforce') {
      let arr = salesforce;
      if (typeof arr === 'string') {
        try {
          arr = JSON.parse(arr);
        } catch {
          arr = [arr];
        }
      }
      if (!Array.isArray(arr)) arr = [arr];
      workContents = arr;
    } else {
      return res.status(400).json({ message: '同期データが不正です' });
    }
    console.log("workContents", workContents);

    // 5. For each work content, get the mapping and update Salesforce with merging logic
    const updateObj = { Id: accounts[0].Id };
    
    for (let i = 0; i < workContents.length; i++) {
      const [mappingRows] = await pool.query(
        'SELECT job_description_field FROM career_mappings WHERE company_id = ? AND career_index = ?',
        [actualCompanyId, i + 1]
      );
      const mapping = mappingRows[0];
      if (!mapping || !mapping.job_description_field) {
        return res.status(400).json({ message: `マッピングが見つかりません (行: ${i + 1})` });
      }
      
      const fieldName = mapping.job_description_field;
      const existingContent = accounts[0][fieldName] || '';
      
      // Parse existing content
      const existingData = parseFieldContent(existingContent);
      
      // Merge with new data
      const mergedData = mergeFieldData(existingData, workContents[i], type);
      
      // Format for Salesforce storage
      const formattedContent = formatForSalesforce(mergedData);
      
      updateObj[fieldName] = formattedContent;
    }

    // Handle hope field with same merging logic
    if (hope) { 
      const [staffRows] = await pool.query(
        'SELECT staff_memo FROM career_mappings WHERE company_id = ? AND career_index = 1',
        [actualCompanyId]
      );
      const staff = staffRows[0];
      
      if (staff && staff.staff_memo) {
        const fieldName = staff.staff_memo;
        const existingContent = accounts[0][fieldName] || '';
        
        // Parse existing content
        const existingData = parseFieldContent(existingContent);
        
        // Merge with new data (treat hope as skillSheet type for consistency)
        const mergedData = mergeFieldData(existingData, hope, 'skillSheet');
        
        // Format for Salesforce storage
        const formattedContent = formatForSalesforce(mergedData);
        
        updateObj[fieldName] = formattedContent;
      }
    }

    // 6. Update Salesforce
    await conn.sobject('Account').update(updateObj);

    return res.json({ message: '連携が完了しました' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Salesforce連携中にエラーが発生しました' });
  }
};