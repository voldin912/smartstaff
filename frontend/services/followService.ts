import { apiRequest, handleApiError } from '@/lib/api';
import { ProcessingJob, UploadResponse, UploadStatus } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Polling configuration
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_TIME = 600000; // 10 minutes

/**
 * Follow API Service
 * All follow-related API calls with proper error handling
 */
export const followService = {
  /**
   * Upload audio file (async - returns jobId immediately)
   */
  async uploadAudio(file: File, fileId: string, staffId: string): Promise<UploadResponse> {
    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('fileId', fileId);
      formData.append('staffId', staffId);

      return await apiRequest<UploadResponse>(`${API_URL}/api/follow/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          // Don't set Content-Type for FormData, browser will set it with boundary
        },
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'ファイルのアップロードに失敗しました。'));
    }
  },

  /**
   * Get processing job status
   */
  async getJobStatus(jobId: number): Promise<ProcessingJob> {
    try {
      return await apiRequest<ProcessingJob>(`${API_URL}/api/follow/processing/jobs/${jobId}`);
    } catch (error) {
      throw new Error(handleApiError(error, '処理状態の取得に失敗しました。'));
    }
  },

  /**
   * Get all processing jobs for current user (follow type only)
   */
  async getProcessingJobs(status?: string, limit?: number): Promise<{ jobs: ProcessingJob[] }> {
    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (limit) params.append('limit', limit.toString());

      const url = `${API_URL}/api/follow/processing/jobs${params.toString() ? '?' + params.toString() : ''}`;
      return await apiRequest<{ jobs: ProcessingJob[] }>(url);
    } catch (error) {
      throw new Error(handleApiError(error, '処理ジョブの取得に失敗しました。'));
    }
  },

  /**
   * Retry a failed processing job
   */
  async retryJob(jobId: number): Promise<{ success: boolean; message: string }> {
    try {
      return await apiRequest<{ success: boolean; message: string }>(
        `${API_URL}/api/follow/processing/jobs/${jobId}/retry`,
        { method: 'POST' }
      );
    } catch (error) {
      throw new Error(handleApiError(error, 'ジョブの再実行に失敗しました。'));
    }
  },

  /**
   * Poll job status until completion or failure
   * @param jobId - Job ID to poll
   * @param onProgress - Callback for progress updates
   * @param onComplete - Callback when job completes
   * @param onError - Callback on error
   * @returns Cleanup function to stop polling
   */
  pollJobStatus(
    jobId: number,
    onProgress: (job: ProcessingJob) => void,
    onComplete: (job: ProcessingJob) => void,
    onError: (error: string) => void
  ): () => void {
    let timeoutId: NodeJS.Timeout | null = null;
    let stopped = false;
    const startTime = Date.now();

    const poll = async () => {
      if (stopped) return;

      try {
        const job = await this.getJobStatus(jobId);

        if (stopped) return;

        onProgress(job);

        if (job.status === 'completed') {
          onComplete(job);
          return;
        }

        if (job.status === 'failed') {
          onError(job.errorMessage || '処理に失敗しました。');
          return;
        }

        // Check timeout
        if (Date.now() - startTime > MAX_POLL_TIME) {
          onError('処理がタイムアウトしました。');
          return;
        }

        // Continue polling
        timeoutId = setTimeout(poll, POLL_INTERVAL);
      } catch (error) {
        if (!stopped) {
          onError(error instanceof Error ? error.message : '処理状態の取得に失敗しました。');
        }
      }
    };

    // Start polling
    poll();

    // Return cleanup function
    return () => {
      stopped = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  },
};
