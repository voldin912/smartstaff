import express from 'express';
import { body, validationResult } from 'express-validator';
import { pool } from '../config/database.js';
import { auth, authorize } from '../middleware/auth.js';

const router = express.Router();

// Get all companies (admin only)
router.get('/', auth, authorize('admin'), async (req, res) => {
  try {
    const [companies] = await pool.query('SELECT * FROM companies ORDER BY name');
    res.json(companies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create company (admin only)
router.post(
  '/',
  auth,
  authorize('admin'),
  [body('name').trim().notEmpty().withMessage('Company name is required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name } = req.body;

      // Check if company exists
      const [existingCompany] = await pool.query('SELECT * FROM companies WHERE name = ?', [name]);
      if (existingCompany.length > 0) {
        return res.status(400).json({ message: 'Company already exists' });
      }

      // Create company
      const [result] = await pool.query('INSERT INTO companies (name) VALUES (?)', [name]);
      
      const [newCompany] = await pool.query('SELECT * FROM companies WHERE id = ?', [result.insertId]);
      res.status(201).json(newCompany[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Update company (admin only)
router.put(
  '/:id',
  auth,
  authorize('admin'),
  [body('name').trim().notEmpty().withMessage('Company name is required')],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name } = req.body;
      const { id } = req.params;

      // Check if company exists
      const [existingCompany] = await pool.query('SELECT * FROM companies WHERE id = ?', [id]);
      if (existingCompany.length === 0) {
        return res.status(404).json({ message: 'Company not found' });
      }

      // Check if name is already taken by another company
      const [nameExists] = await pool.query('SELECT * FROM companies WHERE name = ? AND id != ?', [name, id]);
      if (nameExists.length > 0) {
        return res.status(400).json({ message: 'Company name already exists' });
      }

      // Update company
      await pool.query('UPDATE companies SET name = ? WHERE id = ?', [name, id]);
      
      const [updatedCompany] = await pool.query('SELECT * FROM companies WHERE id = ?', [id]);
      res.json(updatedCompany[0]);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Delete company (admin only)
router.delete('/:id', auth, authorize('admin'), async (req, res) => {
  try {
    const { id } = req.params;

    // Check if company exists
    const [existingCompany] = await pool.query('SELECT * FROM companies WHERE id = ?', [id]);
    if (existingCompany.length === 0) {
      return res.status(404).json({ message: 'Company not found' });
    }

    // Delete company
    await pool.query('DELETE FROM companies WHERE id = ?', [id]);
    res.json({ message: 'Company deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;