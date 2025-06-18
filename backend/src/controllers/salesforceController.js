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
    
    console.log("req.body", base_url, username, password, security_token);
    // If user is admin and target_company_id is provided, update that company's settings
    const actualCompanyId = role === 'admin' ? 'admin' : company_id;

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
    const mappings = req.body;

    if (!Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({ message: '無効なマッピングデータです' });
    }

    // Use admin as company_id for admin users
    const actualCompanyId = role === 'admin' ? 'admin' : company_id;

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
              job_description_field = ?
            WHERE company_id = ? AND career_index = ?`,
            [
              jobDescription,
              actualCompanyId,
              careerNumber
            ]
          );
        } else {
          // Insert new mapping
          await connection.query(
            `INSERT INTO career_mappings (
              company_id, career_index, job_description_field
            ) VALUES (?, ?, ?)`,
            [
              actualCompanyId,
              careerNumber,
              jobDescription
            ]
          );
        }
      }

      // Delete any mappings that are no longer needed
      const newIndices = new Set(mappings.map(m => m.careerNumber));
      const indicesToDelete = [...existingIndices].filter(index => !newIndices.has(index));
      
      if (indicesToDelete.length > 0) {
        await connection.query(
          'DELETE FROM career_mappings WHERE company_id = ? AND career_index IN (?)',
          [actualCompanyId, indicesToDelete]
        );
      }

      await connection.commit();
      res.json({ message: '職務経歴フィールドマッピングの保存が完了しました' });
    } catch (error) {
      await connection.rollback();
      throw error;
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
    const actualCompanyId = role === 'admin' ? 'admin' : company_id;

    const [mappings] = await pool.query(
      `SELECT 
        career_index as careerNumber,
        job_description_field as jobDescription
      FROM career_mappings 
      WHERE company_id = ?
      ORDER BY career_index ASC`,
      [actualCompanyId]
    );

    // Transform the data to match the expected format
    const formattedMappings = mappings.map(mapping => ({
      careerNumber: mapping.careerNumber,
      fields: {
        jobDescription: mapping.jobDescription || ''
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
          jobDescription: ''
        }
      };
    });

    res.json(allMappings);
  } catch (error) {
    console.error('Error fetching career mappings:', error);
    res.status(500).json({ message: 'サーバーエラーが発生しました' });
  }
};

export const syncAccountWithSalesforce = async (req, res) => {
  const { staffId, type, skillSheet, salesforce } = req.body;
  if (!staffId) {
    return res.status(400).json({ message: 'Staff IDが指定されていません' });
  }

  try {
    // 1. Get Salesforce credentials for this company/user
    const { role, company_id } = req.user;
    const actualCompanyId = role === 'admin' ? 'admin' : company_id;
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
    console.log("salesforce", type,salesforce);
    // 4. Prepare the array of work contents
    let workContents = [];
    if (type === 'skillSheet' && skillSheet) {
      let parsed = typeof skillSheet === 'string' ? JSON.parse(skillSheet) : skillSheet;
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

    // 5. For each work content, get the mapping and update Salesforce
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
      updateObj[mapping.job_description_field] = workContents[i];
    }

    // 6. Update Salesforce
    await conn.sobject('Account').update(updateObj);

    return res.json({ message: '連携が完了しました' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Salesforce連携中にエラーが発生しました' });
  }
};