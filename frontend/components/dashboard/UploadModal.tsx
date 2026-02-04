'use client';

import { UploadStatus } from '@/lib/types';

interface UploadModalProps {
  uploadStatus: UploadStatus;
  onClose: () => void;
}

export default function UploadModal({ uploadStatus, onClose }: UploadModalProps) {
  if (!uploadStatus.isUploading) return null;

  const progressPercent = uploadStatus.progressPercent || 0;
  const isProcessing = uploadStatus.progress === 'uploading' || 
    uploadStatus.progress === 'transcribing' || 
    uploadStatus.progress === 'processing';

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="flex flex-col items-center">
          {/* Spinner */}
          <div className="w-16 h-16 mb-4 relative">
            {isProcessing && (
              <div className="w-full h-full border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            )}
            {uploadStatus.progress === 'complete' && (
              <div className="w-full h-full flex items-center justify-center bg-green-100 rounded-full">
                <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
            {uploadStatus.progress === 'error' && (
              <div className="w-full h-full flex items-center justify-center bg-red-100 rounded-full">
                <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            )}
          </div>

          {/* Title */}
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {uploadStatus.progress === 'uploading' && 'アップロード中...'}
            {uploadStatus.progress === 'transcribing' && 'STT処理中...'}
            {uploadStatus.progress === 'processing' && '処理中...'}
            {uploadStatus.progress === 'complete' && '処理完了'}
            {uploadStatus.progress === 'error' && 'エラーが発生しました'}
          </h3>

          {/* Progress Bar */}
          {isProcessing && progressPercent > 0 && (
            <div className="w-full bg-gray-200 rounded-full h-3 mb-3">
              <div 
                className="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}

          {/* Progress Percentage */}
          {isProcessing && progressPercent > 0 && (
            <p className="text-sm font-medium text-indigo-600 mb-2">
              {progressPercent}%
            </p>
          )}

          {/* Message */}
          <p className="text-gray-600 text-center whitespace-pre-line">
            {uploadStatus.message}
          </p>

          {/* Estimated Time */}
          {uploadStatus.estimatedTime && (
            <p className="text-sm text-gray-500 mt-2">
              予想時間: {uploadStatus.estimatedTime}
            </p>
          )}

          {/* Job ID for reference */}
          {uploadStatus.jobId && (
            <p className="text-xs text-gray-400 mt-2">
              ジョブID: {uploadStatus.jobId}
            </p>
          )}

          {/* Close Button */}
          <button
            className={`mt-4 px-4 py-2 rounded transition-colors ${
              uploadStatus.progress === 'complete' 
                ? 'bg-green-600 text-white hover:bg-green-700'
                : uploadStatus.progress === 'error'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
            onClick={onClose}
          >
            {uploadStatus.progress === 'complete' ? '完了' : 
             uploadStatus.progress === 'error' ? '閉じる' : 
             'バックグラウンドで続行'}
          </button>

          {/* Background processing hint */}
          {isProcessing && (
            <p className="text-xs text-gray-400 mt-2">
              このダイアログを閉じても処理は続行されます
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
