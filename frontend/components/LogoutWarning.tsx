'use client';

import { useAuth } from '@/contexts/AuthContext';

export default function LogoutWarning() {
  const { showLogoutWarning, dismissLogoutWarning } = useAuth();

  if (!showLogoutWarning) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
        <div className="flex items-center mb-4">
          <div className="flex-shrink-0">
            <svg className="h-6 w-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-lg font-medium text-gray-900">
              セッション終了の警告
            </h3>
          </div>
        </div>
        
        <div className="mt-2">
          <p className="text-sm text-gray-500">
            5分間の操作がありませんでした。セッションを継続するには、このページの任意の場所をクリックしてください。
          </p>
        </div>
        
        <div className="mt-4 flex justify-end space-x-3">
          <button
            onClick={dismissLogoutWarning}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            セッション継続
          </button>
        </div>
      </div>
    </div>
  );
} 