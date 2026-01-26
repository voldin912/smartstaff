import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger.js';

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

// Check if auto-migrations are enabled (default: true for development, false for production)
const ENABLE_AUTO_MIGRATIONS = process.env.ENABLE_AUTO_MIGRATIONS !== 'false' && process.env.ENABLE_AUTO_MIGRATIONS !== '0';
const NODE_ENV = process.env.NODE_ENV || 'development';

export const initializeDatabase = async () => {
  try {
    // Create database if it doesn't exist (safe operation)
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
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
        INDEX idx_company_user (company_id, id)
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
        user_id INT,
        company_id INT,
        staff_id VARCHAR(255),
        staff_name VARCHAR(255) DEFAULT '',
        memo TEXT DEFAULT '',
        audio_file_path VARCHAR(500),
        stt TEXT,
        skill_sheet LONGTEXT,
        lor LONGTEXT,
        salesforce LONGTEXT,
        skills LONGTEXT,
        hope LONGTEXT,
        date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
        INDEX idx_company_id (company_id),
        INDEX idx_company_created (company_id, created_at DESC),
        INDEX idx_user_created (user_id, created_at DESC),
        INDEX idx_created_at (created_at DESC),
        INDEX idx_user_id (user_id)
      )
    `;

    // Create follows table
    const followsTable = `
      CREATE TABLE IF NOT EXISTS follows (
        id INT PRIMARY KEY AUTO_INCREMENT,
        file_id VARCHAR(255),
        user_id INT,
        staff_id VARCHAR(255),
        audio_file_path VARCHAR(500),
        stt TEXT,
        skill_sheet LONGTEXT,
        lor LONGTEXT,
        salesforce LONGTEXT,
        skills LONGTEXT,
        hope LONGTEXT,
        date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        INDEX idx_follows_user_created (user_id, created_at DESC)
      )
    `;

    await pool.query(recordsTable);
    await pool.query(followsTable);

    // ============================================
    // MIGRATION OPERATIONS - Only run if enabled
    // ============================================
    if (ENABLE_AUTO_MIGRATIONS) {
      logger.info('Auto-migrations enabled - running migration operations');
      await runMigrations();
    } else {
      logger.warn('Auto-migrations DISABLED - skipping ALTER/UPDATE operations. Run migrations manually using: npm run migrate');
      if (NODE_ENV === 'production') {
        logger.warn('Production mode detected - migrations must be run manually to avoid DB locks and downtime');
      }
    }

    // Create admin user if it doesn't exist (safe operation - always run)
    const [adminExists] = await pool.query('SELECT * FROM users WHERE role = "admin" LIMIT 1');
    if (adminExists.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
        ['Admin', 'admin@example.com', hashedPassword, 'admin']
      );
    }

    logger.info('Database initialized successfully');
  } catch (error) {
    logger.error('Error initializing database', error);
    throw error;
  }
};

// Migration operations - separated for manual execution
export const runMigrations = async () => {
  try {
    logger.info('Starting database migrations...');

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

    // Migration: Add company_id column to records table if it doesn't exist
    await addCompanyIdToRecords();
    
    // Backfill company_id for existing records
    await backfillCompanyId();
    
    // Migration: Rename columns (staff_id -> user_id, employee_id -> staff_id)
    await renameRecordsColumns();
    await renameFollowsColumns();
    
    // Migration: Add performance indexes
    await addPerformanceIndexes();
    
    // Migration: Optimize sort columns (add NOT NULL, backfill NULLs, update indexes)
    await optimizeSortColumns();
    await renameFollowsColumns();

    logger.info('Database migrations completed successfully');
  } catch (error) {
    logger.error('Error running migrations', error);
    throw error;
  }
};

// Migration function: Add company_id column to records table
const addCompanyIdToRecords = async () => {
  try {
    const dbName = process.env.DB_NAME || 'company_management';
    // Check if column exists
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'records' 
      AND COLUMN_NAME = 'company_id'
    `, [dbName]);
    
    if (columns.length === 0) {
      // Add column with index and foreign key
      await pool.query(`
        ALTER TABLE records 
        ADD COLUMN company_id INT AFTER staff_id
      `);
      
      // Add index
      await pool.query(`
        ALTER TABLE records 
        ADD INDEX idx_company_id (company_id)
      `);
      
      // Add foreign key constraint
      await pool.query(`
        ALTER TABLE records 
        ADD CONSTRAINT fk_records_company 
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      `);
      
      logger.info('Added company_id column to records table');
    } else {
      logger.debug('company_id column already exists in records table');
    }
  } catch (error) {
    logger.error('Error adding company_id to records', error);
    // Don't throw - allow initialization to continue
  }
};

