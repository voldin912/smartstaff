import { useState, useEffect, useCallback } from 'react';
import { apiRequest, handleApiError } from '@/lib/api';
import { Record } from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

export const useRecords = () => {
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<Record[]>(`${API_URL}/api/records`);
      setRecords(data);
    } catch (err) {
      const errorMessage = handleApiError(err, 'レコードの取得に失敗しました。');
      setError(errorMessage);
      console.error('Error fetching records:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return {
    records,
    loading,
    error,
    refetch: fetchRecords,
    setRecords,
  };
};
