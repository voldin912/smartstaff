import logger from './logger.js';

const JWT_SECRET = process.env.JWT_SECRET;
const MIN_LENGTH = 32; // Minimum 32 bytes (256 bits) for security

// Validate JWT_SECRET is set
if (!JWT_SECRET) {
  logger.error('FATAL: JWT_SECRET environment variable is required but not set');
  logger.error('Please set JWT_SECRET in your .env file (minimum 32 bytes for security)');
  logger.error('You can generate a secure key using:');
  logger.error('  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

// Validate JWT_SECRET length (minimum 32 bytes/characters)
if (JWT_SECRET.length < MIN_LENGTH) {
  logger.error(`FATAL: JWT_SECRET is too short (${JWT_SECRET.length} characters, minimum ${MIN_LENGTH} required)`);
  logger.error('JWT_SECRET must be at least 32 bytes (256 bits) for security');
  logger.error('Generate a new secure key using:');
  logger.error('  node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

// Export the validated secret
export const jwtSecret = JWT_SECRET;
