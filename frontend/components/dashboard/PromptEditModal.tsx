'use client';

import { useState } from 'react';

const MAX_PROMPT_LENGTH = 3000;

interface PromptEditModalProps {
  isVisible: boolean;
  isLoading: boolean;
  promptText: string;
  onPromptChange: (text: string) => void;
  onSave: () => void;
  onClose: () => void;
  isSaving: boolean;
}

export default function PromptEditModal({
  isVisible,
  isLoading,
  promptText,
  onPromptChange,
  onSave,
  onClose,
  isSaving,
}: PromptEditModalProps) {
  if (!isVisible) return null;

  const charCount = promptText.length;
  const isOverLimit = charCount > MAX_PROMPT_LENGTH;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">要約プロンプト</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={onSave}
              disabled={isSaving || isLoading || isOverLimit}
              className="p-2 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50"
              title="保存"
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <svg className="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                </svg>
              )}
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-gray-100 transition-colors"
              title="閉じる"
            >
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
        <div className="p-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-52">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : (
            <>
              <textarea
                value={promptText}
                onChange={(e) => {
                  if (e.target.value.length <= MAX_PROMPT_LENGTH) {
                    onPromptChange(e.target.value);
                  }
                }}
                maxLength={MAX_PROMPT_LENGTH}
                className="w-full h-52 p-3 border border-gray-200 rounded-xl resize-y text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="要約プロンプトを入力してください..."
              />
              <div className="flex justify-end mt-2">
                <span className={`text-xs ${isOverLimit ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                  {charCount} / {MAX_PROMPT_LENGTH}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
