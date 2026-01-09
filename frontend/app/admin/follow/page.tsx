"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import Layout from "@/components/Layout";
import Pagination from "@/components/molecules/pagination";
import { useAuth } from "@/contexts/AuthContext";
import SkillSheetSidebar from "@/components/SkillSheetSidebar";
import SalesforceSidebar from "@/components/SalesforceSidebar";
import LoRSidebar from "@/components/LoRSidebar";
import { toast } from 'sonner';

// Function to generate a random string of specified length
const generateRandomString = (length: number) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Function to generate a file ID in the format originalname-YYYYMMDDHHMMSS
const generateFileId = (originalName: string) => {
  const now = new Date();
  const dateStr = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  return `${originalName}-${dateStr}`;
};

interface Record {
  id: number;
  date: string;
  fileId: string;
  staffId: string;
  userName?: string;
  skillSheet: boolean;
  salesforce: string[] | null;
  lor: string | null;
  stt: boolean;
  bulk: boolean;
  skills?: string[];
  hope?: string | null;
}

// Add new interface for upload status
interface UploadStatus {
  isUploading: boolean;
  progress: 'uploading' | 'transcribing' | 'processing' | 'complete' | 'error';
  message: string;
  estimatedTime?: string;
}

type SortField = 'date' | 'fileId' | 'userName';
type SortOrder = 'asc' | 'desc';

const convertToArray = (data: any): string[] => {
  if (Array.isArray(data)) return data;
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [data];
    }
  }
  return [];
};