// Backfill function: Populate company_id for existing records
const backfillCompanyId = async () => {
  try {
    // Check if user_id column exists (new name) or staff_id (old name)
    const dbName = process.env.DB_NAME || 'company_management';
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'records' 
      AND COLUMN_NAME IN ('user_id', 'staff_id')
    `, [dbName]);
    
    const userIdColumn = columns.find(col => col.COLUMN_NAME === 'user_id');
    const staffIdColumn = columns.find(col => col.COLUMN_NAME === 'staff_id');
    
    // Use appropriate column name
    const joinColumn = userIdColumn ? 'user_id' : 'staff_id';
    
    // Update records with company_id from users table
    const [result] = await pool.query(`
      UPDATE records r
      INNER JOIN users u ON r.${joinColumn} = u.id
      SET r.company_id = u.company_id
      WHERE r.company_id IS NULL AND u.company_id IS NOT NULL
    `);
    
    logger.info(`Backfilled company_id for ${result.affectedRows} existing records`);
    
    // Check for records that couldn't be backfilled
    const [nullRecords] = await pool.query(`
      SELECT COUNT(*) as count 
      FROM records 
      WHERE company_id IS NULL AND ${joinColumn} IS NOT NULL
    `);
    
    if (nullRecords[0].count > 0) {
      logger.warn(`Warning: ${nullRecords[0].count} records have NULL company_id (${joinColumn} exists but user not found or user has no company_id)`);
    }
  } catch (error) {
    logger.error('Error backfilling company_id', error);
    // Don't throw - allow initialization to continue
  }
};

// Migration function: Rename columns in records table
const renameRecordsColumns = async () => {
  try {
    const dbName = process.env.DB_NAME || 'company_management';
    
    // Check current column names
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'records' 
      AND COLUMN_NAME IN ('staff_id', 'employee_id', 'user_id')
    `, [dbName]);
    
    const columnNames = columns.map(col => col.COLUMN_NAME);
    const hasOldStaffId = columnNames.includes('staff_id');
    const hasOldEmployeeId = columnNames.includes('employee_id');
    const hasNewUserId = columnNames.includes('user_id');
    const hasNewStaffId = columnNames.includes('staff_id') && !hasOldEmployeeId; // staff_id exists but employee_id doesn't (already renamed)
    
    // Step 1: Rename staff_id to user_id (if it exists and user_id doesn't)
    if (hasOldStaffId && !hasNewUserId) {
      // First, drop the foreign key constraint
      try {
        await pool.query(`ALTER TABLE records DROP FOREIGN KEY records_ibfk_1`);
      } catch (error) {
        // Try alternative constraint name
        try {
          await pool.query(`ALTER TABLE records DROP FOREIGN KEY fk_records_user`);
        } catch (e) {
          // Constraint might have different name, try to find it
          const [constraints] = await pool.query(`
            SELECT CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_NAME = 'records' 
            AND COLUMN_NAME = 'staff_id' 
            AND REFERENCED_TABLE_NAME = 'users'
          `, [dbName]);
          
          if (constraints.length > 0) {
            await pool.query(`ALTER TABLE records DROP FOREIGN KEY ${constraints[0].CONSTRAINT_NAME}`);
          }
        }
      }
      
      // Rename column
      await pool.query(`ALTER TABLE records CHANGE COLUMN staff_id user_id INT`);
      
      // Recreate foreign key with new name
      await pool.query(`
        ALTER TABLE records 
        ADD CONSTRAINT fk_records_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      
      logger.info('Renamed staff_id to user_id in records table');
    }
    
    // Step 2: Rename employee_id to staff_id (if it exists)
    if (hasOldEmployeeId && !hasNewStaffId) {
      await pool.query(`ALTER TABLE records CHANGE COLUMN employee_id staff_id VARCHAR(255)`);
      logger.info('Renamed employee_id to staff_id in records table');
    }
    
    // Update staff_name column position if needed (should be after staff_id)
    if (hasNewStaffId || hasOldEmployeeId) {
      try {
        await pool.query(`ALTER TABLE records MODIFY COLUMN staff_name VARCHAR(255) DEFAULT '' AFTER staff_id`);
      } catch (error) {
        // Column position update might fail, but that's okay
        logger.debug('Note: Could not update staff_name column position');
      }
    }
  } catch (error) {
      logger.error('Error renaming columns in records table', error);
    // Don't throw - allow initialization to continue
  }
};

// Migration function: Rename columns in follows table
const renameFollowsColumns = async () => {
  try {
    const dbName = process.env.DB_NAME || 'company_management';
    
    // Check current column names
    const [columns] = await pool.query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = ? 
      AND TABLE_NAME = 'follows' 
      AND COLUMN_NAME IN ('staff_id', 'employee_id', 'user_id')
    `, [dbName]);
    
    const columnNames = columns.map(col => col.COLUMN_NAME);
    const hasOldStaffId = columnNames.includes('staff_id') && columnNames.some(c => c === 'employee_id');
    const hasOldEmployeeId = columnNames.includes('employee_id');
    const hasNewUserId = columnNames.includes('user_id');
    const hasNewStaffId = columnNames.includes('staff_id') && !columnNames.includes('employee_id');
    
    // Step 1: Rename staff_id to user_id (if it exists and user_id doesn't)
    if (hasOldStaffId && !hasNewUserId) {
      // First, drop the foreign key constraint
      try {
        await pool.query(`ALTER TABLE follows DROP FOREIGN KEY follows_ibfk_1`);
      } catch (error) {
        // Try alternative constraint name
        try {
          await pool.query(`ALTER TABLE follows DROP FOREIGN KEY fk_follows_user`);
        } catch (e) {
          // Constraint might have different name, try to find it
          const [constraints] = await pool.query(`
            SELECT CONSTRAINT_NAME 
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
            WHERE TABLE_SCHEMA = ? 
            AND TABLE_NAME = 'follows' 
            AND COLUMN_NAME = 'staff_id' 
            AND REFERENCED_TABLE_NAME = 'users'
          `, [dbName]);
          
          if (constraints.length > 0) {
            await pool.query(`ALTER TABLE follows DROP FOREIGN KEY ${constraints[0].CONSTRAINT_NAME}`);
          }
        }
      }
      
      // Rename column
      await pool.query(`ALTER TABLE follows CHANGE COLUMN staff_id user_id INT`);
      
      // Recreate foreign key with new name
      await pool.query(`
        ALTER TABLE follows 
        ADD CONSTRAINT fk_follows_user 
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      `);
      
      logger.info('Renamed staff_id to user_id in follows table');
    }
    
    // Step 2: Rename employee_id to staff_id (if it exists)
    if (hasOldEmployeeId && !hasNewStaffId) {
      await pool.query(`ALTER TABLE follows CHANGE COLUMN employee_id staff_id VARCHAR(255)`);
      logger.info('Renamed employee_id to staff_id in follows table');
    }
  } catch (error) {
    logger.error('Error renaming columns in follows table', error);
    // Don't throw - allow initialization to continue
  }
};

