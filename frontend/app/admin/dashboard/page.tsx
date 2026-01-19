"use client";

import { useState } from "react";
import Layout from "@/components/Layout";
import { useAuth } from "@/contexts/AuthContext";
import SkillSheetSidebar from "@/components/SkillSheetSidebar";
import SalesforceSidebar from "@/components/SalesforceSidebar";
import LoRSidebar from "@/components/LoRSidebar";
import { toast } from 'sonner';

import { useRecords } from "@/hooks/useRecords";
import { generateFileId } from "@/lib/utils";
import { convertToArray } from "@/lib/utils";
import { UploadStatus, Record as RecordType, AlertMessage } from "@/lib/types";
import { recordsService } from "@/services/recordsService";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import AlertMessageComp from "@/components/dashboard/AlertMessage";
import UploadModal from "@/components/dashboard/UploadModal";
import DeleteModal from "@/components/dashboard/DeleteModal";
import SalesforceSyncModal from "@/components/dashboard/SalesforceSyncModal";
import RecordsTable from "@/components/dashboard/RecordsTable";

export default function DashboardPage() {
  const { user } = useAuth();
  const { records, loading, refetch } = useRecords();
  
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
  const [isLoROpen, setIsLoROpen] = useState(false);
  const [selectedLoRRecord, setSelectedLoRRecord] = useState<RecordType | null>(null);
  const [showSalesforceModal, setShowSalesforceModal] = useState(false);
  const [modalStaffId, setModalStaffId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<'skillSheet' | 'salesforce' | null>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [staffMemo, setStaffMemo] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<RecordType | null>(null);

  const notify = (type: 'success' | 'error', message: string) => {
    setAlertMessage({ type, message });
  };

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
    const estimatedMinutes = Math.ceil(fileSizeInMB * 1.5);
    const estimatedTime = estimatedMinutes > 1 ? `${estimatedMinutes}分程度` : '1分程度';

    setUploadStatus({
      isUploading: true,
      progress: 'uploading',
      message: 'ファイルをアップロード中です...',
      estimatedTime
    });

    try {
      setUploadStatus(prev => ({
        ...prev,
        progress: 'transcribing',
        message: `音声ファイルの文字起こしを開始しました。\n完了までお待ちください。`
      }));

      await recordsService.uploadAudio(
        file,
        generateFileId(file.name.split('.')[0]),
        user.id.toString()
      );

      setUploadStatus({
        isUploading: false,
        progress: 'complete',
        message: 'ファイルの処理が完了しました。'
      });
      
      notify('success', 'ファイルの処理が完了しました。');
      refetch();
    } catch (error) {
      setUploadStatus({
        isUploading: false,
        progress: 'error',
        message: (error as Error).message || 'アップロードに失敗しました。'
      });
      notify('error', (error as Error).message || 'アップロードに失敗しました。');
    }
  };

  const handleSkillSheetEdit = (record: RecordType) => {
    setSelectedRecord(record);
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
    } catch (error) {
      notify('error', (error as Error).message || 'スキルシートの更新に失敗しました。');
    }
  };

  const handleSkillSheetDownload = async (record: RecordType) => {
    try {
      await recordsService.downloadSkillSheet(record.id, record.fileId);
      notify('success', 'スキルシートのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || 'スキルシートのダウンロードに失敗しました。');
    }
  };

  const handleSalesforceEdit = (record: RecordType) => {
    setSelectedSalesforceRecord(record);
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

  const handleSalesforceDownload = async (record: RecordType) => {
    try {
      await recordsService.downloadSalesforce(record.id, record.fileId);
      notify('success', 'Salesforceデータのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || 'Salesforceデータのダウンロードに失敗しました。');
    }
  };

  const handleLoREdit = (record: RecordType) => {
    setSelectedLoRRecord(record);
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

  const handleLoRCopy = async (record: RecordType) => {
    try {
      if (!record.lor) {
        notify('error', '推薦文がありません。');
        return;
      }
      await navigator.clipboard.writeText(record.lor ?? '');
      notify('success', '推薦文をクリップボードにコピーしました。');
    } catch (error) {
      notify('error', '推薦文のコピーに失敗しました。ブラウザの設定を確認してください。');
    }
  };

  const handleSTTDownload = async (record: RecordType) => {
    try {
      await recordsService.downloadSTT(record.id, record.fileId);
      notify('success', 'STTのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || 'STTのダウンロードに失敗しました。');
    }
  };

  const handleBulkDownload = async (record: RecordType) => {
    try {
      await recordsService.downloadBulk(record.id, record.fileId);
      notify('success', '一括データのダウンロードが完了しました。');
    } catch (error) {
      notify('error', (error as Error).message || '一括データのダウンロードに失敗しました。');
    }
  };

  const handleSalesforceIconClick = (record: RecordType, type: 'skillSheet' | 'salesforce') => {
    setModalStaffId(record.staffId);
    setModalType(type);
    setModalData(type === 'skillSheet' ? record.skillSheet : record.salesforce);
    setStaffMemo(record.hope || '');
    setShowSalesforceModal(true);
  };

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

  const handleDeleteClick = (record: RecordType) => {
    setRecordToDelete(record);
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
        <UploadModal uploadStatus={uploadStatus} onClose={() => setUploadStatus({ ...uploadStatus, isUploading: false })} />

        {/* Skill Sheet Sidebar */}
        <SkillSheetSidebar
          open={isSkillSheetOpen}
          onClose={() => setIsSkillSheetOpen(false)}
          skillSheetData={selectedRecord?.skillSheet}
          skills={selectedRecord?.skills}
          onSave={handleSkillSheetSave}
        />

        {/* Salesforce Sidebar */}
        <SalesforceSidebar
          open={isSalesforceOpen}
          onClose={() => setIsSalesforceOpen(false)}
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
          isUploading={uploadStatus.isUploading}
        />

        {/* Records Section */}
        <div className="bg-white rounded-[5px] shadow">
          <RecordsTable
            records={records}
            loading={loading}
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