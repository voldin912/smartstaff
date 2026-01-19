'use client';

import Image from 'next/image';
import { useRef } from 'react';

interface DashboardHeaderProps {
  userName?: string;
  isUploading: boolean;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export default function DashboardHeader({
  userName,
  isUploading,
  onFileChange,
}: DashboardHeaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8 rounded-[5px]">
      <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 rounded-[5px]">
        Hello {userName || 'User'} <span role="img" aria-label="wave">👋</span>,
      </h1>
      <div className="flex items-center gap-4 rounded-[5px] w-full sm:w-auto">
        <div className="relative rounded-[5px] flex flex-col items-end gap-2 w-full sm:w-auto">
          <input
            type="file"
            ref={fileInputRef}
            onChange={onFileChange}
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
  );
}
