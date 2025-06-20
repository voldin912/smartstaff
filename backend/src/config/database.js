import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '1234',
  database: process.env.DB_NAME || 'mydb',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  authPlugins: {
    mysql_clear_password: () => () => Buffer.from([0])
  }
};

export const pool = mysql.createPool(dbConfig);

export const initializeDatabase = async () => {
  try {
    // Create database if it doesn't exist
    const connection = await mysql.createConnection({
      ...dbConfig,
      database: undefined // Don't specify database for initial connection
    });

    await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'company_management'}`);
    await connection.end();

    // Create tables
    const companyTable = `
      CREATE TABLE IF NOT EXISTS companies (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL UNIQUE,
        slug VARCHAR(255) UNIQUE,
        logo VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    const userTable = `
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id INT,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin', 'company-manager', 'member') NOT NULL,
        avatar VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      )
    `;

    await pool.query(companyTable);
    await pool.query(userTable);

    // Check if slug column exists, if not add it (migration for existing installations)
    try {
      await pool.query('SELECT slug FROM companies LIMIT 1');
    } catch (error) {
      // Slug column doesn't exist, add it
      await pool.query('ALTER TABLE companies ADD COLUMN slug VARCHAR(255) UNIQUE AFTER name');
      await pool.query('ALTER TABLE companies ADD COLUMN logo VARCHAR(255) AFTER slug');
      
      // Update existing companies to have slugs
      const [companies] = await pool.query('SELECT id, name FROM companies WHERE slug IS NULL');
      for (const company of companies) {
        const slug = company.name
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, '')
          .replace(/\s+/g, '-')
          .replace(/-+/g, '-')
          .trim('-');
        
        // Ensure unique slug
        let uniqueSlug = slug;
        let counter = 1;
        while (true) {
          const [existing] = await pool.query('SELECT id FROM companies WHERE slug = ? AND id != ?', [uniqueSlug, company.id]);
          if (existing.length === 0) break;
          uniqueSlug = `${slug}-${counter}`;
          counter++;
        }
        
        await pool.query('UPDATE companies SET slug = ? WHERE id = ?', [uniqueSlug, company.id]);
      }
    }

    // Create admin user if it doesn't exist
    const [adminExists] = await pool.query('SELECT * FROM users WHERE role = "admin" LIMIT 1');
    if (adminExists.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        ['Admin', 'admin@example.com', hashedPassword, 'admin']
      );
    }

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}; 