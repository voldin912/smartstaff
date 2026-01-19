import { apiRequest, handleApiError } from '@/lib/api';
import { Record } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Records API Service
 * All record-related API calls with proper error handling
 */

export const recordsService = {
  /**
   * Fetch all records (filtered by role on backend)
   */
  async getRecords(): Promise<Record[]> {
    try {
      return await apiRequest<Record[]>(`${API_URL}/api/records`);
    } catch (error) {
      throw new Error(handleApiError(error, 'レコードの取得に失敗しました。'));
    }
  },

  /**
   * Upload audio file
   */
  async uploadAudio(file: File, fileId: string, staffId: string): Promise<Record> {
    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('fileId', fileId);
      formData.append('staffId', staffId);

      return await apiRequest<Record>(`${API_URL}/api/records/upload`, {
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
