import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

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

async function runMigration() {
  const connection = await mysql.createConnection(dbConfig);
  
  try {
    console.log('Running migration to add staff_memo column...');
    
    // Check if staff_memo column exists
    try {
      await connection.query('SELECT staff_memo FROM career_mappings LIMIT 1');
      console.log('staff_memo column already exists');
    } catch (error) {
      // staff_memo column doesn't exist, add it
      await connection.query('ALTER TABLE career_mappings ADD COLUMN staff_memo VARCHAR(255) AFTER job_description_field');
      console.log('staff_memo column added successfully');
    }
    
    console.log('Migration completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await connection.end();
  }
}

runMigration(); 