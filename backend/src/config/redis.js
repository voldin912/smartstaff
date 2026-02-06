import Redis from 'ioredis';
import logger from '../utils/logger.js';

/**
 * Redis connection for BullMQ job queue
 * 
 * Configuration options:
 * - REDIS_URL: Full Redis connection URL (e.g., redis://localhost:6379)
 * - REDIS_HOST: Redis host (default: localhost)
 * - REDIS_PORT: Redis port (default: 6379)
 * - REDIS_PASSWORD: Redis password (optional)
 */

const getRedisConfig = () => {
  // If REDIS_URL is provided, use it directly
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  // Otherwise, build config from individual env vars
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required for BullMQ
  };
};

/**
 * Create a new Redis connection
 * BullMQ requires separate connections for queue and worker
 */
export const createRedisConnection = () => {
  const config = getRedisConfig();
  
  const connection = new Redis(config, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 10) {
        logger.error('Redis connection failed after 10 retries');
        return null; // Stop retrying
      }
      const delay = Math.min(times * 500, 5000);
      logger.warn(`Redis connection retry ${times}, waiting ${delay}ms`);
      return delay;
    },
  });

  connection.on('connect', () => {
    logger.info('Redis connected');
  });

  connection.on('error', (err) => {
    logger.error('Redis connection error', err);
  });

  connection.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return connection;
};

// Default shared connection for queue operations (adding jobs)
let sharedConnection = null;

export const getSharedRedisConnection = () => {
  if (!sharedConnection) {
    sharedConnection = createRedisConnection();
  }
  return sharedConnection;
};

export default { createRedisConnection, getSharedRedisConnection };
