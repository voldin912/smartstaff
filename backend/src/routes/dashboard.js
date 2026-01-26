import express from 'express';
import { pool } from '../config/database.js';
import { auth } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import cacheMiddleware from '../middleware/cache.js';

const router = express.Router();

router.get('/stats', auth, cacheMiddleware({
  keyGenerator: (req) => {
    const { role, company_id } = req.user;
    if (role === 'admin') {
      return 'dashboard:stats:admin';
    }
    return `dashboard:stats:company:${company_id}`;
  },
  ttl: 30
}), async (req, res) => {
  try {
    let totalUsers = 0;
    let totalCompanies = 0;
    let recentUsers = [];

    // Get total users based on role
    if (req.user.role === 'admin') {
      const [users] = await pool.query('SELECT COUNT(*) as count FROM users');
      totalUsers = users[0].count;

      const [companies] = await pool.query('SELECT COUNT(*) as count FROM companies');
      totalCompanies = companies[0].count;

      const [recent] = await pool.query(
        `SELECT 
          u.id,
          u.company_id,
          u.name,
          u.email,
          u.role,
          u.avatar,
          u.created_at,
          c.name as company_name 
         FROM users u 
         LEFT JOIN companies c ON u.company_id = c.id 
         ORDER BY u.created_at DESC 
         LIMIT 5`
      );
      recentUsers = recent;
    } else if (req.user.role === 'company-manager') {
      const [users] = await pool.query(
        'SELECT COUNT(*) as count FROM users WHERE company_id = ?',
        [req.user.company_id]
      );
      totalUsers = users[0].count;

      const [recent] = await pool.query(
        `SELECT 
          u.id,
          u.company_id,
          u.name,
          u.email,
          u.role,
          u.avatar,
          u.created_at,
          c.name as company_name 
         FROM users u 
         LEFT JOIN companies c ON u.company_id = c.id 
         WHERE u.company_id = ? 
         ORDER BY u.created_at DESC 
         LIMIT 5`,
        [req.user.company_id]
      );
      recentUsers = recent;
    }

    // No need to remove password - it's not selected in the query
    res.json({
      totalUsers,
      totalCompanies,
      recentUsers
    });
  } catch (error) {
    logger.error('Error in route handler', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;