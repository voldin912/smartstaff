import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { body, validationResult } from 'express-validator';
import { pool } from '../config/database.js';
import { auth, authorize } from '../middleware/auth.js';

const router = express.Router();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only .jpeg, .jpg and .png files are allowed'));
    }
  }
});

// Get users based on role
router.get('/', auth, async (req, res) => {
  try {
    let query = 'SELECT u.*, c.name as company_name FROM users u LEFT JOIN companies c ON u.company_id = c.id';
    const params = [];

    if (req.user.role === 'company-manager') {
      query += ' WHERE u.company_id = ?';
      params.push(req.user.company_id);
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    query += ' ORDER BY u.name';
    const [users] = await pool.query(query, params);
    
    // Remove password from response
    users.forEach(user => delete user.password);
    
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create user (admin or company-manager)
router.post(
  '/',
  auth,
  authorize('admin', 'company-manager'),
  upload.single('avatar'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Invalid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').isIn(['company-manager', 'member']).withMessage('Invalid role'),
    body('company_id').optional().isInt()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, password, role, company_id } = req.body;
      
      // Company managers can only create users for their company
      if (req.user.role === 'company-manager') {
        if (role === 'company-manager') {
          return res.status(403).json({ message: 'Cannot create company manager' });
        }
        if (company_id && company_id !== req.user.company_id) {
          return res.status(403).json({ message: 'Cannot create user for other companies' });
        }
      }

      // Check if user exists
      const [existingUser] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
      if (existingUser.length > 0) {
        return res.status(400).json({ message: 'User already exists' });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const [result] = await pool.query(
        'INSERT INTO users (name, email, password, role, company_id, avatar) VALUES (?, ?, ?, ?, ?, ?)',
        [
          name,
          email,
          hashedPassword,
          role,
          company_id || req.user.company_id || null,
          req.file ? `/uploads/${req.file.filename}` : null
        ]
      );

      const [newUser] = await pool.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      delete newUser[0].password;
      res.status(201).json(newUser[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Update user
router.put(
  '/:id',
  auth,
  upload.single('avatar'),
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().withMessage('Invalid email'),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['company-manager', 'member']).withMessage('Invalid role'),
    body('company_id').optional().isInt()
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const updates = { ...req.body };

      // Check if user exists
      const [existingUser] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
      if (existingUser.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Check permissions
      if (req.user.role === 'company-manager') {
        if (existingUser[0].company_id !== req.user.company_id) {
          return res.status(403).json({ message: 'Cannot update user from other company' });
        }
        if (updates.role === 'company-manager' || existingUser[0].role === 'company-manager') {
          return res.status(403).json({ message: 'Cannot modify company manager role' });
        }
        delete updates.company_id;
      }

      // Hash password if provided
      if (updates.password) {
        updates.password = await bcrypt.hash(updates.password, 10);
      }

      // Add avatar if uploaded
      if (req.file) {
        updates.avatar = `/uploads/${req.file.filename}`;
      }

      // Update user
      const updateFields = Object.keys(updates)
        .filter(key => updates[key] !== undefined)
        .map(key => `${key} = ?`)
        .join(', ');
      
      const updateValues = Object.keys(updates)
        .filter(key => updates[key] !== undefined)
        .map(key => updates[key]);

      if (updateFields.length > 0) {
        await pool.query(
          `UPDATE users SET ${updateFields} WHERE id = ?`,
          [...updateValues, id]
        );
      }

      const [updatedUser] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
      delete updatedUser[0].password;
      res.json(updatedUser[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Delete user
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const [existingUser] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
    if (existingUser.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Check permissions
    if (req.user.role === 'company-manager') {
      if (existingUser[0].company_id !== req.user.company_id) {
        return res.status(403).json({ message: 'Cannot delete user from other company' });
      }
      if (existingUser[0].role === 'company-manager') {
        return res.status(403).json({ message: 'Cannot delete company manager' });
      }
    } else if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Delete user
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;