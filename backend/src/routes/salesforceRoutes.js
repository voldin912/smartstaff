import express from 'express';
import { auth } from '../middleware/auth.js';
import { 
  getSalesforceSettings, 
  updateSalesforceSettings,
  getSalesforceObjects,
  saveCareerMappings,
  getCareerMappings,
  syncAccountWithSalesforce
} from '../controllers/salesforceController.js';

const router = express.Router();

// Settings routes
router.get('/settings', auth, getSalesforceSettings);
router.put('/settings', auth, updateSalesforceSettings);
router.post('/objects', auth, getSalesforceObjects);

// Career mappings routes
router.post('/career-mappings', auth, saveCareerMappings);
router.get('/career-mappings', auth, getCareerMappings);

// Salesforce sync routes
router.post('/sync-account', auth, syncAccountWithSalesforce);

export default router; 