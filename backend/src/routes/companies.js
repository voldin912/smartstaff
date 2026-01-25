import express from 'express';
import { body, validationResult } from 'express-validator';
import { pool } from '../config/database.js';
import { auth, authorize } from '../middleware/auth.js';
import { logoUpload } from '../middleware/upload.js';

const router = express.Router();

// Helper function to generate slug from company name
const generateSlug = (name) => {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .trim('-'); // Remove leading/trailing hyphens
};

// Helper function to ensure unique slug
const ensureUniqueSlug = async (slug, excludeId = null) => {
  let uniqueSlug = slug;
  let counter = 1;
  
  while (true) {
    const query = excludeId 
      ? 'SELECT id FROM companies WHERE slug = ? AND id != ?'
      : 'SELECT id FROM companies WHERE slug = ?';
    const params = excludeId ? [uniqueSlug, excludeId] : [uniqueSlug];
    
    const [existing] = await pool.query(query, params);
    if (existing.length === 0) {
      break;
    }
    uniqueSlug = `${slug}-${counter}`;
    counter++;
  }
  
  return uniqueSlug;
};

// Get all companies (admin only)
router.get('/', auth, authorize('admin'), async (req, res) => {
  try {
    const [companies] = await pool.query('SELECT * FROM companies ORDER BY name');
    res.json(companies);
  } catch (error) {
    logger.error('Error in route handler', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create company (admin only)
router.post(
  '/',
  auth,
  authorize('admin'),
  logoUpload.single('logo'),
  [
    body('name').trim().notEmpty().withMessage('Company name is required'),
    body('slug').trim().notEmpty().withMessage('Company slug is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, slug } = req.body;
      const logo = req.file ? `/uploads/logos/${req.file.filename}` : null;

      // Check if company exists
      const [existingCompany] = await pool.query('SELECT * FROM companies WHERE name = ?', [name]);
      if (existingCompany.length > 0) {
        return res.status(400).json({ message: 'Company already exists' });
      }

      // Check if slug exists
      const [existingSlug] = await pool.query('SELECT * FROM companies WHERE slug = ?', [slug]);
      if (existingSlug.length > 0) {
        return res.status(400).json({ message: 'Company slug already exists' });
      }

      // Create company
      const [result] = await pool.query(
        'INSERT INTO companies (name, slug, logo) VALUES (?, ?, ?)', 
        [name, slug, logo]
      );
      
      const [newCompany] = await pool.query('SELECT * FROM companies WHERE id = ?', [result.insertId]);
      res.status(201).json(newCompany[0]);
    } catch (error) {
      logger.error('Error in route handler', error);
      res.status(500).json({ message: 'Server error' });
    }
  }
);

// Update company (admin only)
router.put(
  '/:id',
  auth,
  authorize('admin'),
  logoUpload.single('logo'),
  [
    body('name').trim().notEmpty().withMessage('Company name is required'),
    body('slug').trim().notEmpty().withMessage('Company slug is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, slug } = req.body;
      const { id } = req.params;
      const logo = req.file ? `/uploads/logos/${req.file.filename}` : null;

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

      // Check if slug is already taken by another company
      const [slugExists] = await pool.query('SELECT * FROM companies WHERE slug = ? AND id != ?', [slug, id]);
      if (slugExists.length > 0) {
        return res.status(400).json({ message: 'Company slug already exists' });
      }

      // Update company
      const updateFields = ['name = ?', 'slug = ?'];
      const updateValues = [name, slug];
      
      if (logo) {
        updateFields.push('logo = ?');
        updateValues.push(logo);
      }
      
      updateValues.push(id);
      
      await pool.query(
        `UPDATE companies SET ${updateFields.join(', ')} WHERE id = ?`, 
        updateValues
      );
      
      const [updatedCompany] = await pool.query('SELECT * FROM companies WHERE id = ?', [id]);
      res.json(updatedCompany[0]);
    } catch (error) {
      logger.error('Error in route handler', error);
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
    logger.error('Error in route handler', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;