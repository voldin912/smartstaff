import { useState, useEffect, useCallback, useRef } from 'react';
import { recordsService } from '@/services/recordsService';
import { Record } from '@/lib/types';

export const useRecordDetail = (recordId: number | null) => {
  const [record, setRecord] = useState<Record | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previousRecordIdRef = useRef<number | null>(null);

  const fetchRecordDetail = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await recordsService.getRecordDetail(id);
      setRecord(detail);
      previousRecordIdRef.current = id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'レコード詳細の取得に失敗しました。';
      setError(errorMessage);
      console.error('Error fetching record detail:', err);
      setRecord(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (recordId !== null && recordId > 0) {
      // Always refetch if recordId changed (including when it changes from null to a value)
      if (previousRecordIdRef.current !== recordId) {
        fetchRecordDetail(recordId);
      }
    } else {
      setRecord(null);
      setError(null);
      setLoading(false);
      previousRecordIdRef.current = null;
    }
  }, [recordId, fetchRecordDetail]);

  return {
    record,
    loading,
    error,
    refetch: fetchRecordDetail,
  };
};
