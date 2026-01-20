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

    const careerMappingsTable = `
      CREATE TABLE IF NOT EXISTS career_mappings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id VARCHAR(255) NOT NULL,
        career_index INT NOT NULL,
        job_description_field VARCHAR(255),
        staff_memo VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_company_career (company_id, career_index)
      )
    `;

    await pool.query(companyTable);
    await pool.query(userTable);
    await pool.query(careerMappingsTable);

    // Create salesforce settings table
    const salesforceTable = `
      CREATE TABLE IF NOT EXISTS salesforce (
        id INT PRIMARY KEY AUTO_INCREMENT,
        company_id VARCHAR(255) NOT NULL UNIQUE,
        base_url VARCHAR(500),
        username VARCHAR(255),
        password VARCHAR(255),
        security_token VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;

    await pool.query(salesforceTable);

    // Create records table
    const recordsTable = `
      CREATE TABLE IF NOT EXISTS records (
        id INT PRIMARY KEY AUTO_INCREMENT,
        file_id VARCHAR(255),
        staff_id INT,
        employee_id VARCHAR(255),
        staff_name VARCHAR(255) DEFAULT '',
        memo TEXT DEFAULT '',
        audio_file_path VARCHAR(500),
        stt TEXT,
        skill_sheet LONGTEXT,
        lor LONGTEXT,
        salesforce LONGTEXT,
        skills LONGTEXT,
        hope LONGTEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `;

    // Create follows table
    const followsTable = `
      CREATE TABLE IF NOT EXISTS follows (
        id INT PRIMARY KEY AUTO_INCREMENT,
        file_id VARCHAR(255),
        staff_id INT,
        employee_id VARCHAR(255),
        audio_file_path VARCHAR(500),
        stt TEXT,
        skill_sheet LONGTEXT,
        lor LONGTEXT,
        salesforce LONGTEXT,
        skills LONGTEXT,
        hope LONGTEXT,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `;

    await pool.query(recordsTable);
    await pool.query(followsTable);

    // Migration: Add staff_name and memo columns to records table if they don't exist
    try {
      await pool.query('SELECT staff_name FROM records LIMIT 1');
    } catch (error) {
      // staff_name column doesn't exist, add it
      await pool.query('ALTER TABLE records ADD COLUMN staff_name VARCHAR(255) DEFAULT "" AFTER employee_id');
    }

    try {
      await pool.query('SELECT memo FROM records LIMIT 1');
    } catch (error) {
      // memo column doesn't exist, add it
      await pool.query('ALTER TABLE records ADD COLUMN memo TEXT DEFAULT "" AFTER staff_name');
    }

    // Check if staff_memo column exists, if not add it (migration for existing installations)
    try {
      await pool.query('SELECT staff_memo FROM career_mappings LIMIT 1');
    } catch (error) {
      // staff_memo column doesn't exist, add it
      await pool.query('ALTER TABLE career_mappings ADD COLUMN staff_memo VARCHAR(255) AFTER job_description_field');
    }

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

    // Check if salesforce table exists, if not create it (migration for existing installations)
    try {
      await pool.query('SELECT * FROM salesforce LIMIT 1');
    } catch (error) {
      // salesforce table doesn't exist, create it
      const salesforceTable = `
        CREATE TABLE IF NOT EXISTS salesforce (
          id INT PRIMARY KEY AUTO_INCREMENT,
          company_id VARCHAR(255) NOT NULL UNIQUE,
          base_url VARCHAR(500),
          username VARCHAR(255),
          password VARCHAR(255),
          security_token VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `;
      await pool.query(salesforceTable);
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