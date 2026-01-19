'use client';

interface DeleteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recordFileId?: string;
}

export default function DeleteModal({ 
  isOpen, 
  onClose, 
  onConfirm,
  recordFileId 
}: DeleteModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
      <div className="bg-gray-50 border border-gray-400 rounded-md p-8 min-w-[350px] max-w-[95vw] flex flex-col items-center">
        <div className="text-center mb-6">
          <div className="text-lg mb-2">このレコードを削除しますか？</div>
          {recordFileId && (
            <div className="text-sm text-gray-600 mt-2">File ID: {recordFileId}</div>
          )}
          <div className="text-sm text-gray-600 mt-4">この操作は取り消せません。</div>
        </div>
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
      </div>
    </div>
  );
}
