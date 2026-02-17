'use client';

import React, { useState, useEffect } from 'react';

const MAX_TITLE_LENGTH = 1000;
const MAX_SUMMARY_LENGTH = 3000;

interface FollowSummarySidebarProps {
  open: boolean;
  onClose: () => void;
  followDate: string;
  title: string;
  summary: string;
  onSave: (data: { followDate: string; title: string; summary: string }) => void;
}

const FollowSummarySidebar: React.FC<FollowSummarySidebarProps> = ({
  open,
  onClose,
  followDate: initialFollowDate,
  title: initialTitle,
  summary: initialSummary,
  onSave,
}) => {
  const [localFollowDate, setLocalFollowDate] = useState('');
  const [localTitle, setLocalTitle] = useState('');
  const [localSummary, setLocalSummary] = useState('');
  const [hasChanges, setHasChanges] = useState(false);
  const [initialState, setInitialState] = useState('');

  useEffect(() => {
    if (open) {
      const date = initialFollowDate || new Date().toISOString().split('T')[0];
      setLocalFollowDate(date);
      setLocalTitle(initialTitle || '');
      setLocalSummary(initialSummary || '');
      const state = JSON.stringify({ date, title: initialTitle || '', summary: initialSummary || '' });
      setInitialState(state);
      setHasChanges(false);
    }
  }, [open, initialFollowDate, initialTitle, initialSummary]);

  useEffect(() => {
    if (open) {
      const current = JSON.stringify({ date: localFollowDate, title: localTitle, summary: localSummary });
      setHasChanges(current !== initialState);
    }
  }, [localFollowDate, localTitle, localSummary, initialState, open]);

  const handleSave = () => {
    onSave({
      followDate: localFollowDate,
      title: localTitle,
      summary: localSummary,
    });
    setInitialState(JSON.stringify({ date: localFollowDate, title: localTitle, summary: localSummary }));
    setHasChanges(false);
  };

  const handleClose = () => {
    if (hasChanges) {
      const confirmed = window.confirm('保存されていませんが画面を閉じますか？');
      if (!confirmed) return;
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Overlay */}
      <div className="fixed inset-0 bg-black opacity-30" onClick={handleClose}></div>
      {/* Sidebar */}
      <div className="relative ml-auto w-full max-w-[40%] min-w-[400px] h-full bg-white shadow-xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <button
            className="text-gray-500 hover:text-gray-700 transition-colors"
            onClick={handleClose}
            title="閉じる"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <button
            className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
            onClick={handleSave}
            title="保存"
          >
            <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* 実施日時 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">実施日時</label>
            <input
              type="date"
              value={localFollowDate}
              onChange={(e) => setLocalFollowDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>

          {/* タイトル */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">タイトル</label>
            <input
              type="text"
              value={localTitle}
              onChange={(e) => {
                if (e.target.value.length <= MAX_TITLE_LENGTH) {
                  setLocalTitle(e.target.value);
                }
              }}
              maxLength={MAX_TITLE_LENGTH}
              placeholder="タイトルを入力してください..."
              className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <div className="flex justify-end mt-1">
              <span className={`text-xs ${localTitle.length > MAX_TITLE_LENGTH ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                {localTitle.length} / {MAX_TITLE_LENGTH}
              </span>
            </div>
          </div>

          {/* 面談要約 */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">面談要約</label>
            <textarea
              value={localSummary}
              onChange={(e) => {
                if (e.target.value.length <= MAX_SUMMARY_LENGTH) {
                  setLocalSummary(e.target.value);
                }
              }}
              maxLength={MAX_SUMMARY_LENGTH}
              placeholder="面談要約を入力してください..."
              className="w-full h-[400px] px-3 py-2 border border-gray-200 rounded-xl text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <div className="flex justify-end mt-1">
              <span className={`text-xs ${localSummary.length > MAX_SUMMARY_LENGTH ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                {localSummary.length} / {MAX_SUMMARY_LENGTH}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FollowSummarySidebar;