export default function AdminFollowPage() {
  const { user } = useAuth();
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [staffIdInput, setStaffIdInput] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [sortIconDate, setSortIconDate] = useState<'↑' | '↓'>('↓');
  const [sortIconFileId, setSortIconFileId] = useState<'↑' | '↓'>('↓');
  const [sortIconUserName, setSortIconUserName] = useState<'↑' | '↓'>('↓');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [alertMessage, setAlertMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSkillSheetOpen, setIsSkillSheetOpen] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<Record | null>(null);
  const [isSalesforceOpen, setIsSalesforceOpen] = useState(false);
  const [selectedSalesforceRecord, setSelectedSalesforceRecord] = useState<Record | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    isUploading: false,
    progress: 'uploading',
    message: '',
  });
  const [isLoROpen, setIsLoROpen] = useState(false);
  const [selectedLoRRecord, setSelectedLoRRecord] = useState<Record | null>(null);
  const [showSalesforceModal, setShowSalesforceModal] = useState(false);
  const [modalStaffId, setModalStaffId] = useState<string | null>(null);
  const [modalType, setModalType] = useState<'skillSheet' | 'salesforce' | null>(null);
  const [modalData, setModalData] = useState<any>(null);
  const [staffMemo, setStaffMemo] = useState('')

  useEffect(() => {
    fetchRecords();
  }, []);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        console.log("data",data)
        setRecords(data);
      }
    } catch (e) {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  const handleEditStaffId = (id: number, currentStaffId: string) => {
    setEditingStaffId(id);
    setStaffIdInput(currentStaffId || '');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleStaffIdBlur = async (id: number) => {
    setEditingStaffId(null);
    const trimmedInput = staffIdInput?.trim() || '';
    if (!trimmedInput) return;
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${id}/staff-id`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ staffId: trimmedInput }),
      });
      if (res.ok) {
        fetchRecords();
      }
    } catch (e) {
      // handle error
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  const handleRowsPerPageChange = (rows: number) => {
    setRowsPerPage(rows);
    setCurrentPage(1); // Reset to first page when changing rows per page
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!user?.id) {
      setAlertMessage({
        type: 'error',
        message: 'ユーザー情報の取得に失敗しました。再度ログインしてください。'
      });
      return;
    }

    // Check if file is an audio file
    if (!file.type.startsWith('audio/')) {
      setAlertMessage({
        type: 'error',
        message: '音声ファイルのみアップロード可能です。'
      });
      return;
    }

    // Check file size (e.g., max 100MB)
    const maxSize = 100 * 1024 * 1024; // 100MB in bytes
    if (file.size > maxSize) {
      setAlertMessage({
        type: 'error',
        message: 'ファイルサイズは100MB以下にしてください。'
      });
      return;
    }

    // Calculate estimated processing time based on file size
    const fileSizeInMB = file.size / (1024 * 1024);
    const estimatedMinutes = Math.ceil(fileSizeInMB * 1.5); // Rough estimate: 0.5 minutes per MB
    const estimatedTime = estimatedMinutes > 1 ? `${estimatedMinutes}分程度` : '1分程度';

    setUploadStatus({
      isUploading: true,
      progress: 'uploading',
      message: 'ファイルをアップロード中です...',
      estimatedTime
    });
    console.log("file.name.split('.')[0]", file.name.split('.')[0]);
    const formData = new FormData();
    formData.append('audio', file);
    formData.append('fileId', generateFileId(file.name.split('.')[0]));
    formData.append('staffId', user?.id.toString() || '');

    try {
      const token = localStorage.getItem("token");
      
      // Update status to transcribing
      setUploadStatus(prev => ({
        ...prev,
        progress: 'transcribing',
        message: `音声ファイルの文字起こしを開始しました。\n完了までお待ちください。`
      }));

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setUploadStatus({
          isUploading: false,
          progress: 'complete',
          message: 'ファイルの処理が完了しました。'
        });
        
        setAlertMessage({
          type: 'success',
          message: 'ファイルの処理が完了しました。'
        });
        
        fetchRecords();
      } else {
        setUploadStatus({
          isUploading: false,
          progress: 'error',
          message: data.message || 'アップロードに失敗しました。'
        });
        
        setAlertMessage({
          type: 'error',
          message: data.message || 'アップロードに失敗しました。'
        });
      }
    } catch (error) {
      setUploadStatus({
        isUploading: false,
        progress: 'error',
        message: 'アップロード中にエラーが発生しました。'
      });
      
      setAlertMessage({
        type: 'error',
        message: 'アップロード中にエラーが発生しました。'
      });
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSkillSheetEdit = (record: Record) => {
    setSelectedRecord(record);
    setIsSkillSheetOpen(true);
  };

  const handleSkillSheetSave = async (data: any) => {
    if (!selectedRecord) return;
    console.log("data", data);
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${selectedRecord.id}/skill-sheet`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        setAlertMessage({
          type: 'success',
          message: 'スキルシートを更新しました。'
        });
        fetchRecords();
        setIsSkillSheetOpen(false);
      } else {
        setAlertMessage({
          type: 'error',
          message: 'スキルシートの更新に失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: 'スキルシートの更新中にエラーが発生しました。'
      });
    }
  };

  const handleSkillSheetDownload = async (record: Record) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${record.id}/skill-sheet`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // Get the blob from the response
        const blob = await response.blob();
        
        // Create a URL for the blob
        const url = window.URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        
        // Set the filename using the record's fileId
        link.download = `skill-sheet-${record.fileId}.pdf`;
        
        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL
        window.URL.revokeObjectURL(url);

        setAlertMessage({
          type: 'success',
          message: 'スキルシートのダウンロードが完了しました。'
        });
      } else {
        setAlertMessage({
          type: 'error',
          message: 'スキルシートのダウンロードに失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: 'スキルシートのダウンロード中にエラーが発生しました。'
      });
    }
  };

  const handleSalesforceEdit = (record: Record) => {
    setSelectedSalesforceRecord(record);
    setIsSalesforceOpen(true);
  };

  const handleSalesforceSave = async (data: string[], hope: string) => {
    if (!selectedSalesforceRecord) return;

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${selectedSalesforceRecord.id}/salesforce`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ salesforceData: data, hope: hope }),
      });

      if (response.ok) {
        setAlertMessage({
          type: 'success',
          message: 'Salesforceデータを更新しました。'
        });
        fetchRecords();
        setIsSalesforceOpen(false);
      } else {
        setAlertMessage({
          type: 'error',
          message: 'Salesforceデータの更新に失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: 'Salesforceデータの更新中にエラーが発生しました。'
      });
    }
  };

  const handleSalesforceDownload = async (record: Record) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${record.id}/salesforce-pdf`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // Get the blob from the response
        const blob = await response.blob();
        
        // Create a URL for the blob
        const url = window.URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        
        // Set the filename using the record's fileId
        link.download = `salesforce-${record.fileId}.pdf`;
        
        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL
        window.URL.revokeObjectURL(url);

        setAlertMessage({
          type: 'success',
          message: 'Salesforceデータのダウンロードが完了しました。'
        });
      } else {
        setAlertMessage({
          type: 'error',
          message: 'Salesforceデータのダウンロードに失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: 'Salesforceデータのダウンロード中にエラーが発生しました。'
      });
    }
  };

  const handleLoRCopy = async (record: Record) => {
    try {
      if (!record.lor) {
        setAlertMessage({
          type: 'error',
          message: '推薦文がありません。'
        });
        return;
      }

      // Create a temporary textarea element
      const textArea = document.createElement('textarea');
      textArea.value = record.lor ?? '';
      
      // Make the textarea out of viewport
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      
      // Select and copy the text
      textArea.focus();
      textArea.select();
      
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          setAlertMessage({
            type: 'success',
            message: '推薦文をクリップボードにコピーしました。'
          });
        } else {
          throw new Error('Copy command failed');
        }
      } catch (err) {
        // Fallback to clipboard API if available
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(record.lor ?? '');
          setAlertMessage({
            type: 'success',
            message: '推薦文をクリップボードにコピーしました。'
          });
        } else {
          throw new Error('Clipboard API not available');
        }
      } finally {
        // Clean up
        document.body.removeChild(textArea);
      }
    } catch (error) {
      console.error('Error copying LOR:', error);
      setAlertMessage({
        type: 'error',
        message: '推薦文のコピーに失敗しました。ブラウザの設定を確認してください。'
      });
    }
  };

  const handleLoREdit = (record: Record) => {
    setSelectedLoRRecord(record);
    setIsLoROpen(true);
  };

  const handleLoRSave = async (data: string) => {
    if (!selectedLoRRecord) return;

    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${selectedLoRRecord.id}/lor`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ lor: data }),
      });

      if (response.ok) {
        setAlertMessage({
          type: 'success',
          message: '推薦文を更新しました。'
        });
        fetchRecords();
        setIsLoROpen(false);
      } else {
        setAlertMessage({
          type: 'error',
          message: '推薦文の更新に失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: '推薦文の更新中にエラーが発生しました。'
      });
    }
  };

  const handleSTTDownload = async (record: Record) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${record.id}/stt`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // Get the blob from the response
        const blob = await response.blob();
        
        // Create a URL for the blob
        const url = window.URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        
        // Set the filename using the record's fileId
        link.download = `stt-${record.fileId}.pdf`;
        
        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL
        window.URL.revokeObjectURL(url);

        setAlertMessage({
          type: 'success',
          message: 'STTのダウンロードが完了しました。'
        });
      } else {
        setAlertMessage({
          type: 'error',
          message: 'STTのダウンロードに失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: 'STTのダウンロード中にエラーが発生しました。'
      });
    }
  };

  const handleBulkDownload = async (record: Record) => {
    try {
      const token = localStorage.getItem("token");
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/follow/${record.id}/bulk`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        // Get the blob from the response
        const blob = await response.blob();
        
        // Create a URL for the blob
        const url = window.URL.createObjectURL(blob);
        
        // Create a temporary link element
        const link = document.createElement('a');
        link.href = url;
        
        // Set the filename using the record's fileId
        link.download = `bulk-${record.fileId}.zip`;
        
        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        // Clean up the URL
        window.URL.revokeObjectURL(url);

        setAlertMessage({
          type: 'success',
          message: 'Bulkのダウンロードが完了しました。'
        });
      } else {
        setAlertMessage({
          type: 'error',
          message: 'Bulkのダウンロードに失敗しました。'
        });
      }
    } catch (error) {
      setAlertMessage({
        type: 'error',
        message: 'Bulkのダウンロード中にエラーが発生しました。'
      });
    }
  };

  const parseDate = (dateString: string) => {
    const date = new Date(dateString);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
      seconds: date.getSeconds()
    };
  };

  const formatDate = (dateString: string) => {
    const date = parseDate(dateString);
    return `${date.year}/${String(date.month).padStart(2, '0')}/${String(date.day).padStart(2, '0')}`;
  };

  const handleColumnSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }

    // Update sort icons
    if (field === 'date') {
      setSortIconDate(sortOrder === 'asc' ? '↑' : '↓');
    } else if (field === 'fileId') {
      setSortIconFileId(sortOrder === 'asc' ? '↑' : '↓');
    } else if (field === 'userName') {
      setSortIconUserName(sortOrder === 'asc' ? '↑' : '↓');
    }
  };

  const handleSalesforceIconClick = (staffId: string, type: 'skillSheet' | 'salesforce', data: any, hope: any) => {
    setModalStaffId(staffId);
    setModalType(type);
    setModalData(data);
    setStaffMemo(hope)
    setShowSalesforceModal(true);
  };

  const handleSalesforceSync = async () => {
    if (!modalStaffId || !modalType) return;
    const token = localStorage.getItem("token");
    try {
      const body: any = { staffId: modalStaffId, type: modalType };
      if (modalType === 'skillSheet') {
        body.skillSheet = modalData;
      } else if (modalType === 'salesforce') {
        body.salesforce = modalData;
      }
      body.hope = staffMemo;
      console.log(body)
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

  // Computed values for filtering and pagination
  const filteredRecords = useMemo(() => {
    return records.filter(record => {
      const searchLower = searchTerm.toLowerCase();
      return (
        formatDate(record.date).toLowerCase().includes(searchLower) ||
        record.fileId.toLowerCase().includes(searchLower)
      );
    }).sort((a, b) => {
      let aValue: any, bValue: any;
      
      switch (sortField) {
        case 'date':
          aValue = new Date(a.date);
          bValue = new Date(b.date);
          break;
        case 'fileId':
          aValue = a.fileId;
          bValue = b.fileId;
          break;
        case 'userName':
          aValue = a.userName || '';
          bValue = b.userName || '';
          break;
        default:
          return 0;
      }
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });
  }, [records, searchTerm, sortField, sortOrder]);

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    return filteredRecords.slice(startIndex, endIndex);
  }, [filteredRecords, currentPage, rowsPerPage]);

  // Redirect if not admin
  if (user && user.role !== 'admin') {
    // Redirect to appropriate company dashboard
    const companySlug = user.company?.slug || 'default';
    window.location.href = `/${companySlug}/dashboard`;
    return null;
  }

  return (
    <Layout>
      <div className="min-h-screen bg-[#f8fafd] px-4 sm:px-6 lg:px-8 py-6 rounded-[5px]">
        {/* Alert Message */}
        {alertMessage && (
          <div className={`fixed top-4 right-4 z-50 p-4 rounded-[5px] shadow-lg ${
            alertMessage.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {alertMessage.message}
          </div>
        )}

        {/* Upload Status Modal */}
        {uploadStatus.isUploading && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 mb-4">
                  {uploadStatus.progress === 'uploading' && (
                    <div className="w-full h-full border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  )}
                  {uploadStatus.progress === 'transcribing' && (
                    <div className="w-full h-full border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  )}
                  {uploadStatus.progress === 'processing' && (
                    <div className="w-full h-full border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                  )}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  {uploadStatus.progress === 'uploading' && 'アップロード中...'}
                  {uploadStatus.progress === 'transcribing' && '文字起こし処理中...'}
                  {uploadStatus.progress === 'processing' && '処理中...'}
                </h3>
                <p className="text-gray-600 text-center whitespace-pre-line">
                  {uploadStatus.message}
                </p>
                <button
                  className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
                  onClick={() => setUploadStatus({ ...uploadStatus, isUploading: false })}
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* Modal for Salesforce confirmation */}
        {showSalesforceModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
            <div className="bg-gray-50 border border-gray-400 rounded-md p-8 min-w-[350px] max-w-[95vw] flex flex-col items-center">
              <div className="text-center mb-6">
                <div className="text-lg mb-2">以下スタッフIDの情報をセールスフォースへ連携します。<br/>よろしいですか？</div>
                <div className="text-xl font-semibold mt-4 mb-2">Staff ID　{modalStaffId}</div>
              </div>
              <div className="flex gap-8 mt-2">
                <button
                  className="border border-gray-400 rounded px-8 py-2 text-lg hover:bg-gray-200"
                  onClick={() => setShowSalesforceModal(false)}
                >キャンセル</button>
                <button
                  className="border border-gray-400 rounded px-8 py-2 text-lg hover:bg-gray-200"
                  onClick={handleSalesforceSync}
                >連携する</button>
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
                disabled={isUploading}
                className={`bg-white rounded-full shadow border border-gray-200 mt-2 ${
                  isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'
                }`}
              >
                {isUploading ? (
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

        {/* Follow Section */}
        <div className="bg-white rounded-[5px] shadow">
          <div className="p-4 sm:p-6 lg:p-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-lg sm:text-xl font-semibold rounded-[5px]">Follow</h2>
              <div className="flex items-center gap-4">
                <div className="text-green-500 text-sm rounded-[5px]">過去30日間のデータ</div>
                <div className="relative w-56">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Image
                      src="/search.svg"
                      alt="Search"
                      width={16}
                      height={16}
                      className="text-gray-400"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="日付またはFile IDで検索"
                    className="pl-10 pr-4 py-2 rounded-[5px] border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 text-gray-700 w-full shadow-sm"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto rounded-[5px] -mx-4 sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full align-middle max-w-[300px]">
                <table className="min-w-full text-left text-gray-700 rounded-[5px]">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-400 rounded-[5px]">
                      <th 
                        className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px] cursor-pointer hover:bg-gray-50"
                        onClick={() => handleColumnSort('date')}
                      >
                        Date <span className="ml-1">{sortIconDate}</span>
                      </th>
                      <th 
                        className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px] cursor-pointer hover:bg-gray-50"
                        onClick={() => handleColumnSort('userName')}
                      >
                        User Name <span className="ml-1">{sortIconUserName}</span>
                      </th>
                      <th 
                        className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px] cursor-pointer hover:bg-gray-50"
                        onClick={() => handleColumnSort('fileId')}
                      >
                        File ID <span className="ml-1">{sortIconFileId}</span>
                      </th>
                      <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">Staff ID</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[120px] max-w-[300px] rounded-[5px]">Skill Sheet</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[120px] max-w-[300px] rounded-[5px]">Salesforce</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">LoR</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">STT</th>
                      <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">Bulk</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr><td colSpan={9} className="text-center py-8">Loading...</td></tr>
                    ) : paginatedRecords.length === 0 ? (
                      <tr><td colSpan={9} className="text-center py-8">No records found</td></tr>
                    ) : (
                      paginatedRecords.map((rec) => (
                        <tr key={rec.id} className="border-b border-gray-100 hover:bg-gray-50 transition text-left align-middle rounded-[5px]">
                          <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px] truncate">{formatDate(rec.date)}</td>
                          <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px] truncate">{rec.userName}</td>
                          <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px] truncate">{rec.fileId}</td>
                          <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                            <div className="flex items-center gap-x-2 rounded-[5px] truncate">
                              {editingStaffId === rec.id ? (
                                <input
                                  ref={inputRef}
                                  value={staffIdInput}
                                  onChange={e => setStaffIdInput(e.target.value)}
                                  onBlur={() => handleStaffIdBlur(rec.id)}
                                  className="border border-gray-300 rounded-[5px] px-2 py-1 w-20 text-center"
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
                          {/* Skill Sheet icons */}
                          <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
                            <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Edit"
                                onClick={() => handleSkillSheetEdit(rec)}
                              >
                                <Image src="/edit1.svg" alt="Edit" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Download"
                                onClick={() => handleSkillSheetDownload(rec)}
                              >
                                <Image src="/download1.svg" alt="Download" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Salesforce"
                                onClick={() => handleSalesforceIconClick(rec.staffId, 'skillSheet', rec.skillSheet, rec.hope)}
                              >
                                <Image src="/salesforce1.svg" alt="Salesforce" width={20} height={20} className="rounded-[5px]" />
                              </button>
                            </div>
                          </td>
                          {/* Salesforce icons */}
                          <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
                            <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Edit"
                                onClick={() => handleSalesforceEdit(rec)}
                              >
                                <Image src="/edit1.svg" alt="Edit" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Download"
                                onClick={() => handleSalesforceDownload(rec)}
                              >
                                <Image src="/download1.svg" alt="Download" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Salesforce"
                                onClick={() => handleSalesforceIconClick(rec.staffId, 'salesforce', rec.salesforce, rec.hope)}
                              >
                                <Image src="/salesforce1.svg" alt="Salesforce" width={20} height={20} className="rounded-[5px]" />
                              </button>
                            </div>
                          </td>
                          {/* LoR icons */}
                          <td className="py-5 px-4 align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                            <div className="flex items-center justify-center rounded-[5px] gap-x-3">
                              <button
                                onClick={() => handleLoREdit(rec)}
                                className="text-blue-600 hover:text-blue-800 transition-colors"
                                title="編集"
                              >
                                <Image src="/edit1.svg" alt="Edit" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <button
                                onClick={() => handleLoRCopy(rec)}
                              >
                                <Image src="/copy1.svg" alt="copy" width={20} height={20} className="rounded-[5px]" />
                              </button>
                            </div>
                          </td>
                          {/* STT icons */}
                          <td className="py-5 px-4 align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                            <div className="flex items-center justify-center rounded-[5px]">
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Download"
                                onClick={() => handleSTTDownload(rec)}
                              >
                                <Image src="/download1.svg" alt="download" width={20} height={20} className="rounded-[5px]" />
                              </button>
                            </div>
                          </td>
                          {/* Bulk icons */}
                          <td className="py-5 px-4 align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                            <div className="flex items-center justify-center rounded-[5px]">
                              <button 
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0" 
                                title="Download"
                                onClick={() => handleBulkDownload(rec)}
                              >
                                <Image src="/download1.svg" alt="download" width={20} height={20} className="rounded-[5px]" />
                              </button>
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
            totalItems={filteredRecords.length}
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
