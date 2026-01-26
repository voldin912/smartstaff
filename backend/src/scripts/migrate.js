import 'dotenv/config';
import { runMigrations } from '../config/database.js';
import logger from '../utils/logger.js';

// Validate DB_NAME before running migrations
if (!process.env.DB_NAME) {
  logger.error('FATAL: DB_NAME environment variable is required but not set');
  logger.error('Please set DB_NAME in your .env file or environment variables');
  process.exit(1);
}

(async () => {
  try {
    logger.info('Starting manual database migration...');
    await runMigrations();
    logger.info('Migration completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', error);
    process.exit(1);
  }
})();
