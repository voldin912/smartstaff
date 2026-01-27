import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { body, validationResult } from 'express-validator';
import { pool } from '../config/database.js';
import { auth } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import cacheMiddleware from '../middleware/cache.js';

const router = express.Router();

// Register (invitation-based)
router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('invitation_token').notEmpty().withMessage('Invitation token is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, password, invitation_token } = req.body;

      // Hash the provided invitation token
      const tokenHash = crypto.createHash('sha256').update(invitation_token).digest('hex');

      // Validate invitation token
      const [invitations] = await pool.query(
        'SELECT * FROM invitations WHERE token_hash = ? AND expires_at > NOW() AND used = FALSE',
        [tokenHash]
      );

      if (invitations.length === 0) {
        // Generic error message to prevent token enumeration
        return res.status(400).json({ message: 'Invalid or expired invitation token' });
      }

      const invitation = invitations[0];
      const company_id = invitation.company_id;

      // Verify company exists
      const [companies] = await pool.query('SELECT id FROM companies WHERE id = ?', [company_id]);
      if (companies.length === 0) {
        return res.status(400).json({ message: 'Invalid or expired invitation token' });
      }

      // Check if user already exists
      const [existingUser] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (existingUser.length > 0) {
        return res.status(400).json({ message: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user - always with 'member' role (forced server-side)
      const [result] = await pool.query(
        'INSERT INTO users (name, email, password, company_id, role) VALUES (?, ?, ?, ?, ?)',
        [name, email, hashedPassword, company_id, 'member']
      );

      // Mark invitation as used
      await pool.query('UPDATE invitations SET used = TRUE WHERE id = ?', [invitation.id]);

      logger.info('User registered via invitation', {
        userId: result.insertId,
        email,
        companyId: company_id,
        invitationId: invitation.id
      });

      const token = jwt.sign(
        { id: result.insertId },
        process.env.JWT_SECRET || 'your-super-secret-jwt-key',
        { expiresIn: '7d' }
      );

      res.status(201).json({ token });
    } catch (error) {
      logger.error('Error in route handler', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Login
router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Invalid email'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      // Check if user exists
      const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (users.length === 0) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      const user = users[0];

      // Check password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { id: user.id },
        process.env.JWT_SECRET || 'your-super-secret-jwt-key',
        { expiresIn: '7d' }
      );

      res.json({ token });
    } catch (error) {
      logger.error('Error in route handler', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Get current user (with caching)
router.get('/me', auth, cacheMiddleware({
  keyGenerator: (req) => {
    return `auth:me:user:${req.user.id}`;
  },
  includeUserId: true,
  ttl: 30
}), async (req, res) => {
  try {
    const user = { ...req.user };
    delete user.password;
    
    // If user is admin, set specific company info
    if (user.role === 'admin') {
      user.company = {
        id: 0,
        name: 'Smart Staff',
        slug: 'admin',
        logo: ''
      };
    }
    // If user has a company_id, fetch company information
    else if (user.company_id) {
      const [companies] = await pool.query(
        'SELECT id, name, slug, logo FROM companies WHERE id = ?', 
        [user.company_id]
      );
      if (companies.length > 0) {
        user.company = companies[0];
      }
    }
    
    res.json(user);
  } catch (error) {
    logger.error('Error in route handler', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;