// Migration function: Add performance indexes
const addPerformanceIndexes = async () => {
  try {
    const dbName = process.env.DB_NAME || 'company_management';
    
    // Helper function to check if index exists
    const indexExists = async (tableName, indexName) => {
      try {
        const [indexes] = await pool.query(`
          SELECT INDEX_NAME 
          FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA = ? 
          AND TABLE_NAME = ? 
          AND INDEX_NAME = ?
        `, [dbName, tableName, indexName]);
        return indexes.length > 0;
      } catch (error) {
        return false;
      }
    };
    
    // Helper function to create index if not exists
    const createIndexIfNotExists = async (tableName, indexName, indexDefinition) => {
      const exists = await indexExists(tableName, indexName);
      if (!exists) {
        try {
          await pool.query(`CREATE INDEX ${indexName} ON ${tableName} ${indexDefinition}`);
          logger.info(`Created index ${indexName} on ${tableName}`);
        } catch (error) {
          logger.error(`Error creating index ${indexName} on ${tableName}`, error);
        }
      } else {
        logger.debug(`Index ${indexName} on ${tableName} already exists`);
      }
    };
    
    // Records table indexes (using created_at for sorting)
    await createIndexIfNotExists('records', 'idx_company_created', '(company_id, created_at DESC)');
    await createIndexIfNotExists('records', 'idx_user_created', '(user_id, created_at DESC)');
    await createIndexIfNotExists('records', 'idx_created_at', '(created_at DESC)');
    await createIndexIfNotExists('records', 'idx_user_id', '(user_id)');
    
    // Users table indexes
    await createIndexIfNotExists('users', 'idx_company_user', '(company_id, id)');
    
    // Follows table indexes (using created_at for sorting)
    await createIndexIfNotExists('follows', 'idx_follows_user_created', '(user_id, created_at DESC)');
    
    logger.info('Performance indexes migration completed');
  } catch (error) {
    logger.error('Error adding performance indexes', error);
    // Don't throw - allow initialization to continue
  }
};

