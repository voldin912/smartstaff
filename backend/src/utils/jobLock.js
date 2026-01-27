import { pool } from '../config/database.js';
import logger from './logger.js';

/**
 * Execute a function with a distributed lock using MySQL GET_LOCK
 * Ensures GET_LOCK, processing, and RELEASE_LOCK all use the same connection
 * @param {string} lockName - Name of the lock
 * @param {number} timeoutSeconds - Lock timeout in seconds (default: 10)
 * @param {Function} callback - Function to execute while lock is held (receives connection as parameter)
 * @returns {Promise<{acquired: boolean, result?: any}>}
 */
export async function withLock(lockName, timeoutSeconds, callback) {
  const conn = await pool.getConnection();
  let lockAcquired = false;
  
  try {
    // Acquire lock on this specific connection
    const [result] = await conn.query('SELECT GET_LOCK(?, ?) as lockAcquired', [lockName, timeoutSeconds]);
    lockAcquired = result[0]?.lockAcquired === 1;
    
    if (!lockAcquired) {
      logger.warn(`Failed to acquire lock: ${lockName} (timeout: ${timeoutSeconds}s)`);
      return { acquired: false };
    }
    
    logger.debug(`Lock acquired: ${lockName}`);
    
    // Execute callback with the same connection
    const callbackResult = await callback(conn);
    
    // Release lock on the same connection
    await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
    logger.debug(`Lock released: ${lockName}`);
    
    return { acquired: true, result: callbackResult };
    
  } catch (error) {
    logger.error(`Error in withLock: ${lockName}`, error);
    
    // Try to release lock if it was acquired
    if (lockAcquired) {
      try {
        await conn.query('SELECT RELEASE_LOCK(?)', [lockName]);
        logger.debug(`Lock released after error: ${lockName}`);
      } catch (releaseError) {
        logger.error(`Error releasing lock after error: ${lockName}`, releaseError);
      }
    }
    
    throw error;
  } finally {
    // Always release the connection back to the pool
    conn.release();
  }
}

/**
 * Acquire a distributed lock using MySQL GET_LOCK (DEPRECATED - use withLock instead)
 * @deprecated Use withLock() instead to ensure same connection for GET_LOCK and RELEASE_LOCK
 * @param {string} lockName - Name of the lock
 * @param {number} timeoutSeconds - Lock timeout in seconds (default: 10)
 * @returns {Promise<boolean>} - True if lock acquired, false otherwise
 */
export async function acquireLock(lockName, timeoutSeconds = 10) {
  logger.warn('acquireLock() is deprecated. Use withLock() instead to ensure same connection for GET_LOCK and RELEASE_LOCK');
  try {
    const [result] = await pool.query('SELECT GET_LOCK(?, ?) as lockAcquired', [lockName, timeoutSeconds]);
    const lockAcquired = result[0]?.lockAcquired === 1;
    
    if (lockAcquired) {
      logger.debug(`Lock acquired: ${lockName}`);
    } else {
      logger.warn(`Failed to acquire lock: ${lockName} (timeout: ${timeoutSeconds}s)`);
    }
    
    return lockAcquired;
  } catch (error) {
    logger.error(`Error acquiring lock: ${lockName}`, error);
    return false;
  }
}

/**
 * Release a distributed lock using MySQL RELEASE_LOCK (DEPRECATED - use withLock instead)
 * @deprecated Use withLock() instead to ensure same connection for GET_LOCK and RELEASE_LOCK
 * @param {string} lockName - Name of the lock
 * @returns {Promise<boolean>} - True if lock released, false otherwise
 */
export async function releaseLock(lockName) {
  logger.warn('releaseLock() is deprecated. Use withLock() instead to ensure same connection for GET_LOCK and RELEASE_LOCK');
  try {
    const [result] = await pool.query('SELECT RELEASE_LOCK(?) as lockReleased', [lockName]);
    const lockReleased = result[0]?.lockReleased === 1;
    
    if (lockReleased) {
      logger.debug(`Lock released: ${lockName}`);
    } else {
      logger.warn(`Failed to release lock: ${lockName} (may not have been held by this connection)`);
    }
    
    return lockReleased;
  } catch (error) {
    logger.error(`Error releasing lock: ${lockName}`, error);
    return false;
  }
}

/**
 * Check if a job was recently executed (idempotency check)
 * @param {string} jobName - Name of the job
 * @param {number} intervalHours - Minimum hours between executions
 * @param {object} connection - Optional database connection (if provided, uses this connection)
 * @returns {Promise<{shouldRun: boolean, lastRun: Date|null}>}
 */
export async function shouldRunJob(jobName, intervalHours, connection = null) {
  try {
    // Check if job_runs table exists, create if not
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS job_runs (
        job_name VARCHAR(255) PRIMARY KEY,
        last_run_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `;
    
    if (connection) {
      await connection.query(createTableQuery);
    } else {
      await pool.query(createTableQuery);
    }

    const [rows] = connection
      ? await connection.query('SELECT last_run_at FROM job_runs WHERE job_name = ?', [jobName])
      : await pool.query('SELECT last_run_at FROM job_runs WHERE job_name = ?', [jobName]);

    if (rows.length === 0) {
      // Job never run before
      return { shouldRun: true, lastRun: null };
    }

    const lastRun = new Date(rows[0].last_run_at);
    const now = new Date();
    const hoursSinceLastRun = (now - lastRun) / (1000 * 60 * 60);

    if (hoursSinceLastRun >= intervalHours) {
      return { shouldRun: true, lastRun };
    }

    logger.info(`Job ${jobName} skipped: last run ${hoursSinceLastRun.toFixed(2)} hours ago (interval: ${intervalHours} hours)`);
    return { shouldRun: false, lastRun };
  } catch (error) {
    logger.error(`Error checking job run status: ${jobName}`, error);
    // On error, allow execution (fail open)
    return { shouldRun: true, lastRun: null };
  }
}

/**
 * Record that a job was executed
 * @param {string} jobName - Name of the job
 * @param {object} connection - Optional database connection (if provided, uses this connection)
 * @returns {Promise<void>}
 */
export async function recordJobRun(jobName, connection = null) {
  try {
    const query = `
      INSERT INTO job_runs (job_name, last_run_at)
      VALUES (?, NOW())
      ON DUPLICATE KEY UPDATE last_run_at = NOW()
    `;
    
    if (connection) {
      await connection.query(query, [jobName]);
    } else {
      await pool.query(query, [jobName]);
    }
    logger.debug(`Job run recorded: ${jobName}`);
  } catch (error) {
    logger.error(`Error recording job run: ${jobName}`, error);
  }
}
