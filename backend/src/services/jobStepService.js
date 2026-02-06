/**
 * Job Step Service
 * 
 * Manages step tracking for audio processing jobs.
 * Each job goes through multiple steps, and this service tracks
 * the status, timing, and errors for each step.
 */

import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

// Step definitions with order
export const STEP_DEFINITIONS = {
  convert: { name: 'convert', order: 1, description: 'Audio format conversion' },
  split: { name: 'split', order: 2, description: 'Audio splitting' },
  stt: { name: 'stt', order: 3, description: 'Speech-to-text processing' },
  dify_workflow: { name: 'dify_workflow', order: 4, description: 'Dify AI workflow' },
  persist: { name: 'persist', order: 5, description: 'Save to database' },
  cleanup: { name: 'cleanup', order: 6, description: 'File cleanup' },
};

// Step names as array for iteration
export const STEP_NAMES = Object.keys(STEP_DEFINITIONS);

/**
 * Initialize all steps for a job
 * Creates pending step records for each step in the process
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<boolean>} Success status
 */
export async function initializeSteps(jobId) {
  try {
    const values = STEP_NAMES.map(stepName => {
      const step = STEP_DEFINITIONS[stepName];
      return [jobId, step.name, step.order, 'pending'];
    });

    // Use INSERT IGNORE to handle cases where steps already exist
    await pool.query(
      `INSERT IGNORE INTO job_steps (job_id, step_name, step_order, status)
       VALUES ?`,
      [values]
    );

    logger.debug('Job steps initialized', { jobId, stepCount: STEP_NAMES.length });
    return true;
  } catch (error) {
    logger.error('Failed to initialize job steps', { jobId, error: error.message });
    return false;
  }
}

/**
 * Start a step - marks it as running and records start time
 * 
 * @param {number} jobId - The job ID
 * @param {string} stepName - The step name
 * @returns {Promise<{success: boolean, startTime: Date}>}
 */
export async function startStep(jobId, stepName) {
  try {
    const startTime = new Date();
    
    const [result] = await pool.query(
      `UPDATE job_steps 
       SET status = 'running', 
           started_at = ?,
           error_message = NULL
       WHERE job_id = ? AND step_name = ?`,
      [startTime, jobId, stepName]
    );

    if (result.affectedRows === 0) {
      // Step doesn't exist, create it
      const step = STEP_DEFINITIONS[stepName];
      if (step) {
        await pool.query(
          `INSERT INTO job_steps (job_id, step_name, step_order, status, started_at)
           VALUES (?, ?, ?, 'running', ?)`,
          [jobId, stepName, step.order, startTime]
        );
      }
    }

    logger.info('Step started', { jobId, step: stepName });
    return { success: true, startTime };
  } catch (error) {
    logger.error('Failed to start step', { jobId, step: stepName, error: error.message });
    return { success: false, startTime: null };
  }
}

/**
 * Complete a step - marks it as completed with duration
 * 
 * @param {number} jobId - The job ID
 * @param {string} stepName - The step name
 * @param {object} metadata - Optional metadata to store
 * @returns {Promise<{success: boolean, durationMs: number}>}
 */
export async function completeStep(jobId, stepName, metadata = null) {
  try {
    const completedAt = new Date();
    
    // Get start time to calculate duration
    const [rows] = await pool.query(
      'SELECT started_at FROM job_steps WHERE job_id = ? AND step_name = ?',
      [jobId, stepName]
    );

    let durationMs = null;
    if (rows.length > 0 && rows[0].started_at) {
      durationMs = completedAt.getTime() - new Date(rows[0].started_at).getTime();
    }

    await pool.query(
      `UPDATE job_steps 
       SET status = 'completed', 
           completed_at = ?,
           duration_ms = ?,
           metadata = ?
       WHERE job_id = ? AND step_name = ?`,
      [completedAt, durationMs, metadata ? JSON.stringify(metadata) : null, jobId, stepName]
    );

    logger.info('Step completed', { 
      jobId, 
      step: stepName, 
      durationMs,
      metadata: metadata ? Object.keys(metadata) : null
    });
    
    return { success: true, durationMs };
  } catch (error) {
    logger.error('Failed to complete step', { jobId, step: stepName, error: error.message });
    return { success: false, durationMs: null };
  }
}

/**
 * Fail a step - marks it as failed with error message
 * 
 * @param {number} jobId - The job ID
 * @param {string} stepName - The step name
 * @param {string|Error} error - Error message or Error object
 * @returns {Promise<boolean>}
 */
