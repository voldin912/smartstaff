import crypto from 'crypto';
import logger from './logger.js';

// Validate encryption key
if (!process.env.ENCRYPTION_KEY) {
  logger.error('FATAL: ENCRYPTION_KEY environment variable is required but not set');
  logger.error('Please set ENCRYPTION_KEY in your .env file (32 bytes for AES-256)');
  logger.error('You can generate a key using: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes for AES
const TAG_LENGTH = 16; // 16 bytes for GCM tag

// Ensure key is 32 bytes (256 bits) for AES-256
function getKey() {
  // If key is provided as hex string (64 chars = 32 bytes), convert it
  if (ENCRYPTION_KEY.length === 64 && /^[0-9a-fA-F]+$/.test(ENCRYPTION_KEY)) {
    return Buffer.from(ENCRYPTION_KEY, 'hex');
  }
  // Otherwise, derive a 32-byte key using SHA-256
  return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

const key = getKey();

/**
 * Encrypt sensitive data
 * @param {string} text - Plain text to encrypt
 * @returns {string} - Encrypted text (hex encoded)
 */
export function encrypt(text) {
  if (!text) return null;
  
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();
    
    // Combine: iv + tag + encrypted data
    const combined = Buffer.concat([
      iv,
      tag,
      Buffer.from(encrypted, 'hex')
    ]);
    
    return combined.toString('hex');
  } catch (error) {
    logger.error('Encryption error', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt sensitive data
 * @param {string} encryptedHex - Encrypted text (hex encoded) or plain text (for backward compatibility)
 * @returns {string} - Decrypted plain text
 */
export function decrypt(encryptedHex) {
  if (!encryptedHex) return null;
  
  try {
    // Check if it's a valid hex string and long enough to be encrypted
    // Encrypted data should be at least IV_LENGTH + TAG_LENGTH + some encrypted data
    const minEncryptedLength = (IV_LENGTH + TAG_LENGTH) * 2; // *2 because hex encoding
    
    if (encryptedHex.length < minEncryptedLength || !/^[0-9a-fA-F]+$/.test(encryptedHex)) {
      // Likely plain text (legacy data), return as-is
      logger.debug('Data appears to be plain text (legacy), returning as-is');
      return encryptedHex;
    }
    
    const combined = Buffer.from(encryptedHex, 'hex');
    
    // Verify we have enough data
    if (combined.length < IV_LENGTH + TAG_LENGTH) {
      // Not enough data for encrypted format, assume plain text
      logger.debug('Data too short for encrypted format, returning as-is');
      return encryptedHex;
    }
    
    // Extract components
    const iv = combined.slice(0, IV_LENGTH);
    const tag = combined.slice(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.slice(IV_LENGTH + TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // If decryption fails, assume it's plain text (backward compatibility)
    logger.debug('Decryption failed, assuming plain text (legacy data)', { error: error.message });
    return encryptedHex;
  }
}

/**
 * Mask sensitive data for API responses
 * @param {string} value - Value to mask
 * @returns {string} - Masked value (shows only last 4 characters)
 */
export function mask(value) {
  if (!value) return '';
  if (value.length <= 4) return '****';
  return '****' + value.slice(-4);
}
