import { useState, useEffect } from 'react';
import { getEmployeeStats, EmployeeStats } from '../api/finance';

export function useEmployeeStats(
  year: number,
  month: number,
  costCenterId?: string,
  projectId?: string
) {
  const [data, setData] = useState<EmployeeStats[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getEmployeeStats(year, month, costCenterId, projectId)
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load employee stats'))
      .finally(() => setLoading(false));
  }, [year, month, costCenterId, projectId]);

  return { data, loading, error };
}
