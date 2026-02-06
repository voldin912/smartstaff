import 'dotenv/config';
import { Worker } from 'bullmq';
import { createRedisConnection } from '../config/redis.js';
import { processAudioJob, updateJobStatus } from '../services/asyncProcessingService.js';
import { startReaper, stopReaper, REAPER_CONFIG } from '../services/jobReaper.js';
import { stopAllHeartbeats, HEARTBEAT_CONFIG } from '../services/jobHeartbeat.js';
import logger from '../utils/logger.js';

/**
 * Audio Processing Worker
 * 
 * Standalone process that consumes audio processing jobs from BullMQ queue.
 * Run separately from the API server: npm run worker
 * 
 * Features:
 * - Stalled job detection and recovery (BullMQ + DB heartbeat reaper)
 * - Graceful shutdown on SIGTERM/SIGINT
 * - Configurable concurrency
 * - Automatic retries with exponential backoff
 * - Heartbeat monitoring for hung API calls
 */

const QUEUE_NAME = 'audio-processing';

// Worker configuration
const WORKER_CONFIG = {
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '2'), // Process 2 jobs at a time
  lockDuration: 300000, // 5 minutes - job lock before considered stalled
  stalledInterval: 60000, // Check for stalled jobs every 60 seconds
  maxStalledCount: 2, // Auto-retry stalled jobs up to 2 times
};

let worker = null;
let isShuttingDown = false;

/**
 * Process an audio job from the queue
 */
const processJob = async (job) => {
  const { jobId, audioFilePath, fileId, userId, companyId, staffId } = job.data;
  
  logger.info('Worker: Starting audio processing job', {
    bullmqJobId: job.id,
    dbJobId: jobId,
    fileId,
    userId,
    attempt: job.attemptsMade + 1,
  });

  try {
    // Call the existing processAudioJob function
    await processAudioJob(jobId, audioFilePath, fileId, userId, companyId, staffId);
    
    logger.info('Worker: Audio processing job completed successfully', {
      bullmqJobId: job.id,
      dbJobId: jobId,
    });
    
    return { success: true, jobId };
  } catch (error) {
    logger.error('Worker: Audio processing job failed', {
      bullmqJobId: job.id,
      dbJobId: jobId,
      error: error.message,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts,
    });
    
    // Re-throw to trigger BullMQ retry mechanism
    throw error;
  }
};

/**
 * Start the worker
 */
const startWorker = () => {
  const connection = createRedisConnection();
  
  worker = new Worker(QUEUE_NAME, processJob, {
    connection,
    ...WORKER_CONFIG,
  });

  // Event handlers
  worker.on('ready', () => {
    logger.info('Worker: Ready and listening for jobs', {
      queueName: QUEUE_NAME,
      concurrency: WORKER_CONFIG.concurrency,
    });
  });

  worker.on('active', (job) => {
    logger.debug('Worker: Job started', {
      bullmqJobId: job.id,
      dbJobId: job.data.jobId,
    });
  });

  worker.on('completed', (job, result) => {
    logger.info('Worker: Job completed', {
      bullmqJobId: job.id,
      dbJobId: job.data.jobId,
      result,
    });
  });

  worker.on('failed', (job, error) => {
    const willRetry = job && job.attemptsMade < (job.opts.attempts || 3);
    
    logger.error('Worker: Job failed', {
      bullmqJobId: job?.id,
      dbJobId: job?.data?.jobId,
      error: error.message,
      attemptsMade: job?.attemptsMade,
      willRetry,
    });

    // If this was the final attempt, the job status should already be 'failed'
    // from processAudioJob, but ensure it's set
    if (!willRetry && job?.data?.jobId) {
      updateJobStatus(job.data.jobId, 'failed', null, 'キュー処理失敗', error.message)
        .catch(err => logger.error('Failed to update job status after final failure', err));
    }
  });

  worker.on('stalled', (jobId) => {
    logger.warn('Worker: Job stalled (will be retried)', { jobId });
  });

  worker.on('error', (error) => {
    logger.error('Worker: Error', error);
  });

  logger.info('Worker: Started', {
    queueName: QUEUE_NAME,
    config: WORKER_CONFIG,
  });

  return worker;
};

/**
 * Graceful shutdown
 */
const shutdown = async (signal) => {
  if (isShuttingDown) {
    logger.warn('Worker: Shutdown already in progress');
    return;
  }
  
  isShuttingDown = true;
  logger.info(`Worker: Received ${signal}, starting graceful shutdown...`);
  
  // Stop the job reaper
  stopReaper();
  
  // Stop all active heartbeat intervals
  stopAllHeartbeats();
  
  if (worker) {
    try {
      // Close worker - waits for current jobs to complete
      await worker.close();
      logger.info('Worker: Graceful shutdown completed');
    } catch (error) {
      logger.error('Worker: Error during shutdown', error);
    }
  }
  
  process.exit(0);
};

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Worker: Uncaught exception', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Worker: Unhandled rejection', { reason, promise });
});

// Start the worker
logger.info('='.repeat(50));
logger.info('Audio Processing Worker Starting...');
logger.info('='.repeat(50));

// Log configuration
logger.info('Heartbeat Config:', HEARTBEAT_CONFIG);
logger.info('Reaper Config:', REAPER_CONFIG);

// Start the BullMQ worker
startWorker();

// Start the job reaper (detects and handles stalled jobs)
startReaper();
logger.info('Job reaper started');