// Migration function: Optimize sort columns (add NOT NULL, backfill NULLs, update indexes)
const optimizeSortColumns = async () => {
  try {
    const dbName = process.env.DB_NAME || 'company_management';
    
    // Step 1: Backfill NULL dates with created_at
    try {
      const [dateResult] = await pool.query(`
        UPDATE records 
        SET date = created_at 
        WHERE date IS NULL AND created_at IS NOT NULL
      `);
      logger.info(`Backfilled ${dateResult.affectedRows} NULL dates in records table`);
    } catch (error) {
      logger.error('Error backfilling NULL dates in records', error);
    }
    
    try {
      const [followsResult] = await pool.query(`
        UPDATE follows 
        SET date = created_at 
        WHERE date IS NULL AND created_at IS NOT NULL
      `);
      logger.info(`Backfilled ${followsResult.affectedRows} NULL dates in follows table`);
    } catch (error) {
      logger.error('Error backfilling NULL dates in follows', error);
    }
    
    // Step 2: Add NOT NULL constraint to date and created_at columns
    // Check if columns allow NULL
    try {
      const [recordsColumns] = await pool.query(`
        SELECT COLUMN_NAME, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'records' 
        AND COLUMN_NAME IN ('date', 'created_at')
      `, [dbName]);
      
      for (const col of recordsColumns) {
        if (col.IS_NULLABLE === 'YES') {
          try {
            await pool.query(`ALTER TABLE records MODIFY COLUMN ${col.COLUMN_NAME} TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
            logger.info(`Added NOT NULL constraint to records.${col.COLUMN_NAME}`);
          } catch (error) {
            logger.error(`Error adding NOT NULL to records.${col.COLUMN_NAME}`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Error checking records columns', error);
    }
    
    try {
      const [followsColumns] = await pool.query(`
        SELECT COLUMN_NAME, IS_NULLABLE 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = ? 
        AND TABLE_NAME = 'follows' 
        AND COLUMN_NAME IN ('date', 'created_at')
      `, [dbName]);
      
      for (const col of followsColumns) {
        if (col.IS_NULLABLE === 'YES') {
          try {
            await pool.query(`ALTER TABLE follows MODIFY COLUMN ${col.COLUMN_NAME} TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`);
            logger.info(`Added NOT NULL constraint to follows.${col.COLUMN_NAME}`);
          } catch (error) {
            logger.error(`Error adding NOT NULL to follows.${col.COLUMN_NAME}`, error);
          }
        }
      }
    } catch (error) {
      logger.error('Error checking follows columns', error);
    }
    
    // Step 3: Update indexes to use created_at instead of date
    // Drop old indexes that use date
    const dropIndexIfExists = async (tableName, indexName) => {
      try {
        const [indexes] = await pool.query(`
          SELECT INDEX_NAME 
          FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA = ? 
          AND TABLE_NAME = ? 
          AND INDEX_NAME = ?
        `, [dbName, tableName, indexName]);
        
        if (indexes.length > 0) {
          await pool.query(`DROP INDEX ${indexName} ON ${tableName}`);
          logger.debug(`Dropped index ${indexName} on ${tableName}`);
        }
      } catch (error) {
        // Index might not exist, that's okay
      }
    };
    
    // Create new indexes with created_at
    const createIndexIfNotExists = async (tableName, indexName, indexDefinition) => {
      try {
        const [indexes] = await pool.query(`
          SELECT INDEX_NAME 
          FROM INFORMATION_SCHEMA.STATISTICS 
          WHERE TABLE_SCHEMA = ? 
          AND TABLE_NAME = ? 
          AND INDEX_NAME = ?
        `, [dbName, tableName, indexName]);
        
        if (indexes.length === 0) {
          await pool.query(`CREATE INDEX ${indexName} ON ${tableName} ${indexDefinition}`);
          logger.info(`Created index ${indexName} on ${tableName}`);
        } else {
          logger.debug(`Index ${indexName} on ${tableName} already exists`);
        }
      } catch (error) {
        logger.error(`Error creating index ${indexName} on ${tableName}`, error);
      }
    };
    
    // Records table: Drop old date indexes, create new created_at indexes
    await dropIndexIfExists('records', 'idx_company_date');
    await dropIndexIfExists('records', 'idx_user_date');
    await dropIndexIfExists('records', 'idx_date');
    
    await createIndexIfNotExists('records', 'idx_company_created', '(company_id, created_at DESC)');
    await createIndexIfNotExists('records', 'idx_user_created', '(user_id, created_at DESC)');
    await createIndexIfNotExists('records', 'idx_created_at', '(created_at DESC)');
    
    // Follows table: Drop old date index, create new created_at index
    await dropIndexIfExists('follows', 'idx_follows_user_date');
    await createIndexIfNotExists('follows', 'idx_follows_user_created', '(user_id, created_at DESC)');
    
    logger.info('Sort column optimization completed');
  } catch (error) {
    logger.error('Error optimizing sort columns', error);
    // Don't throw - allow initialization to continue
  }
};