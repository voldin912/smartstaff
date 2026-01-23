import { useState, useEffect, useCallback } from 'react';
import { recordsService } from '@/services/recordsService';
import { Record, PaginationInfo } from '@/lib/types';

export const useRecords = (limit: number = 50, offset: number = 0) => {
  const [records, setRecords] = useState<Record[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async (pageLimit?: number, pageOffset?: number) => {
    setLoading(true);
    setError(null);
    try {
      const currentLimit = pageLimit ?? limit;
      const currentOffset = pageOffset ?? offset;
      const response = await recordsService.getRecords(currentLimit, currentOffset);
      setRecords(response.records);
      setPagination(response.pagination);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'レコードの取得に失敗しました。';
      setError(errorMessage);
      console.error('Error fetching records:', err);
    } finally {
      setLoading(false);
    }
  }, [limit, offset]);

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
