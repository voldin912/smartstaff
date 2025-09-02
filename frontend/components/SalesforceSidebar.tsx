import React, { useState, useEffect } from 'react';

interface SalesforceSidebarProps {
  open: boolean;
  onClose: () => void;
  salesforceData: string[] | null;
  onSave: (data: string[], lor: string) => void;
  staffId?: string | number;
  initialLor?: string | null;
}

const SalesforceSidebar: React.FC<SalesforceSidebarProps> = ({
  open,
  onClose,
  salesforceData,
  onSave,
  staffId,
  initialLor = '',
}) => {
  const [workContents, setWorkContents] = useState<string[]>([]);
  const [lor, setLor] = useState<string>(initialLor || '');
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (salesforceData) {
      // Ensure salesforceData is an array
      const contents = Array.isArray(salesforceData) ? salesforceData : [];
      setWorkContents(contents);
      setHasChanges(false);
      console.log("salesforceData", contents);
    } else {
      // Initialize with empty array if no data
      setWorkContents([]);
      setHasChanges(false);
    }
  }, [salesforceData]);

  useEffect(() => {
    setLor(initialLor || '');
  }, [initialLor]);

  const handleWorkContentChange = (index: number, value: string) => {
    const newWorkContents = [...workContents];
    newWorkContents[index] = value;
    setWorkContents(newWorkContents);
    setHasChanges(true);
  };

  const handleAddCareer = (index: number) => {
    const newWorkContents = [...workContents];
    newWorkContents.splice(index + 1, 0, ''); // Add empty string after the clicked index
    setWorkContents(newWorkContents);
    setHasChanges(true);
  };

  const handleDeleteCareer = (index: number) => {
    if (workContents.length <= 1) {
      alert('最低1つの経歴が必要です。');
      return;
    }
    const newWorkContents = [...workContents];
    newWorkContents.splice(index, 1);
    setWorkContents(newWorkContents);
    setHasChanges(true);
  };

  const handleLorChange = (value: string) => {
    setLor(value);
    setHasChanges(true);
  };

  const handleSave = () => {
    onSave(workContents, lor);
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
            <span className="text-lg font-semibold text-gray-700">Salesforce</span>
          </div>
          <button onClick={handleClose} className="text-gray-500 hover:text-gray-700 mr-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
        </div>

        {/* Experience Cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {workContents.map((content, index) => (
            <div key={index} className="bg-white rounded-xl shadow p-4">
              <div className="flex justify-between items-center mb-2">
                <div className="text-sm font-semibold text-gray-500">経歴 {index + 1}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAddCareer(index)}
                    className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600 transition-colors"
                  >
                    追加
                  </button>
                  <button
                    onClick={() => handleDeleteCareer(index)}
                    className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
                  >
                    削除
                  </button>
                </div>
              </div>
              <textarea
                value={content}
                onChange={e => handleWorkContentChange(index, e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 bg-gray-100 min-h-[70px] max-h-40 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
                rows={4}
                placeholder="業務内容を入力してください"
                style={{ fontSize: '15px' }}
              />
            </div>
          ))}

          {/* LOR Input Area */}
          <div className="bg-white rounded-xl shadow p-4 mt-4">
            <div className="text-sm font-semibold text-gray-500 mb-2">スタッフ対応メモ</div>
            <textarea
              value={lor}
              onChange={e => handleLorChange(e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 text-gray-800 bg-gray-100 min-h-[100px] max-h-60 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
              rows={6}
              placeholder="スタッフ対応メモの内容を入力してください"
              style={{ fontSize: '15px' }}
            />
          </div>
        </div>

        {/* Save Button */}
        <div className="p-4 border-t bg-white">
          <div className="flex justify-end gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-gray-200 rounded"
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SalesforceSidebar; 