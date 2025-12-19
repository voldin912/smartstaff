import { useState } from 'react';

interface PaginationProps {
  totalItems: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  rowsPerPage: number;
}

export default function Pagination({
  totalItems,
  currentPage,
  onPageChange,
  onRowsPerPageChange,
  rowsPerPage
}: PaginationProps) {
  const totalPages = Math.ceil(totalItems / rowsPerPage);
  const rowsPerPageOptions = [10, 20, 50, 100];

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  const renderPageNumbers = () => {
    const pageNumbers = [];
    const maxVisiblePages = 3;

    if (totalPages <= maxVisiblePages) {
      // Show all pages if total pages is less than or equal to maxVisiblePages
      for (let i = 1; i <= totalPages; i++) {
        pageNumbers.push(i);
      }
    } else {
      // Always show first page
      pageNumbers.push(1);

      if (currentPage > 2) {
        pageNumbers.push('...');
      }

      // Show current page and one page before and after
      for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
        if (!pageNumbers.includes(i)) {
          pageNumbers.push(i);
        }
      }

      if (currentPage < totalPages - 1) {
        pageNumbers.push('...');
      }

      // Always show last page
      if (!pageNumbers.includes(totalPages)) {
        pageNumbers.push(totalPages);
      }
    }

    return pageNumbers;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-4 py-3 bg-white border-t border-gray-200 sm:px-6">
      <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-sm text-gray-700 whitespace-nowrap">表示件数:</span>
          <select
            value={rowsPerPage}
            onChange={(e) => onRowsPerPageChange(Number(e.target.value))}
            className="block w-20 py-1.5 pl-3 text-sm border border-gray-300 rounded-[5px] focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
          >
            {rowsPerPageOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-700 whitespace-nowrap text-center sm:text-left">
          {((currentPage - 1) * rowsPerPage) + 1} から {Math.min(currentPage * rowsPerPage, totalItems)} まで表示 / 全 {totalItems} 件
        </span>
      </div>
      <div className="flex items-center gap-1 sm:gap-2 w-full sm:w-auto justify-center sm:justify-end">
        <button
          onClick={handlePreviousPage}
          disabled={currentPage === 1}
          className={`relative inline-flex items-center px-2 sm:px-3 py-2 text-sm font-medium rounded-[5px] border ${
            currentPage === 1
              ? 'text-gray-400 border-gray-200 cursor-not-allowed'
              : 'text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          前へ
        </button>
        <div className="flex items-center gap-0.5 sm:gap-1">
          {renderPageNumbers().map((page, index) => (
            page === '...' ? (
              <span
                key={`ellipsis-${index}`}
                className="px-2 sm:px-4 py-2 text-sm text-gray-700"
              >
                ...
              </span>
            ) : (
              <button
                key={page}
                onClick={() => onPageChange(Number(page))}
                className={`relative inline-flex items-center px-2 sm:px-4 py-2 text-sm font-medium rounded-[5px] border ${
                  currentPage === page
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {page}
              </button>
            )
          ))}
        </div>
        <button
          onClick={handleNextPage}
          disabled={currentPage === totalPages}
          className={`relative inline-flex items-center px-2 sm:px-3 py-2 text-sm font-medium rounded-[5px] border ${
            currentPage === totalPages
              ? 'text-gray-400 border-gray-200 cursor-not-allowed'
              : 'text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          次へ
        </button>
      </div>
    </div>
  );
}
