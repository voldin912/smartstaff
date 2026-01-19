/**
 * Type definitions for dashboard
 */

export interface Career {
  from: string;
  to: string;
  'company name': string;
  'employee type': string;
  'work content': string;
  summary?: string;
}

export interface SkillSheetData {
  [key: string]: Career;
}

// skillSheet can be a JSON string (from database) or already parsed object
export type SkillSheet = string | SkillSheetData | null;

export interface Record {
  id: number;
  date: string;
  fileId: string;
  staffId: string;
  staffName?: string;
  userName?: string;
  skillSheet: SkillSheet;
  salesforce: string[] | null;
  lor: string | null;
  memo?: string | null;
  stt: boolean;
  bulk: boolean;
  skills?: string[];
  hope?: string | null;
}

export interface UploadStatus {
  isUploading: boolean;
  progress: 'uploading' | 'transcribing' | 'processing' | 'complete' | 'error';
  message: string;
  estimatedTime?: string;
}

export type SortField = 'date' | 'fileId' | 'userName';
export type SortOrder = 'asc' | 'desc';

export interface AlertMessage {
  type: 'success' | 'error';
  message: string;
}
