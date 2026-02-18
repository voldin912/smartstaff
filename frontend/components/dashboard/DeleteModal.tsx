'use client';

interface DeleteModalProps {
  isOpen: boolean;
  isLoading?: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recordFileId?: string;
}

export default function DeleteModal({ 
  isOpen, 
  isLoading = false,
  onClose, 
  onConfirm,
  recordFileId 
}: DeleteModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-gray-50 border border-gray-400 rounded-md p-8 min-w-[350px] max-w-[95vw] flex flex-col items-center">
        <div className="text-center mb-6">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <svg className="animate-spin h-8 w-8 text-red-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <div className="text-lg">削除中...</div>
              <div className="text-sm text-gray-500">しばらくお待ちください</div>
            </div>
          ) : (
            <>
              <div className="text-lg mb-2">このレコードを削除しますか？</div>
              {recordFileId && (
                <div className="text-sm text-gray-600 mt-2">File ID: {recordFileId}</div>
              )}
              <div className="text-sm text-gray-600 mt-4">この操作は取り消せません。</div>
            </>
          )}
        </div>
        {!isLoading && (
          <div className="flex gap-8 mt-2">
            <button
              className="border border-gray-400 rounded px-8 py-2 text-lg hover:bg-gray-200"
              onClick={onClose}
            >
              キャンセル
            </button>
            <button
              className="bg-red-500 text-white rounded px-8 py-2 text-lg hover:bg-red-600"
              onClick={onConfirm}
            >
              OK
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
