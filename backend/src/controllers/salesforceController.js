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
      console.log("Login successful for user:", userInfo.username);
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