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

// Lightweight record summary for list display
export interface RecordSummary {
  id: number;
  ownerId?: number;
  date: string;
  fileId: string;
  staffId: string;
  staffName?: string;
  userName?: string;
  memo?: string | null;
}

// Full record detail with all fields
export interface Record {
  id: number;
  ownerId?: number;
  date: string;
  fileId: string;
  staffId: string;
  staffName?: string;
  userName?: string;
  skillSheet: SkillSheet;
  salesforce: string[] | null;
  lor: string | null;
  memo?: string | null;
  stt: string | null;
  bulk: boolean;
  skills?: string[];
  hope?: string | null;
}

export interface UploadStatus {
  isUploading: boolean;
  progress: 'uploading' | 'transcribing' | 'processing' | 'complete' | 'error';
  message: string;
  estimatedTime?: string;
  jobId?: number;
  progressPercent?: number;
}

// Processing job status for async upload
export type ProcessingJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ProcessingJob {
  jobId: number;
  fileId: string;
  userId?: number;
  companyId?: number;
  staffId: string;
  status: ProcessingJobStatus;
  progress: number;
  currentStep: string;
  totalChunks: number;
  completedChunks: number;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

export interface UploadResponse {
  jobId: number;
  message: string;
  status: string;
}

export type SortField = 'date' | 'fileId' | 'userName';
export type SortOrder = 'asc' | 'desc';

export interface AlertMessage {
  type: 'success' | 'error';
  message: string;
}

export interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  currentPage: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  records: T[];
  pagination: PaginationInfo;
}

// Type alias for backward compatibility
export type RecordDetail = Record;
