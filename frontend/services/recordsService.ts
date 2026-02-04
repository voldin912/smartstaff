import { apiRequest, handleApiError } from '@/lib/api';
import { Record, RecordSummary, PaginatedResponse, ProcessingJob, UploadResponse } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Polling configuration
const POLL_INTERVAL = 2000; // 2 seconds
const MAX_POLL_TIME = 600000; // 10 minutes

/**
 * Records API Service
 * All record-related API calls with proper error handling
 */

export const recordsService = {
  /**
   * Fetch records with pagination (filtered by role on backend)
   * Returns lightweight RecordSummary[] for list display
   * @param limit - Number of records per page (default: 50, max: 200)
   * @param offset - Number of records to skip (default: 0)
   */
  async getRecords(limit: number = 50, offset: number = 0): Promise<PaginatedResponse<RecordSummary>> {
    try {
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
      });
      return await apiRequest<PaginatedResponse<RecordSummary>>(`${API_URL}/api/records?${params.toString()}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'レコードの取得に失敗しました。'));
    }
  },

  /**
   * Fetch full record detail including heavy fields (stt, skillSheet, salesforce, lor, etc.)
   * @param recordId - ID of the record to fetch
   */
  async getRecordDetail(recordId: number): Promise<Record> {
    try {
      return await apiRequest<Record>(`${API_URL}/api/records/${recordId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'レコード詳細の取得に失敗しました。'));
    }
  },

  /**
   * Upload audio file (async - returns jobId immediately)
   */
  async uploadAudio(file: File, fileId: string, staffId: string): Promise<UploadResponse> {
    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('fileId', fileId);
      formData.append('staffId', staffId);

      return await apiRequest<UploadResponse>(`${API_URL}/api/records/upload`, {
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
      return await apiRequest<ProcessingJob>(`${API_URL}/api/records/processing/jobs/${jobId}`);
    } catch (error) {
      throw new Error(handleApiError(error, '処理状態の取得に失敗しました。'));
    }
  },

  /**
   * Get all processing jobs for current user
   */
  async getProcessingJobs(status?: string, limit?: number): Promise<{ jobs: ProcessingJob[] }> {
    try {
      const params = new URLSearchParams();
      if (status) params.append('status', status);
      if (limit) params.append('limit', limit.toString());
      
      const url = `${API_URL}/api/records/processing/jobs${params.toString() ? '?' + params.toString() : ''}`;
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
        `${API_URL}/api/records/processing/jobs/${jobId}/retry`,
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

  /**
   * Update staff ID
   */
  async updateStaffId(recordId: number, staffId: string): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}/staff-id`, {
        method: 'PUT',
        body: JSON.stringify({ staffId }),
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'スタッフIDの更新に失敗しました。'));
    }
  },

  /**
   * Update staff name
   */
  async updateStaffName(recordId: number, staffName: string): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}/staff-name`, {
        method: 'PUT',
        body: JSON.stringify({ staffName }),
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'スタッフ名の更新に失敗しました。'));
    }
  },

  /**
   * Update memo
   */
  async updateMemo(recordId: number, memo: string): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}/memo`, {
        method: 'PUT',
        body: JSON.stringify({ memo }),
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'メモの更新に失敗しました。'));
    }
  },

  /**
   * Update skill sheet
   */
  async updateSkillSheet(recordId: number, skillSheet: any, skills?: any): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}/skill-sheet`, {
        method: 'PUT',
        body: JSON.stringify({ skill_sheet: skillSheet, skills }),
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'スキルシートの更新に失敗しました。'));
    }
  },

  /**
   * Update Salesforce data
   */
  async updateSalesforce(recordId: number, salesforceData: string[], hope: string): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}/salesforce`, {
        method: 'PUT',
        body: JSON.stringify({ salesforceData, hope }),
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Salesforceデータの更新に失敗しました。'));
    }
  },

  /**
   * Update LoR (Letter of Recommendation)
   */
  async updateLoR(recordId: number, lor: string): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}/lor`, {
        method: 'PUT',
        body: JSON.stringify({ lor }),
      });
    } catch (error) {
      throw new Error(handleApiError(error, '推薦文の更新に失敗しました。'));
    }
  },

  /**
   * Delete record
   */
  async deleteRecord(recordId: number): Promise<void> {
    try {
      await apiRequest(`${API_URL}/api/records/${recordId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'レコードの削除に失敗しました。'));
    }
  },

  /**
   * Download STT as PDF
   */
  async downloadSTT(recordId: number, fileId: string): Promise<void> {
    try {
      const blob = await apiRequest<Blob>(`${API_URL}/api/records/${recordId}/stt`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `stt-${fileId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error(handleApiError(error, 'STTデータのダウンロードに失敗しました。'));
    }
  },

  /**
   * Download Skill Sheet as PDF
   */
  async downloadSkillSheet(recordId: number, fileId: string): Promise<void> {
    try {
      const blob = await apiRequest<Blob>(`${API_URL}/api/records/${recordId}/skill-sheet`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `skill-sheet-${fileId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error(handleApiError(error, 'スキルシートのダウンロードに失敗しました。'));
    }
  },

  /**
   * Download Salesforce as PDF
   */
  async downloadSalesforce(recordId: number, fileId: string): Promise<void> {
    try {
      const blob = await apiRequest<Blob>(`${API_URL}/api/records/${recordId}/salesforce-pdf`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `salesforce-${fileId}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error(handleApiError(error, 'Salesforceデータのダウンロードに失敗しました。'));
    }
  },

  /**
   * Download Bulk as ZIP
   */
  async downloadBulk(recordId: number, fileId: string): Promise<void> {
    try {
      const blob = await apiRequest<Blob>(`${API_URL}/api/records/${recordId}/bulk`);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulk-${fileId}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error(handleApiError(error, '一括データのダウンロードに失敗しました。'));
    }
  },

  /**
   * Sync with Salesforce
   */
  async syncWithSalesforce(
    staffId: string,
    type: 'skillSheet' | 'salesforce',
    data: any,
    hope: string
  ): Promise<{ message: string }> {
    try {
      const body: any = { staffId, type, hope };
      if (type === 'skillSheet') {
        body.skillSheet = data;
      } else if (type === 'salesforce') {
        body.salesforce = data;
      }
      return await apiRequest<{ message: string }>(`${API_URL}/api/salesforce/sync-account`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(handleApiError(error, 'Salesforce連携に失敗しました。'));
    }
  },
};
