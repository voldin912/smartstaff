import express from 'express';
import { auth } from '../middleware/auth.js';
import { 
  getSalesforceSettings, 
  updateSalesforceSettings,
  getSalesforceObjects 
} from '../controllers/salesforceController.js';

const router = express.Router();

// Settings routes
router.get('/settings', auth, getSalesforceSettings);
router.put('/settings', auth, updateSalesforceSettings);
router.post('/objects', auth, getSalesforceObjects);

export default router; 