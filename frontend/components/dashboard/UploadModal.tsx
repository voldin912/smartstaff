'use client';

import { UploadStatus } from '@/lib/types';

interface UploadModalProps {
  uploadStatus: UploadStatus;
  onClose: () => void;
}

export default function UploadModal({ uploadStatus, onClose }: UploadModalProps) {
  if (!uploadStatus.isUploading) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 mb-4">
            {(uploadStatus.progress === 'uploading' || 
              uploadStatus.progress === 'transcribing' || 
              uploadStatus.progress === 'processing') && (
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
          {uploadStatus.estimatedTime && (
            <p className="text-sm text-gray-500 mt-2">
              予想時間: {uploadStatus.estimatedTime}
            </p>
          )}
          <button
            className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
