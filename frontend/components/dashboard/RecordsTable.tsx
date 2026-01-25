'use client';

import { useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Pagination from '@/components/molecules/pagination';
import { RecordSummary, PaginationInfo } from '@/lib/types';
import {
  convertToArray,
  formatDate,
  parseDate,
  truncateFileId,
  truncateMemo,
} from '@/lib/utils';
import { recordsService } from '@/services/recordsService';
import { useAuth } from '@/contexts/AuthContext';
import RecordSkeletonRow from './RecordSkeletonRow';

type SortField = 'date' | 'fileId' | 'userName';
type SortOrder = 'asc' | 'desc';

interface RecordsTableProps {
  records: RecordSummary[];
  pagination: PaginationInfo | null;
  loading: boolean;
  currentPage: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  onSkillSheetEdit: (record: RecordSummary) => void;
  onSkillSheetDownload: (record: RecordSummary) => Promise<void>;
  onSalesforceEdit: (record: RecordSummary) => void;
  onSalesforceDownload: (record: RecordSummary) => Promise<void>;
  onSalesforceIconClick: (record: RecordSummary, type: 'skillSheet' | 'salesforce') => void;
  onLoREdit: (record: RecordSummary) => void;
  onLoRCopy: (record: RecordSummary) => Promise<void>;
  onSTTDownload: (record: RecordSummary) => Promise<void>;
  onBulkDownload: (record: RecordSummary) => Promise<void>;
  onDeleteClick: (record: RecordSummary) => void;
  onNotify?: (type: 'success' | 'error', message: string) => void;
  onRefetch?: () => void;
}

export default function RecordsTable({
  records,
  pagination,
  loading,
  currentPage,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onSkillSheetEdit,
  onSkillSheetDownload,
  onSalesforceEdit,
  onSalesforceDownload,
  onSalesforceIconClick,
  onLoREdit,
  onLoRCopy,
  onSTTDownload,
  onBulkDownload,
  onDeleteClick,
  onNotify,
  onRefetch,
}: RecordsTableProps) {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [sortIconDate, setSortIconDate] = useState<'↑' | '↓'>('↓');
  const [sortIconFileId, setSortIconFileId] = useState<'↑' | '↓'>('↓');
  const [sortIconUserName, setSortIconUserName] = useState<'↑' | '↓'>('↓');

  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);
  const [staffIdInput, setStaffIdInput] = useState('');
  const [editingStaffName, setEditingStaffName] = useState<number | null>(null);
  const [staffNameInput, setStaffNameInput] = useState('');
  const [editingMemo, setEditingMemo] = useState<number | null>(null);
  const [memoInput, setMemoInput] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const staffNameInputRef = useRef<HTMLInputElement | null>(null);
  const memoInputRef = useRef<HTMLInputElement | null>(null);

  const handleColumnSort = (field: SortField) => {
    const newOrder = field === sortField && sortOrder === 'desc' ? 'asc' : 'desc';
    setSortField(field);
    setSortOrder(newOrder);

    if (field === 'date') {
      setSortIconDate(newOrder === 'asc' ? '↑' : '↓');
      setSortIconFileId('↓');
      setSortIconUserName('↓');
    } else if (field === 'fileId') {
      setSortIconDate('↓');
      setSortIconFileId(newOrder === 'asc' ? '↑' : '↓');
      setSortIconUserName('↓');
    } else if (field === 'userName') {
      setSortIconDate('↓');
      setSortIconFileId('↓');
      setSortIconUserName(newOrder === 'asc' ? '↑' : '↓');
    }
  };

  const filteredRecords = records.filter(rec =>
    (rec.date || '').includes(searchTerm) ||
    (rec.fileId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (rec.staffId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (rec.userName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Client-side sorting for UI feedback (server already sorts by date DESC)
  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      if (sortField === 'date') {
        const dateA = parseDate(a.date);
        const dateB = parseDate(b.date);
        return sortOrder === 'desc' ? dateB - dateA : dateA - dateB;
      } else if (sortField === 'fileId') {
        const fileIdA = (a.fileId || '').toLowerCase();
        const fileIdB = (b.fileId || '').toLowerCase();
        return sortOrder === 'desc'
          ? fileIdB.localeCompare(fileIdA)
          : fileIdA.localeCompare(fileIdB);
      } else {
        const userA = (a.userName || '').toLowerCase();
        const userB = (b.userName || '').toLowerCase();
        return sortOrder === 'desc'
          ? userB.localeCompare(userA)
          : userA.localeCompare(userB);
      }
    });
  }, [filteredRecords, sortField, sortOrder]);

  const notify = (type: 'success' | 'error', message: string) => {
    onNotify?.(type, message);
  };

  const refetch = () => {
    onRefetch?.();
  };

  const handleEditStaffId = (id: number, currentStaffId: string) => {
    setEditingStaffId(id);
    setStaffIdInput(currentStaffId || '');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleStaffIdBlur = async (id: number) => {
    setEditingStaffId(null);
    const trimmedInput = staffIdInput?.trim() || '';
    if (!trimmedInput) return;
    try {
      await recordsService.updateStaffId(id, trimmedInput);
      notify('success', 'スタッフIDを更新しました。');
      refetch();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  const handleEditStaffName = (id: number, currentStaffName: string) => {
    setEditingStaffName(id);
    setStaffNameInput(currentStaffName || '');
    setTimeout(() => staffNameInputRef.current?.focus(), 0);
  };

  const handleStaffNameBlur = async (id: number) => {
    setEditingStaffName(null);
    const trimmedInput = staffNameInput?.trim() || '';
    if (!trimmedInput) return;
    try {
      await recordsService.updateStaffName(id, trimmedInput);
      notify('success', 'スタッフ名を更新しました。');
      refetch();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  const handleEditMemo = (id: number, currentMemo: string | null) => {
    setEditingMemo(id);
    setMemoInput(currentMemo || '');
    setTimeout(() => memoInputRef.current?.focus(), 0);
  };

  const handleMemoBlur = async (id: number) => {
    setEditingMemo(null);
    const trimmedInput = memoInput?.trim() || '';
    try {
      await recordsService.updateMemo(id, trimmedInput);
      notify('success', 'メモを更新しました。');
      refetch();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  const handleRowsPerPageChange = (rows: number) => {
    onRowsPerPageChange(rows);
    onPageChange(1); // Reset to first page when changing rows per page
  };

  return (
    <div className="bg-white rounded-[5px] shadow">
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-lg sm:text-xl font-semibold rounded-[5px]">Records</h2>
          <div className="flex items-center gap-4">
            <div className="text-green-500 text-sm rounded-[5px]">過去30日間のデータ</div>
            <div className="relative w-56">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Image
                  src="/search.svg"
                  alt="Search"
                  width={16}
                  height={16}
                  className="text-gray-400"
                />
              </div>
              <input
                type="text"
                placeholder="Search"
                className="pl-10 pr-4 py-2 rounded-[5px] border border-gray-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 text-gray-700 w-full shadow-sm"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-[5px] -mx-4 sm:-mx-6 lg:-mx-8">
          <div className="inline-block min-w-full align-middle max-w-[300px]">
            <table className="min-w-full text-left text-gray-700 rounded-[5px]">
              <thead>
                <tr className="border-b border-gray-200 text-xs text-gray-400 rounded-[5px]">
                  <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">Staff ID</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">Staff Name</th>
                  <th
                    className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px] cursor-pointer hover:bg-gray-50"
                    onClick={() => handleColumnSort('date')}
                  >
                    Date <span className="ml-1">{sortIconDate}</span>
                  </th>
                  <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">User</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">Memo</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[100px] max-w-[300px] rounded-[5px]">File</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[120px] max-w-[300px] rounded-[5px]">Skill Sheet</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[120px] max-w-[300px] rounded-[5px]">Salesforce</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[60px] max-w-[80px] rounded-[5px]">LoR</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[60px] max-w-[80px] rounded-[5px]">STT</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[60px] max-w-[80px] rounded-[5px]">Bulk</th>
                  <th className="py-3 px-4 font-medium text-center min-w-[60px] max-w-[80px] rounded-[5px]"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: rowsPerPage || 10 }).map((_, index) => (
                    <RecordSkeletonRow key={`skeleton-${index}`} />
                  ))
                ) : sortedRecords.length === 0 ? (
                  <tr><td colSpan={12} className="text-center py-8">No records found</td></tr>
                ) : (
                  sortedRecords.map((rec) => (
                    <tr key={rec.id} className="border-b border-gray-100 hover:bg-gray-50 transition text-left align-middle rounded-[5px]">
                      {/* Staff ID */}
                      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                        <div className="flex items-center gap-x-2 rounded-[5px] truncate">
                          {editingStaffId === rec.id ? (
                            <input
                              ref={inputRef}
                              value={staffIdInput}
                              onChange={e => setStaffIdInput(e.target.value)}
                              onBlur={() => handleStaffIdBlur(rec.id)}
                              className="border border-gray-300 rounded-[5px] px-2 py-1 w-20 text-center"
                            />
                          ) : (
                            <>
                              <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Edit Staff ID" onClick={() => handleEditStaffId(rec.id, rec.staffId)}>
                                <Image src="/edit1.svg" alt="Edit Staff ID" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <span className="truncate">{rec.staffId}</span>
                            </>
                          )}
                        </div>
                      </td>
                      {/* Staff Name */}
                      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                        <div className="flex items-center gap-x-2 rounded-[5px] truncate">
                          {editingStaffName === rec.id ? (
                            <input
                              ref={staffNameInputRef}
                              value={staffNameInput}
                              onChange={e => setStaffNameInput(e.target.value)}
                              onBlur={() => handleStaffNameBlur(rec.id)}
                              className="border border-gray-300 rounded-[5px] px-2 py-1 text-center"
                            />
                          ) : (
                            <>
                              <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Edit Staff Name" onClick={() => handleEditStaffName(rec.id, rec.staffName || '')}>
                                <Image src="/edit1.svg" alt="Edit Staff Name" width={20} height={20} className="rounded-[5px]" />
                              </button>
                              <span className="truncate">{rec.staffName || ''}</span>
                            </>
                          )}
                        </div>
                      </td>
                      {/* Date */}
                      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px] truncate">{formatDate(rec.date)}</td>
                      {/* User */}
                      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px] truncate">{rec.userName || ''}</td>
                      {/* Memo */}
                      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px]">
                        {editingMemo === rec.id ? (
                          <input
                            ref={memoInputRef}
                            value={memoInput}
                            onChange={e => setMemoInput(e.target.value)}
                            onBlur={() => handleMemoBlur(rec.id)}
                            className="border border-gray-300 rounded-[5px] px-2 py-1 w-full"
                          />
                        ) : (
                          <div className="flex items-center gap-x-2">
                            <button className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center flex-shrink-0" title="Edit Memo" onClick={() => handleEditMemo(rec.id, rec.memo || null)}>
                              <Image src="/edit1.svg" alt="Edit Memo" width={20} height={20} className="rounded-[5px]" />
                            </button>
                            <span
                              className="truncate"
                              title={rec.memo || ''}
                            >
                              {truncateMemo(rec.memo)}
                            </span>
                          </div>
                        )}
                      </td>
                      {/* File ID */}
                      <td className="py-5 px-4 whitespace-nowrap align-middle min-w-[100px] max-w-[300px] rounded-[5px] truncate" title={rec.fileId}>
                        {truncateFileId(rec.fileId)}
                      </td>
                      {/* Skill Sheet icons */}
                      <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
                        <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Edit"
                            onClick={() => onSkillSheetEdit(rec)}
                          >
                            <Image src="/edit1.svg" alt="Edit" width={20} height={20} className="rounded-[5px]" />
                          </button>
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Download"
                            onClick={() => onSkillSheetDownload(rec)}
                          >
                            <Image src="/download1.svg" alt="Download" width={20} height={20} className="rounded-[5px]" />
                          </button>
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Salesforce"
                            onClick={() => onSalesforceIconClick(rec, 'skillSheet')}
                          >
                            <Image src="/salesforce1.svg" alt="Salesforce" width={20} height={20} className="rounded-[5px]" />
                          </button>
                        </div>
                      </td>
                      {/* Salesforce icons */}
                      <td className="py-5 px-4 align-middle min-w-[120px] max-w-[300px] rounded-[5px]">
                        <div className="flex items-center justify-center gap-x-3 rounded-[5px]">
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Edit"
                            onClick={() => onSalesforceEdit(rec)}
                          >
                            <Image src="/edit1.svg" alt="Edit" width={20} height={20} className="rounded-[5px]" />
                          </button>
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Download"
                            onClick={() => onSalesforceDownload(rec)}
                          >
                            <Image src="/download1.svg" alt="Download" width={20} height={20} className="rounded-[5px]" />
                          </button>
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Salesforce"
                            onClick={() => onSalesforceIconClick(rec, 'salesforce')}
                          >
                            <Image src="/salesforce1.svg" alt="Salesforce" width={20} height={20} className="rounded-[5px]" />
                          </button>
                        </div>
                      </td>
                      {/* LoR icons */}
                      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
                        <div className="flex items-center justify-center rounded-[5px] gap-x-2">
                          <button
                            onClick={() => onLoREdit(rec)}
                            className="text-blue-600 hover:text-blue-800 transition-colors"
                            title="編集"
                          >
                            <Image src="/edit1.svg" alt="Edit" width={16} height={16} className="rounded-[5px]" />
                          </button>
                          <button
                            onClick={() => onLoRCopy(rec)}
                            title="Copy"
                          >
                            <Image src="/copy1.svg" alt="copy" width={16} height={16} className="rounded-[5px]" />
                          </button>
                        </div>
                      </td>
                      {/* STT icons */}
                      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
                        <div className="flex items-center justify-center rounded-[5px]">
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Download"
                            onClick={() => onSTTDownload(rec)}
                          >
                            <Image src="/download1.svg" alt="download" width={16} height={16} className="rounded-[5px]" />
                          </button>
                        </div>
                      </td>
                      {/* Bulk icons */}
                      <td className="py-5 px-2 align-middle min-w-[60px] max-w-[80px] rounded-[5px]">
                        <div className="flex items-center justify-center rounded-[5px]">
                          <button
                            className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0"
                            title="Download"
                            onClick={() => onBulkDownload(rec)}
                          >
                            <Image src="/download1.svg" alt="download" width={16} height={16} className="rounded-[5px]" />
                          </button>
                        </div>
                      </td>
                      {/* Delete button */}
                      <td className="py-5 px-2 align-middle min-w/[60px] max-w/[80px] rounded-[5px]">
                        <div className="flex items-center justify-center rounded-[5px]">
                          {/* For members: only show delete button if they own the record */}
                          {/* For other roles: show delete button */}
                          {user?.role === 'member' ? (
                            rec.ownerId === user.id ? (
                              <button
                                className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0 text-gray-500 hover:text-gray-700"
                                title="Delete"
                                onClick={() => onDeleteClick(rec)}
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            ) : null
                          ) : (
                            <button
                              className="hover:scale-110 transition rounded-[5px] w-5 h-5 flex items-center justify-center flex-shrink-0 text-gray-500 hover:text-gray-700"
                              title="Delete"
                              onClick={() => onDeleteClick(rec)}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <Pagination
        totalItems={pagination?.total || 0}
        currentPage={currentPage}
        rowsPerPage={rowsPerPage}
        onPageChange={onPageChange}
        onRowsPerPageChange={handleRowsPerPageChange}
      />
    </div>
  );
}
