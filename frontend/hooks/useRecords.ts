import { useState, useEffect, useCallback } from 'react';
import { recordsService } from '@/services/recordsService';
import { Record, PaginationInfo } from '@/lib/types';

export const useRecords = (currentPage: number = 1, rowsPerPage: number = 10) => {
  const [records, setRecords] = useState<Record[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async (page?: number, limit?: number) => {
    setLoading(true);
    setError(null);
    try {
      const pageToFetch = page ?? currentPage;
      const limitToFetch = limit ?? rowsPerPage;
      const offset = (pageToFetch - 1) * limitToFetch;
      
      const response = await recordsService.getRecords(limitToFetch, offset);
      setRecords(response.records);
      setPagination(response.pagination);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'レコードの取得に失敗しました。';
      setError(errorMessage);
      console.error('Error fetching records:', err);
    } finally {
      setLoading(false);
    }
  }, [currentPage, rowsPerPage]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return {
    records,
    pagination,
    loading,
    error,
    refetch: fetchRecords,
    setRecords,
  };
};
