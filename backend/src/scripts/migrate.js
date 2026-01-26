import 'dotenv/config';
import { runMigrations } from '../config/database.js';
import logger from '../utils/logger.js';

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
