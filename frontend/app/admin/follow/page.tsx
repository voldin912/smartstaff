"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import Layout from "@/components/Layout";
import Pagination from "@/components/molecules/pagination";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from 'sonner';
import UploadModal from "@/components/dashboard/UploadModal";
import { UploadStatus, ProcessingJob } from "@/lib/types";
import { followService } from "@/services/followService";
import { generateFileId } from "@/lib/utils";

// localStorage keys for persisting active jobs across page navigations
const ACTIVE_JOB_KEY = 'smartstaff_active_job';
const ACTIVE_FOLLOW_JOB_KEY = 'smartstaff_active_follow_job';

const isOtherJobActive = (ownKey: string): boolean => {
  const otherKey = ownKey === ACTIVE_JOB_KEY ? ACTIVE_FOLLOW_JOB_KEY : ACTIVE_JOB_KEY;
  return !!localStorage.getItem(otherKey);
};

interface FollowRecord {
  id: number;
  ownerId?: number;
  date: string;
  fileId: string;
  staffId: string;
  staffName: string;
  summary: string | null;
  companyId?: number;
  userName?: string;
}

interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  currentPage: number;
  totalPages: number;
}

type SortField = 'date' | 'staffId';
type SortOrder = 'asc' | 'desc';

export default function AdminFollowPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState<FollowRecord[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [sortIconDate, setSortIconDate] = useState<'↑' | '↓'>('↓');
  const [sortIconStaffId, setSortIconStaffId] = useState<'↑' | '↓'>('↓');
  const [searchTerm, setSearchTerm] = useState('');
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Inline editing states
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [staffIdInput, setStaffIdInput] = useState("");
  const [editingStaffName, setEditingStaffName] = useState<number | null>(null);
  const [staffNameInput, setStaffNameInput] = useState("");
  const [editingSummary, setEditingSummary] = useState<number | null>(null);
  const [summaryInput, setSummaryInput] = useState("");

  const staffIdInputRef = useRef<HTMLInputElement | null>(null);
  const staffNameInputRef = useRef<HTMLInputElement | null>(null);
  const summaryInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Upload states (async pattern)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    progress: 'uploading',
    message: '',
  });
  const [isUploadModalVisible, setIsUploadModalVisible] = useState(false);

  // Polling cleanup reference
  const [pollCleanup, setPollCleanup] = useState<(() => void) | null>(null);

  // Delete states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<FollowRecord | null>(null);

  useEffect(() => {
    fetchRecords();
  }, [currentPage, rowsPerPage]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollCleanup) {
        pollCleanup();
      }
    };
  }, [pollCleanup]);

  // Check for active job on mount and resume polling if needed
  useEffect(() => {
    const checkActiveJob = async () => {
      try {
        const stored = localStorage.getItem(ACTIVE_FOLLOW_JOB_KEY);
        if (!stored) return;

        const { jobId } = JSON.parse(stored);
        if (!jobId) return;

        // Fetch current job status
        const job = await followService.getJobStatus(jobId);

        if (job.status === 'pending' || job.status === 'processing') {
          // Job still running - restore state and resume polling
          let progressState: UploadStatus['progress'] = 'processing';
          if (job.status === 'pending') {
            progressState = 'uploading';
          } else if (job.status === 'processing') {
            progressState = (job.progress ?? 0) < 85 ? 'transcribing' : 'processing';
          }

          setUploadStatus({
            isUploading: true,
            progress: progressState,
            message: job.currentStep || '処理中...',
            progressPercent: job.progress,
            jobId: job.jobId,
          });
          setIsUploadModalVisible(true);

          // Resume polling
          const cleanup = followService.pollJobStatus(
            jobId,
            handleProgressUpdate,
            handleJobComplete,
            handleJobError
          );
          setPollCleanup(() => cleanup);
        } else if (job.status === 'completed') {
          // Job completed while away
          localStorage.removeItem(ACTIVE_FOLLOW_JOB_KEY);
          setUploadStatus({
            isUploading: false,
            progress: 'complete',
            message: '処理が完了しました。',
            progressPercent: 100,
            jobId: job.jobId,
          });
          setIsUploadModalVisible(true);
          toast.success('ファイルの処理が完了しました。');
          fetchRecords();
        } else if (job.status === 'failed') {
          // Job failed while away
          localStorage.removeItem(ACTIVE_FOLLOW_JOB_KEY);
          setUploadStatus({
            isUploading: false,
            progress: 'error',
            message: job.errorMessage || '処理に失敗しました。',
            jobId: job.jobId,
          });
          setIsUploadModalVisible(true);
          toast.error(job.errorMessage || '処理に失敗しました。');
        }
      } catch (error) {
        localStorage.removeItem(ACTIVE_FOLLOW_JOB_KEY);
        console.error('Failed to check active follow job:', error);
      }
    };

    checkActiveJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount

  // Handle progress updates from polling
  const handleProgressUpdate = (job: ProcessingJob) => {
    let progressState: UploadStatus['progress'] = 'processing';
    if (job.status === 'pending') {
      progressState = 'uploading';
    } else if (job.status === 'processing') {
      // 0-80% is STT processing, 85%+ is summary/persist
      progressState = (job.progress ?? 0) < 85 ? 'transcribing' : 'processing';
    } else if (job.status === 'completed') {
      progressState = 'complete';
    } else if (job.status === 'failed') {
      progressState = 'error';
    }

    setUploadStatus(prev => ({
      ...prev,
      isUploading: job.status !== 'completed' && job.status !== 'failed',
      progress: progressState,
      message: job.currentStep || '処理中...',
      progressPercent: job.progress,
      jobId: job.jobId,
    }));
  };

  // Handle job completion
  const handleJobComplete = (job: ProcessingJob) => {
    localStorage.removeItem(ACTIVE_FOLLOW_JOB_KEY);
    setUploadStatus({
      isUploading: false,
      progress: 'complete',
      message: '処理が完了しました。',
      progressPercent: 100,
      jobId: job.jobId,
    });
    setIsUploadModalVisible(true);
    toast.success('ファイルの処理が完了しました。');
    fetchRecords();
    setPollCleanup(null);
  };

  // Handle job error
  const handleJobError = (error: string) => {
    localStorage.removeItem(ACTIVE_FOLLOW_JOB_KEY);
    setUploadStatus(prev => ({
      ...prev,
      isUploading: false,
      progress: 'error',
      message: error,
    }));
    setIsUploadModalVisible(true);
    toast.error(error);
    setPollCleanup(null);
  };

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const offset = (currentPage - 1) * rowsPerPage;
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow?limit=${rowsPerPage}&offset=${offset}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records);
        setPagination(data.pagination);
      }
    } catch (e) {
      console.error('Error fetching follow records:', e);
    } finally {
      setLoading(false);
    }
  };

  // ---- Inline editing handlers ----

  const handleEditStaffId = (id: number, currentStaffId: string) => {
    setEditingStaffId(id);
    setStaffIdInput(currentStaffId || '');
    setTimeout(() => staffIdInputRef.current?.focus(), 0);
  };

  const handleStaffIdBlur = async (id: number) => {
    setEditingStaffId(null);
    const trimmedInput = staffIdInput?.trim() || '';
    if (!trimmedInput) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${id}/staff-id`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ staffId: trimmedInput }),
      });
      if (res.ok) {
        toast.success('スタッフIDを更新しました。');
        fetchRecords();
      } else {
        const data = await res.json();
        toast.error(data.error || 'スタッフIDの更新に失敗しました。');
      }
    } catch (e) {
      toast.error('スタッフIDの更新に失敗しました。');
    }
  };

  const handleEditStaffName = (id: number, currentStaffName: string) => {
    setEditingStaffName(id);
    setStaffNameInput(currentStaffName || '');
    setTimeout(() => staffNameInputRef.current?.focus(), 0);
  };

  const handleStaffNameBlur = async (id: number) => {
    setEditingStaffName(null);
    const trimmedInput = staffNameInput?.trim() || '';
    if (!trimmedInput) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${id}/staff-name`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ staffName: trimmedInput }),
      });
      if (res.ok) {
        toast.success('スタッフ名を更新しました。');
        fetchRecords();
      } else {
        const data = await res.json();
        toast.error(data.error || 'スタッフ名の更新に失敗しました。');
      }
    } catch (e) {
      toast.error('スタッフ名の更新に失敗しました。');
    }
  };

  const handleEditSummary = (id: number, currentSummary: string | null) => {
    setEditingSummary(id);
    setSummaryInput(currentSummary || '');
    setTimeout(() => summaryInputRef.current?.focus(), 0);
  };

  const handleSummaryBlur = async (id: number) => {
    setEditingSummary(null);
    const trimmedInput = summaryInput?.trim() || '';
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${id}/summary`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ summary: trimmedInput }),
      });
      if (res.ok) {
        toast.success('要約を更新しました。');
        fetchRecords();
      } else {
        const data = await res.json();
        toast.error(data.error || '要約の更新に失敗しました。');
      }
    } catch (e) {
      toast.error('要約の更新に失敗しました。');
    }
  };

  const handleCopySummary = async (summary: string | null) => {
    if (!summary) {
      toast.error('要約がありません。');
      return;
    }
    try {
      await navigator.clipboard.writeText(summary);
      toast.success('要約をクリップボードにコピーしました。');
    } catch (error) {
      // Fallback for non-secure contexts
      const textArea = document.createElement('textarea');
      textArea.value = summary;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success('要約をクリップボードにコピーしました。');
      } catch {
        toast.error('コピーに失敗しました。');
      } finally {
        document.body.removeChild(textArea);
      }
    }
  };

  // ---- Upload handlers (async with polling) ----

  const handleUploadClick = () => {
    if (uploadStatus.isUploading) {
      setIsUploadModalVisible(true);
    } else if (isOtherJobActive(ACTIVE_FOLLOW_JOB_KEY)) {
      toast.error('別の処理が実行中です。完了後に再度お試しください。');
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Reset input immediately to allow re-selecting the same file
    event.target.value = '';

    if (!user?.id) {
      toast.error('ユーザー情報の取得に失敗しました。再度ログインしてください。');
      return;
    }

    if (!file.type.startsWith('audio/')) {
      toast.error('音声ファイルのみアップロード可能です。');
      return;
    }

    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('ファイルサイズは100MB以下にしてください。');
      return;
    }

    const fileSizeInMB = file.size / (1024 * 1024);
    const estimatedMinutes = Math.ceil(fileSizeInMB * 0.5);
    const estimatedTime = estimatedMinutes > 1 ? `${estimatedMinutes}分程度` : '1分程度';

    setUploadStatus({
      isUploading: true,
      progress: 'uploading',
      message: 'ファイルをアップロード中です...',
      estimatedTime,
      progressPercent: 0,
    });
    setIsUploadModalVisible(true);

    try {
      // Upload and get job ID (returns immediately)
      const response = await followService.uploadAudio(
        file,
        generateFileId(file.name.split('.')[0]),
        user.id.toString()
      );

      // Save active job to localStorage for persistence across page navigations
      localStorage.setItem(ACTIVE_FOLLOW_JOB_KEY, JSON.stringify({ jobId: response.jobId }));

      setUploadStatus(prev => ({
        ...prev,
        progress: 'transcribing',
        message: '処理を開始しました...',
        jobId: response.jobId,
        progressPercent: 5,
      }));

      // Start polling for job status
      const cleanup = followService.pollJobStatus(
        response.jobId,
        handleProgressUpdate,
        handleJobComplete,
        handleJobError
      );

      setPollCleanup(() => cleanup);

    } catch (error) {
      setUploadStatus({
        isUploading: false,
        progress: 'error',
        message: (error as Error).message || 'アップロードに失敗しました。',
        progressPercent: 0,
      });
      toast.error((error as Error).message || 'アップロードに失敗しました。');
    }
  };

  // ---- STT Download ----

  const handleSTTDownload = async (record: FollowRecord) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${record.id}/stt`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `stt-${record.fileId}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        toast.success('STTデータのダウンロードが完了しました。');
      } else {
        toast.error('STTデータのダウンロードに失敗しました。');
      }
    } catch (error) {
      toast.error('STTデータのダウンロード中にエラーが発生しました。');
    }
  };

  // ---- Delete handlers ----

  const handleDeleteClick = (record: FollowRecord) => {
    setRecordToDelete(record);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${recordToDelete.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        toast.success('レコードを削除しました。');
        fetchRecords();
      } else {
        const data = await res.json();
        toast.error(data.error || 'レコードの削除に失敗しました。');
      }
    } catch (error) {
      toast.error('レコードの削除に失敗しました。');
    } finally {
      setShowDeleteModal(false);
      setRecordToDelete(null);
    }
  };

  // ---- Sorting & filtering ----

  const parseDate = (dateString: string) => {
    try {
      return new Date(dateString).getTime();
    } catch {
      return 0;
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${year}/${month}/${day} ${hours}:${minutes}`;
    } catch {
      return dateString;
    }
  };

  const truncateText = (text: string | null, maxLength: number = 30) => {
    if (!text) return '';
    return text.length > maxLength ? `${text.substring(0, maxLength)}...` : text;
  };

  const filteredRecords = records.filter(rec =>
    (rec.date || '').includes(searchTerm) ||
    (rec.staffId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (rec.staffName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (rec.userName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      if (sortField === 'date') {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      } else {
        const valA = (a.staffId || '').toLowerCase();
        const valB = (b.staffId || '').toLowerCase();
        return sortOrder === 'desc' ? valB.localeCompare(valA) : valA.localeCompare(valB);
      }
    });
  }, [filteredRecords, sortField, sortOrder]);

  const handleColumnSort = (field: SortField) => {
    const newOrder = field === sortField && sortOrder === 'desc' ? 'asc' : 'desc';
    setSortField(field);
    setSortOrder(newOrder);

    if (field === 'date') {
      setSortIconDate(newOrder === 'asc' ? '↑' : '↓');
      setSortIconStaffId('↓');
    } else {
      setSortIconDate('↓');
      setSortIconStaffId(newOrder === 'asc' ? '↑' : '↓');
    }
  };

  const handlePageChange = (page: number) => setCurrentPage(page);
  const handleRowsPerPageChange = (rows: number) => {
    setRowsPerPage(rows);
    setCurrentPage(1);
  };

  // Auto-hide alert after 5 seconds
  useEffect(() => {
    if (alertMessage) {
      const timer = setTimeout(() => setAlertMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [alertMessage]);

  return (
    <Layout>
      <div className="min-h-screen bg-[#f8fafd] px-4 sm:px-6 lg:px-8 py-6 rounded-[5px]">
        {/* Upload Status Modal (reusable UploadModal component) */}
        <UploadModal
          uploadStatus={uploadStatus}
          isVisible={isUploadModalVisible}
          onClose={() => setIsUploadModalVisible(false)}
        />

        {/* Delete Confirmation Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
            <div className="bg-gray-50 border border-gray-400 rounded-md p-8 min-w-[350px] max-w-[95vw] flex flex-col items-center">
              <div className="text-center mb-6">
                <div className="text-lg mb-2">
                  スタッフID：{recordToDelete?.staffId || '(未設定)'} のレコードを削除しますか？
                </div>
              </div>
              <div className="flex gap-8 mt-2">
                <button
                  className="border border-gray-400 rounded px-8 py-2 text-lg hover:bg-gray-200"
                  onClick={() => { setShowDeleteModal(false); setRecordToDelete(null); }}
                >
                  キャンセル
                </button>
                <button
                  className="border border-red-400 text-red-600 rounded px-8 py-2 text-lg hover:bg-red-50"
                  onClick={handleDeleteConfirm}
                >
                  削除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 rounded-[5px]">
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 rounded-[5px]">
            Hello {user?.name || 'User'} <span role="img" aria-label="wave">👋</span>,
          </h1>
          <div className="flex items-center gap-4 rounded-[5px] w-full sm:w-auto">
            <div className="relative rounded-[5px] flex flex-col items-end gap-2 w-full sm:w-auto">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="audio/*,.m4a"
                className="hidden"
              />
              <button
                onClick={handleUploadClick}
                className={`bg-white rounded-full shadow border border-gray-200 mt-2 transition-all ${
                  uploadStatus.isUploading
                    ? 'hover:bg-indigo-50 border-indigo-300 cursor-pointer'
                    : 'hover:bg-gray-50'
                }`}
                title={uploadStatus.isUploading ? '処理中 - クリックで詳細を表示' : '音声ファイルをアップロード'}
              >
                {uploadStatus.isUploading ? (
                  <div className="w-8 h-8 flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : (
                  <Image src="/plus.svg" alt="Upload" width={32} height={32} className="rounded-[5px]" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Follow Table Section */}
        <div className="bg-white rounded-[5px] shadow">
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg sm:text-xl font-semibold rounded-[5px]">Follow</h2>
              <div className="flex items-center gap-4">
                <div className="relative w-56">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Image src="/search.svg" alt="Search" width={16} height={16} className="text-gray-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search"
                    className="pl-10 pr-4 py-2 rounded-[5px] border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 text-gray-700 w-full shadow-sm"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-[5px] -mx-4 sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full align-middle">
                <table className="min-w-full text-left text-gray-700 rounded-[5px]">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-400 rounded-[5px]">
                      <th
                        className="py-3 px-4 font-medium text-center min-w-[140px] rounded-[5px] cursor-pointer hover:bg-gray-50"
                        onClick={() => handleColumnSort('date')}
                      >
                        Date <span className="ml-1">{sortIconDate}</span>
                      </th>
                      <th
                        className="py-3 px-4 font-medium text-center min-w-[100px] rounded-[5px] cursor-pointer hover:bg-gray-50"
                        onClick={() => handleColumnSort('staffId')}
                      >
                        Staff ID <span className="ml-1">{sortIconStaffId}</span>
                      </th>
                      <th className="py-3 px-4 font-medium text-center min-w-[100px] rounded-[5px]">Staff Name</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[200px] rounded-[5px]">Summary</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[60px] max-w-[80px] rounded-[5px]">STT</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[60px] max-w-[80px] rounded-[5px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={6} className="text-center py-8">Loading...</td></tr>
                    ) : sortedRecords.length === 0 ? (
                      <tr><td colSpan={6} className="text-center py-8">No records found</td></tr>
                    ) : (
                      sortedRecords.map((rec) => (
                        <tr key={rec.id} className="border-b border-gray-100 hover:bg-gray-50 transition text-left align-middle rounded-[5px]">
                          {/* Date */}
                          <td className="py-5 px-4 whitespace-nowrap align-middle rounded-[5px] truncate">
                            {formatDate(rec.date)}
                          </td>
                          {/* Staff ID */}
                          <td className="py-5 px-4 whitespace-nowrap align-middle rounded-[5px]">
                            <div className="flex items-center gap-x-2 truncate">
                              {editingStaffId === rec.id ? (
                                <input
                                  ref={staffIdInputRef}
                                  value={staffIdInput}
                                  onChange={e => setStaffIdInput(e.target.value)}
                                  onBlur={() => handleStaffIdBlur(rec.id)}
                                  onKeyDown={e => e.key === 'Enter' && handleStaffIdBlur(rec.id)}
                                  className="border border-gray-300 rounded-[5px] px-2 py-1 w-24 text-center"
                                />
                              ) : (
                                <>
                                  <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Edit Staff ID" onClick={() => handleEditStaffId(rec.id, rec.staffId)}>
                                    <Image src="/edit1.svg" alt="Edit Staff ID" width={20} height={20} className="rounded-[5px]" />
                                  </button>
                                  <span className="truncate">{rec.staffId}</span>
                                </>
                              )}
                            </div>
                          </td>
                          {/* Staff Name */}
                          <td className="py-5 px-4 whitespace-nowrap align-middle rounded-[5px]">
                            <div className="flex items-center gap-x-2 truncate">
                              {editingStaffName === rec.id ? (
                                <input
                                  ref={staffNameInputRef}
                                  value={staffNameInput}
                                  onChange={e => setStaffNameInput(e.target.value)}
                                  onBlur={() => handleStaffNameBlur(rec.id)}
                                  onKeyDown={e => e.key === 'Enter' && handleStaffNameBlur(rec.id)}
                                  className="border border-gray-300 rounded-[5px] px-2 py-1 text-center"
                                />
                              ) : (
                                <>
                                  <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Edit Staff Name" onClick={() => handleEditStaffName(rec.id, rec.staffName || '')}>
                                    <Image src="/edit1.svg" alt="Edit Staff Name" width={20} height={20} className="rounded-[5px]" />
                                  </button>
                                  <span className="truncate">{rec.staffName || ''}</span>
                                </>
                              )}
                            </div>
                          </td>
                          {/* Summary */}
                          <td className="py-5 px-4 align-middle rounded-[5px]">
                            {editingSummary === rec.id ? (
                              <textarea
                                ref={summaryInputRef}
                                value={summaryInput}
                                onChange={e => setSummaryInput(e.target.value)}
                                onBlur={() => handleSummaryBlur(rec.id)}
                                className="border border-gray-300 rounded-[5px] px-2 py-1 w-full min-h-[60px]"
                              />
                            ) : (
                              <div className="flex items-center gap-x-2">
                                <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Edit Summary" onClick={() => handleEditSummary(rec.id, rec.summary)}>
                                  <Image src="/edit1.svg" alt="Edit Summary" width={20} height={20} className="rounded-[5px]" />
                                </button>
                                <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Copy Summary" onClick={() => handleCopySummary(rec.summary)}>
                                  <Image src="/copy1.svg" alt="Copy Summary" width={20} height={20} className="rounded-[5px]" />
                                </button>
                                <span className="truncate" title={rec.summary || ''}>
                                  {truncateText(rec.summary)}
                                </span>
                              </div>
                            )}
                          </td>
                          {/* STT */}
                          <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
                            <div className="flex items-center justify-center rounded-[5px]">
                              <button
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                                title="Download STT"
                                onClick={() => handleSTTDownload(rec)}
                              >
                                <Image src="/download1.svg" alt="download" width={16} height={16} className="rounded-[5px]" />
                              </button>
                            </div>
                          </td>
                          {/* Delete */}
                          <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
                            <div className="flex items-center justify-center rounded-[5px]">
                              {/* Members can only delete their own records */}
                              {user?.role === 'member' ? (
                                rec.ownerId === user.id ? (
                                  <button
                                    className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0 text-gray-500 hover:text-gray-700"
                                    title="Delete"
                                    onClick={() => handleDeleteClick(rec)}
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                ) : null
                              ) : (
                                <button
                                  className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0 text-gray-500 hover:text-gray-700"
                                  title="Delete"
                                  onClick={() => handleDeleteClick(rec)}
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <Pagination
            totalItems={pagination?.total || sortedRecords.length}
            currentPage={currentPage}
            rowsPerPage={rowsPerPage}
            onPageChange={handlePageChange}
            onRowsPerPageChange={handleRowsPerPageChange}
          />
        </div>
      </div>
    </Layout>
  );
}