export async function failStep(jobId, stepName, error) {
  try {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const completedAt = new Date();
    
    // Get start time to calculate duration
    const [rows] = await pool.query(
      'SELECT started_at FROM job_steps WHERE job_id = ? AND step_name = ?',
      [jobId, stepName]
    );

    let durationMs = null;
    if (rows.length > 0 && rows[0].started_at) {
      durationMs = completedAt.getTime() - new Date(rows[0].started_at).getTime();
    }

    await pool.query(
      `UPDATE job_steps 
       SET status = 'failed', 
           completed_at = ?,
           duration_ms = ?,
           error_message = ?
       WHERE job_id = ? AND step_name = ?`,
      [completedAt, durationMs, errorMessage, jobId, stepName]
    );

    logger.error('Step failed', { 
      jobId, 
      step: stepName, 
      durationMs,
      error: errorMessage
    });
    
    return true;
  } catch (err) {
    logger.error('Failed to record step failure', { jobId, step: stepName, error: err.message });
    return false;
  }
}

/**
 * Skip a step - marks it as skipped (e.g., conversion not needed)
 * 
 * @param {number} jobId - The job ID
 * @param {string} stepName - The step name
 * @param {string} reason - Reason for skipping
 * @returns {Promise<boolean>}
 */
export async function skipStep(jobId, stepName, reason = null) {
  try {
    await pool.query(
      `UPDATE job_steps 
       SET status = 'skipped', 
           completed_at = NOW(),
           metadata = ?
       WHERE job_id = ? AND step_name = ?`,
      [reason ? JSON.stringify({ reason }) : null, jobId, stepName]
    );

    logger.info('Step skipped', { jobId, step: stepName, reason });
    return true;
  } catch (error) {
    logger.error('Failed to skip step', { jobId, step: stepName, error: error.message });
    return false;
  }
}

/**
 * Get all steps for a job
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<Array>} Array of step records
 */
export async function getJobSteps(jobId) {
  try {
    const [rows] = await pool.query(
      `SELECT 
        step_name, step_order, status, 
        started_at, completed_at, duration_ms,
        error_message, metadata
       FROM job_steps 
       WHERE job_id = ?
       ORDER BY step_order`,
      [jobId]
    );

    return rows.map(row => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null
    }));
  } catch (error) {
    logger.error('Failed to get job steps', { jobId, error: error.message });
    return [];
  }
}

/**
 * Get the current (running or last completed) step for a job
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<object|null>} Current step info
 */
export async function getCurrentStep(jobId) {
  try {
    // First try to find a running step
    const [running] = await pool.query(
      `SELECT step_name, step_order, started_at
       FROM job_steps 
       WHERE job_id = ? AND status = 'running'
       ORDER BY step_order DESC
       LIMIT 1`,
      [jobId]
    );

    if (running.length > 0) {
      return { ...running[0], isRunning: true };
    }

    // If no running step, get the last completed/failed step
    const [last] = await pool.query(
      `SELECT step_name, step_order, status, completed_at
       FROM job_steps 
       WHERE job_id = ? AND status IN ('completed', 'failed')
       ORDER BY step_order DESC
       LIMIT 1`,
      [jobId]
    );

    if (last.length > 0) {
      return { ...last[0], isRunning: false };
    }

    return null;
  } catch (error) {
    logger.error('Failed to get current step', { jobId, error: error.message });
    return null;
  }
}

/**
 * Get summary of job steps for debugging
 * 
 * @param {number} jobId - The job ID
 * @returns {Promise<object>} Summary with counts and failed step info
 */
export async function getStepsSummary(jobId) {
  try {
    const steps = await getJobSteps(jobId);
    
    const summary = {
      total: steps.length,
      completed: 0,
      failed: 0,
      running: 0,
      pending: 0,
      skipped: 0,
      failedStep: null,
      totalDurationMs: 0,
    };

    for (const step of steps) {
      summary[step.status]++;
      if (step.duration_ms) {
        summary.totalDurationMs += step.duration_ms;
      }
      if (step.status === 'failed') {
        summary.failedStep = {
          name: step.step_name,
          error: step.error_message,
          durationMs: step.duration_ms
        };
      }
    }

    return summary;
  } catch (error) {
    logger.error('Failed to get steps summary', { jobId, error: error.message });
    return null;
  }
}

export default {
  STEP_DEFINITIONS,
  STEP_NAMES,
  initializeSteps,
  startStep,
  completeStep,
  failStep,
  skipStep,
  getJobSteps,
  getCurrentStep,
  getStepsSummary,
};
