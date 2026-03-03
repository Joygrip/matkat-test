import { useState, useEffect } from 'react';
import { getEmployeeStats, EmployeeStats } from '../api/finance';

export function useEmployeeStats(
  year: number,
  month: number,
  costCenterId?: string,
  projectId?: string,
  enabled = true
) {
  const [data, setData] = useState<EmployeeStats[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || year < 2000 || month < 1 || month > 12) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getEmployeeStats(year, month, costCenterId, projectId)
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load employee stats'))
      .finally(() => setLoading(false));
  }, [enabled, year, month, costCenterId, projectId]);

  return { data, loading, error };
}
