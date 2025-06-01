const express = require('express');
const { pool } = require('../config/database');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.get('/stats', auth, async (req, res) => {
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
        `SELECT u.*, c.name as company_name 
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
        `SELECT u.*, c.name as company_name 
         FROM users u 
         LEFT JOIN companies c ON u.company_id = c.id 
         WHERE u.company_id = ? 
         ORDER BY u.created_at DESC 
         LIMIT 5`,
        [req.user.company_id]
      );
      recentUsers = recent;
    }

    // Remove sensitive information from recent users
    recentUsers = recentUsers.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({
      totalUsers,
      totalCompanies,
      recentUsers
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;