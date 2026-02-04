"use client";

import { useState, useEffect } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import SkillSheetSidebar from "@/components/SkillSheetSidebar";
import SalesforceSidebar from "@/components/SalesforceSidebar";
import LoRSidebar from "@/components/LoRSidebar";
import { toast } from 'sonner';

import { useRecords } from "@/hooks/useRecords";
import { useRecordDetail } from "@/hooks/useRecordDetail";
import { generateFileId } from "@/lib/utils";
import { convertToArray } from "@/lib/utils";
import { UploadStatus, Record as RecordType, RecordSummary, AlertMessage, ProcessingJob } from "@/lib/types";
import { recordsService } from "@/services/recordsService";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AlertMessageComp from "@/components/dashboard/AlertMessage";
import UploadModal from "@/components/dashboard/UploadModal";
import DeleteModal from "@/components/dashboard/DeleteModal";
import SalesforceSyncModal from "@/components/dashboard/SalesforceSyncModal";
import RecordsTable from "@/components/dashboard/RecordsTable";

// localStorage key for persisting active job across page navigations
const ACTIVE_JOB_KEY = 'smartstaff_active_job';

export default function DashboardPage() {
  const { user } = useAuth();
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const { records, pagination, loading, refetch } = useRecords(currentPage, rowsPerPage);
  
  const [alertMessage, setAlertMessage] = useState<AlertMessage | null>(null);
  const [isSkillSheetOpen, setIsSkillSheetOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<RecordType | null>(null);
  const [isSalesforceOpen, setIsSalesforceOpen] = useState(false);
  const [selectedSalesforceRecord, setSelectedSalesforceRecord] = useState<RecordType | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    progress: 'uploading',
    message: '',
  });
  const [isUploadModalVisible, setIsUploadModalVisible] = useState(false);
  const [isLoROpen, setIsLoROpen] = useState(false);
  const [selectedLoRRecord, setSelectedLoRRecord] = useState<RecordType | null>(null);
  const [showSalesforceModal, setShowSalesforceModal] = useState(false);
  const [modalStaffId, setModalStaffId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<'skillSheet' | 'salesforce' | null>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [staffMemo, setStaffMemo] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<RecordType | null>(null);
  const [detailRecordId, setDetailRecordId] = useState<number | null>(null);
  const { record: detailRecord, loading: detailLoading } = useRecordDetail(detailRecordId);

  const notify = (type: 'success' | 'error', message: string) => {
    setAlertMessage({ type, message });
  };

  // Update selected record when detail loads - always update to ensure fresh data
  useEffect(() => {
    if (detailRecord && detailRecordId === detailRecord.id && !detailLoading) {
      if (isSkillSheetOpen) {
        setSelectedRecord(detailRecord);
      }
      if (isSalesforceOpen) {
        setSelectedSalesforceRecord(detailRecord);
      }
      if (isLoROpen) {
        setSelectedLoRRecord(detailRecord);
      }
    }
  }, [detailRecord, detailRecordId, detailLoading, isSkillSheetOpen, isSalesforceOpen, isLoROpen]);

  // Polling cleanup reference
  const [pollCleanup, setPollCleanup] = useState<(() => void) | null>(null);

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
        const stored = localStorage.getItem(ACTIVE_JOB_KEY);
        if (!stored) return;

        const { jobId } = JSON.parse(stored);
        if (!jobId) return;

        // Fetch current job status
        const job = await recordsService.getJobStatus(jobId);

        if (job.status === 'pending' || job.status === 'processing') {
          // Job still running - restore state and resume polling
          const progressMap: { [key: string]: UploadStatus['progress'] } = {
            'pending': 'uploading',
            'processing': 'transcribing',
          };

          setUploadStatus({
            isUploading: true,
            progress: progressMap[job.status] || 'processing',
            message: job.currentStep || '処理中...',
            progressPercent: job.progress,
            jobId: job.jobId
          });

          // Resume polling
          const cleanup = recordsService.pollJobStatus(
            jobId,
            handleProgressUpdate,
            handleJobComplete,
            handleJobError
          );
          setPollCleanup(() => cleanup);
        } else if (job.status === 'completed') {
          // Job completed while away - show completion modal
          localStorage.removeItem(ACTIVE_JOB_KEY);
          setUploadStatus({
            isUploading: false,
            progress: 'complete',
            message: '処理が完了しました。',
            progressPercent: 100,
            jobId: job.jobId
          });
          setIsUploadModalVisible(true);
          notify('success', 'ファイルの処理が完了しました。');
          refetch();
        } else if (job.status === 'failed') {
          // Job failed while away - show error modal
          localStorage.removeItem(ACTIVE_JOB_KEY);
          setUploadStatus({
            isUploading: false,
            progress: 'error',
            message: job.errorMessage || '処理に失敗しました。',
            jobId: job.jobId
          });
          setIsUploadModalVisible(true);
          notify('error', job.errorMessage || '処理に失敗しました。');
        }
      } catch (error) {
        // If we can't fetch job status, clear storage
        localStorage.removeItem(ACTIVE_JOB_KEY);
        console.error('Failed to check active job:', error);
      }
    };

    checkActiveJob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount

  // Handle progress updates from polling
  const handleProgressUpdate = (job: ProcessingJob) => {
    const progressMap: { [key: string]: UploadStatus['progress'] } = {
      'pending': 'uploading',
      'processing': 'transcribing',
      'completed': 'complete',
      'failed': 'error'
    };

    setUploadStatus(prev => ({
      ...prev,
      isUploading: job.status !== 'completed' && job.status !== 'failed',
      progress: progressMap[job.status] || 'processing',
      message: job.currentStep || '処理中...',
      progressPercent: job.progress,
      jobId: job.jobId
    }));
  };

  // Handle job completion
  const handleJobComplete = (job: ProcessingJob) => {
    localStorage.removeItem(ACTIVE_JOB_KEY); // Clear persisted job
    setUploadStatus({
      isUploading: false,
      progress: 'complete',
      message: '処理が完了しました。',
      progressPercent: 100,
      jobId: job.jobId
    });
    setIsUploadModalVisible(true); // Show modal on completion
    notify('success', 'ファイルの処理が完了しました。');
    refetch();
    setPollCleanup(null);
  };

  // Handle job error
  const handleJobError = (error: string) => {
    localStorage.removeItem(ACTIVE_JOB_KEY); // Clear persisted job
    setUploadStatus(prev => ({
      ...prev,
      isUploading: false,
      progress: 'error',
      message: error
    }));
    setIsUploadModalVisible(true); // Show modal on error
    notify('error', error);
    setPollCleanup(null);
  };

  // File upload handler (async with polling)
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!user?.id) {
      notify('error', 'ユーザー情報の取得に失敗しました。再度ログインしてください。');
      return;
    }

    if (!file.type.startsWith('audio/')) {
      notify('error', '音声ファイルのみアップロード可能です。');
      return;
    }

    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      notify('error', 'ファイルサイズは100MB以下にしてください。');
      return;
    }

    const fileSizeInMB = file.size / (1024 * 1024);
    const estimatedMinutes = Math.ceil(fileSizeInMB * 0.5); // Faster with parallel processing
    const estimatedTime = estimatedMinutes > 1 ? `${estimatedMinutes}分程度` : '1分程度';

    setUploadStatus({
      isUploading: true,
      progress: 'uploading',
      message: 'ファイルをアップロード中です...',
      estimatedTime,
      progressPercent: 0
    });
    setIsUploadModalVisible(true); // Show modal when starting upload

    try {
      // Upload and get job ID (returns immediately)
      const response = await recordsService.uploadAudio(
        file,
        generateFileId(file.name.split('.')[0]),
        user.id.toString()
      );

      // Save active job to localStorage for persistence across page navigations
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify({ jobId: response.jobId }));

      setUploadStatus(prev => ({
        ...prev,
        progress: 'transcribing',
        message: '処理を開始しました...',
        jobId: response.jobId,
        progressPercent: 5
      }));

      // Start polling for job status
      const cleanup = recordsService.pollJobStatus(
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
        progressPercent: 0
      });
      notify('error', (error as Error).message || 'アップロードに失敗しました。');
    }
  };

  const handleSkillSheetEdit = async (record: RecordSummary) => {
    setDetailRecordId(null); // Clear first to force refetch
    setTimeout(() => {
      setDetailRecordId(record.id);
    }, 0);
    setIsSkillSheetOpen(true);
  };

  const handleSkillSheetSave = async (data: any) => {
    if (!selectedRecord) return;
    try {
      await recordsService.updateSkillSheet(
        selectedRecord.id,
        data.skill_sheet ?? data,
        data.skills
      );
      notify('success', 'スキルシートを更新しました。');
      refetch();
      setIsSkillSheetOpen(false);
      setSelectedRecord(null); // Clear selected record to force refetch on next open
    } catch (error) {
      notify('error', (error as Error).message || 'スキルシートの更新に失敗しました。');
    }
  };

  const handleSkillSheetDownload = async (record: RecordSummary) => {
    try {
      await recordsService.downloadSkillSheet(record.id, record.fileId);
      notify('success', 'スキルシートのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || 'スキルシートのダウンロードに失敗しました。');
    }
  };

  const handleSalesforceEdit = async (record: RecordSummary) => {
    setDetailRecordId(null); // Clear first to force refetch
    setTimeout(() => {
      setDetailRecordId(record.id);
    }, 0);
    setIsSalesforceOpen(true);
  };

  const handleSalesforceSave = async (data: string[], hope: string) => {
    if (!selectedSalesforceRecord) return;
    try {
      await recordsService.updateSalesforce(selectedSalesforceRecord.id, data, hope);
      notify('success', 'Salesforceデータを更新しました。');
      refetch();
      setIsSalesforceOpen(false);
    } catch (error) {
      notify('error', (error as Error).message || 'Salesforceデータの更新に失敗しました。');
    }
  };

  const handleSalesforceDownload = async (record: RecordSummary) => {
    try {
      await recordsService.downloadSalesforce(record.id, record.fileId);
      notify('success', 'Salesforceデータのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || 'Salesforceデータのダウンロードに失敗しました。');
    }
  };

  const handleLoREdit = async (record: RecordSummary) => {
    setDetailRecordId(null); // Clear first to force refetch
    setTimeout(() => {
      setDetailRecordId(record.id);
    }, 0);
    setIsLoROpen(true);
  };

  const handleLoRSave = async (data: string) => {
    if (!selectedLoRRecord) return;
    try {
      await recordsService.updateLoR(selectedLoRRecord.id, data);
      notify('success', 'スタッフ対応メモを更新しました。');
      refetch();
      setIsLoROpen(false);
      setSelectedLoRRecord(null);
    } catch (error) {
      notify('error', (error as Error).message || 'スタッフ対応メモの更新に失敗しました。');
    }
  };

  const handleLoRCopy = async (record: RecordSummary) => {
    try {
      // Need to fetch detail for LoR
      const detail = await recordsService.getRecordDetail(record.id);
      if (!detail.lor) {
        notify('error', '推薦文がありません。');
        return;
      }
      await navigator.clipboard.writeText(detail.lor ?? '');
      notify('success', '推薦文をクリップボードにコピーしました。');
    } catch (error) {
      notify('error', '推薦文のコピーに失敗しました。ブラウザの設定を確認してください。');
    }
  };

  const handleSTTDownload = async (record: RecordSummary) => {
    try {
      await recordsService.downloadSTT(record.id, record.fileId);
      notify('success', 'STTのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || 'STTのダウンロードに失敗しました。');
    }
  };

  const handleBulkDownload = async (record: RecordSummary) => {
    try {
      await recordsService.downloadBulk(record.id, record.fileId);
      notify('success', '一括データのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || '一括データのダウンロードに失敗しました。');
    }
  };

  const handleSalesforceIconClick = async (record: RecordSummary, type: 'skillSheet' | 'salesforce') => {
    setDetailRecordId(record.id);
    // Wait for detail to load, then set modal data
    if (detailRecord && detailRecord.id === record.id) {
      setModalStaffId(record.staffId);
      setModalType(type);
      setModalData(type === 'skillSheet' ? detailRecord.skillSheet : detailRecord.salesforce);
      setStaffMemo(detailRecord.hope || '');
      setShowSalesforceModal(true);
    }
  };

  // Update Salesforce modal when detail loads
  useEffect(() => {
    if (detailRecord && detailRecordId === detailRecord.id && modalType && !showSalesforceModal) {
      setModalStaffId(detailRecord.staffId);
      setModalData(modalType === 'skillSheet' ? detailRecord.skillSheet : detailRecord.salesforce);
      setStaffMemo(detailRecord.hope || '');
      setShowSalesforceModal(true);
    }
  }, [detailRecord, detailRecordId, modalType, showSalesforceModal]);

  const handleSalesforceSync = async () => {
    if (!modalStaffId || !modalType) return;
    try {
      const body: any = { staffId: modalStaffId, type: modalType };
      if (modalType === 'skillSheet') {
        body.skillSheet = modalData;
      } else if (modalType === 'salesforce') {
        body.salesforce = modalData;
      }
      body.hope = staffMemo;

      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/salesforce/sync-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message || '連携に失敗しました');
      } else {
        toast.success(data.message || '連携が完了しました');
      }
    } catch (e) {
      toast.error('サーバーエラーが発生しました');
    }
    setShowSalesforceModal(false);
  };

  const handleDeleteClick = (record: RecordSummary) => {
    // Convert RecordSummary to RecordType for delete (only needs id)
    setRecordToDelete({ ...record, skillSheet: null, salesforce: null, lor: null, stt: null, bulk: false } as RecordType);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (!recordToDelete) return;
    try {
      await recordsService.deleteRecord(recordToDelete.id);
      notify('success', 'レコードを削除しました。');
      refetch();
    } catch (error) {
      notify('error', (error as Error).message || 'レコードの削除に失敗しました。');
    } finally {
      setShowDeleteModal(false);
      setRecordToDelete(null);
    }
  };

  return (
    <Layout>
      <div className="min-h-screen bg-[#f8fafd] px-4 sm:px-6 lg:px-8 py-6 rounded-[5px]">
        <AlertMessageComp message={alertMessage} onDismiss={() => setAlertMessage(null)} />
        <UploadModal 
          uploadStatus={uploadStatus} 
          isVisible={isUploadModalVisible}
          onClose={() => setIsUploadModalVisible(false)} 
        />

        {/* Skill Sheet Sidebar */}
        <SkillSheetSidebar
          open={isSkillSheetOpen}
          onClose={() => {
            setIsSkillSheetOpen(false);
            setSelectedRecord(null);
            setDetailRecordId(null);
          }}
          skillSheetData={selectedRecord?.skillSheet}
          skills={selectedRecord?.skills}
          onSave={handleSkillSheetSave}
        />

        {/* Salesforce Sidebar */}
        <SalesforceSidebar
          open={isSalesforceOpen}
          onClose={() => {
            setIsSalesforceOpen(false);
            setSelectedSalesforceRecord(null);
            setDetailRecordId(null);
          }}
          salesforceData={selectedSalesforceRecord ? convertToArray(selectedSalesforceRecord.salesforce) : null}
          initialLor={selectedSalesforceRecord?.hope}
          onSave={handleSalesforceSave}
          staffId={selectedSalesforceRecord?.staffId}
        />

        {/* LoR Sidebar */}
        <LoRSidebar
          open={isLoROpen}
          onClose={() => {
            setIsLoROpen(false);
            setSelectedLoRRecord(null);
            setDetailRecordId(null);
          }}
          lorData={selectedLoRRecord?.lor || null}
          onSave={handleLoRSave}
          staffId={selectedLoRRecord?.staffId}
        />

        <SalesforceSyncModal
          isOpen={showSalesforceModal}
          staffId={modalStaffId}
          onClose={() => setShowSalesforceModal(false)}
          onConfirm={handleSalesforceSync}
        />
        <DeleteModal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setRecordToDelete(null);
          }}
          onConfirm={handleDeleteConfirm}
        />

        <DashboardHeader
          userName={user?.name || 'User'}
          onFileChange={handleFileChange}
          isProcessing={uploadStatus.isUploading}
          onProcessingClick={() => setIsUploadModalVisible(true)}
        />

        {/* Records Section */}
        <div className="bg-white rounded-[5px] shadow">
          <RecordsTable
            records={records}
            pagination={pagination}
            loading={loading}
            currentPage={currentPage}
            rowsPerPage={rowsPerPage}
            onPageChange={setCurrentPage}
            onRowsPerPageChange={setRowsPerPage}
            onSkillSheetEdit={handleSkillSheetEdit}
            onSkillSheetDownload={handleSkillSheetDownload}
            onSalesforceEdit={handleSalesforceEdit}
            onSalesforceDownload={handleSalesforceDownload}
            onSalesforceIconClick={handleSalesforceIconClick}
            onLoREdit={handleLoREdit}
            onLoRCopy={handleLoRCopy}
            onSTTDownload={handleSTTDownload}
            onBulkDownload={handleBulkDownload}
            onDeleteClick={handleDeleteClick}
            onNotify={notify}
            onRefetch={refetch}
          />
        </div>
      </div>
    </Layout>
  );
} 