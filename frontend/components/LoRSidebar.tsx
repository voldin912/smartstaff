import React, { useState, useEffect } from 'react';

interface LoRSidebarProps {
  open: boolean;
  onClose: () => void;
  lorData: string | null;
  onSave: (data: string) => void;
  staffId?: string | number;
}

const LoRSidebar: React.FC<LoRSidebarProps> = ({
  open,
  onClose,
  lorData,
  onSave,
  staffId,
}) => {
  const [lor, setLor] = useState<string>(lorData || '');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (lorData) {
      setLor(lorData);
      setHasChanges(false);
    } else {
      setLor('');
      setHasChanges(false);
    }
  }, [lorData]);

  const handleLorChange = (value: string) => {
    setLor(value);
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(lor);
    setHasChanges(false);
  };

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm('保存されていませんが画面を閉じますか？');
      if (confirmed) {
        onClose();
      }
    } else {
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[40%] min-w-[400px] bg-white shadow-lg transform transition-transform duration-300 ease-in-out z-50">
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-gray-700">推薦文</span>
            {staffId && <span className="text-sm text-gray-500">(ID: {staffId})</span>}
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-700 mr-2">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* LOR Input Area */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="bg-white rounded-xl shadow p-4 h-full">
            <textarea
              value={lor}
              onChange={e => handleLorChange(e.target.value)}
              className="w-full h-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 bg-gray-100 max-h-[calc(100vh-150px)] scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
              placeholder="推薦文の内容を入力してください"
              style={{ fontSize: '15px' }}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="p-4 border-t bg-white">
          <div className="flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoRSidebar; 