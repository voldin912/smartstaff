import { Queue } from 'bullmq';
import { getSharedRedisConnection } from '../config/redis.js';
import logger from '../utils/logger.js';

/**
 * Audio Processing Queue
 * 
 * Handles async audio transcription and AI processing jobs.
 * Jobs persist in Redis and survive server restarts.
 */

const QUEUE_NAME = 'audio-processing';

// Default job options
const defaultJobOptions = {
  attempts: 3, // Retry up to 3 times on failure
  backoff: {
    type: 'exponential',
    delay: 5000, // Start with 5 second delay, doubles each retry
  },
  removeOnComplete: {
    age: 86400, // Keep completed jobs for 24 hours
    count: 1000, // Keep max 1000 completed jobs
  },
  removeOnFail: {
    age: 604800, // Keep failed jobs for 7 days
    count: 500, // Keep max 500 failed jobs
  },
};

// Singleton queue instance
let audioQueue = null;

/**
 * Get or create the audio processing queue
 */
export const getAudioQueue = () => {
  if (!audioQueue) {
    const connection = getSharedRedisConnection();
    
    audioQueue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions,
    });

    audioQueue.on('error', (err) => {
      logger.error('Audio queue error', err);
    });

    logger.info('Audio processing queue initialized', { queueName: QUEUE_NAME });
  }
  
  return audioQueue;
};

/**
 * Add a new audio processing job to the queue
 * 
 * @param {Object} jobData - Job data
 * @param {number} jobData.jobId - Database job ID
 * @param {string} jobData.audioFilePath - Path to the audio file
 * @param {string} jobData.fileId - File identifier
 * @param {number} jobData.userId - User ID
 * @param {number} jobData.companyId - Company ID
 * @param {string} jobData.staffId - Staff ID
 * @param {Object} options - Optional BullMQ job options override
 * @returns {Promise<Job>} The created job
 */
export const addAudioProcessingJob = async (jobData, options = {}) => {
  const queue = getAudioQueue();
  
  const job = await queue.add('processAudio', jobData, {
    ...defaultJobOptions,
    ...options,
    jobId: `audio-${jobData.jobId}`, // Use DB job ID for idempotency
  });
  
  logger.info('Audio processing job added to queue', {
    bullmqJobId: job.id,
    dbJobId: jobData.jobId,
    fileId: jobData.fileId,
    userId: jobData.userId,
  });
  
  return job;
};

/**
 * Get queue statistics
 */
export const getQueueStats = async () => {
  const queue = getAudioQueue();
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  
  return { waiting, active, completed, failed, delayed };
};

/**
 * Close the queue connection gracefully
 */
export const closeQueue = async () => {
  if (audioQueue) {
    await audioQueue.close();
    audioQueue = null;
    logger.info('Audio processing queue closed');
  }
};

export default {
  getAudioQueue,
  addAudioProcessingJob,
  getQueueStats,
  closeQueue,
  QUEUE_NAME,
};
