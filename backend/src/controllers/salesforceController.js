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

    // Login to Salesforce using callback style
    const loginResult = await new Promise((resolve, reject) => {
      conn.login(username, password + security_token, (err, userInfo) => {
        if (err) {
          resolve(err);
        } else {
          resolve(userInfo);
        }
      });
    });

    // Check if login was successful
    if (loginResult instanceof Error) {
      console.error('Salesforce login error:', loginResult);
      return res.status(401).json({ 
        message: 'Failed to authenticate with Salesforce',
        error: loginResult.message
      });
    }

    // Get all objects
    const metadata = await conn.describeGlobal();
    const objects = metadata.sobjects
      .filter(obj => obj.queryable && obj.createable && obj.updateable)
      .map(obj => ({
        name: obj.name,
        label: obj.label
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    res.json(objects);
  } catch (error) {
    console.error('Error fetching Salesforce objects:', error);
    res.status(500).json({ 
      message: 'Failed to fetch Salesforce objects',
      error: error.message 
    });
  }
}; 