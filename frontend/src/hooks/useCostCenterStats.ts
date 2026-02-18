import { useState, useEffect } from 'react';
import { getCostCenterStats, CostCenterStats } from '../api/finance';

export function useCostCenterStats(year: number, month: number, departmentId?: string) {
  const [data, setData] = useState<CostCenterStats[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCostCenterStats(year, month, departmentId)
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load stats'))
      .finally(() => setLoading(false));
  }, [year, month, departmentId]);

  return { data, loading, error };
}
