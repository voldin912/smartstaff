import express from 'express';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { pool } from '../config/database.js';
import { auth, authorize } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Create invitation (admin or company-manager only)
router.post(
  '/',
  auth,
  authorize('admin', 'company-manager'),
  [
    body('email').optional().isEmail().withMessage('Invalid email'),
    body('company_id').isInt().withMessage('Company ID is required and must be an integer'),
    body('expires_in_days').optional().isInt({ min: 1, max: 90 }).withMessage('Expiration days must be between 1 and 90')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, company_id, expires_in_days } = req.body;
      const expiresDays = expires_in_days || 7; // Default 7 days

      // Authorization check: company-managers can only invite for their own company
      if (req.user.role === 'company-manager') {
        if (company_id !== req.user.company_id) {
          return res.status(403).json({ message: 'Cannot create invitation for other companies' });
        }
      }

      // Verify company exists
      const [companies] = await pool.query('SELECT id FROM companies WHERE id = ?', [company_id]);
      if (companies.length === 0) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Generate secure random token
      const rawToken = crypto.randomBytes(32).toString('hex');
      
      // Hash token for storage (SHA-256)
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresDays);

      // Insert invitation into database
      const [result] = await pool.query(
        'INSERT INTO invitations (token_hash, company_id, email, created_by_user_id, expires_at) VALUES (?, ?, ?, ?, ?)',
        [tokenHash, company_id, email || null, req.user.id, expiresAt]
      );

      // Generate invitation URL (optional, for convenience)
      const invitationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/register?token=${rawToken}`;

      logger.info('Invitation created', {
        invitationId: result.insertId,
        companyId: company_id,
        createdBy: req.user.id,
        expiresAt: expiresAt.toISOString()
      });

      res.status(201).json({
        id: result.insertId,
        token: rawToken, // Return raw token only once (for sending to user)
        invitation_url: invitationUrl,
        company_id,
        email: email || null,
        expires_at: expiresAt.toISOString()
      });
    } catch (error) {
      logger.error('Error creating invitation', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// List invitations (admin or company-manager only)
router.get(
  '/',
  auth,
  authorize('admin', 'company-manager'),
  async (req, res) => {
    try {
      let query = `
        SELECT 
          i.id,
          i.company_id,
          i.email,
          i.created_by_user_id,
          i.expires_at,
          i.used,
          i.created_at,
          c.name as company_name,
          u.name as created_by_name
        FROM invitations i
        LEFT JOIN companies c ON i.company_id = c.id
        LEFT JOIN users u ON i.created_by_user_id = u.id
      `;
      const params = [];

      // Company-managers can only see invitations for their company
      if (req.user.role === 'company-manager') {
        query += ' WHERE i.company_id = ?';
        params.push(req.user.company_id);
      }

      query += ' ORDER BY i.created_at DESC';

      const [invitations] = await pool.query(query, params);

      // Don't return token_hash or raw token in response
      const safeInvitations = invitations.map(inv => ({
        id: inv.id,
        company_id: inv.company_id,
        company_name: inv.company_name,
        email: inv.email,
        created_by_user_id: inv.created_by_user_id,
        created_by_name: inv.created_by_name,
        expires_at: inv.expires_at,
        used: inv.used,
        created_at: inv.created_at
      }));

      res.json(safeInvitations);
    } catch (error) {
      logger.error('Error listing invitations', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Revoke invitation (admin or company-manager only)
router.delete(
  '/:id',
  auth,
  authorize('admin', 'company-manager'),
  async (req, res) => {
    try {
      const { id } = req.params;

      // Get invitation to check permissions
      const [invitations] = await pool.query('SELECT company_id, used FROM invitations WHERE id = ?', [id]);
      if (invitations.length === 0) {
        return res.status(404).json({ message: 'Invitation not found' });
      }

      const invitation = invitations[0];

      // Authorization check: company-managers can only revoke invitations for their company
      if (req.user.role === 'company-manager') {
        if (invitation.company_id !== req.user.company_id) {
          return res.status(403).json({ message: 'Cannot revoke invitation for other companies' });
        }
      }

      // Mark as used (effectively revoking it)
      await pool.query('UPDATE invitations SET used = TRUE WHERE id = ?', [id]);

      logger.info('Invitation revoked', { invitationId: id, revokedBy: req.user.id });

      res.json({ message: 'Invitation revoked successfully' });
    } catch (error) {
      logger.error('Error revoking invitation', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

export default router;
