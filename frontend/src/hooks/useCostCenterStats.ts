import { useState, useEffect } from 'react';
import { getCostCenterStats, CostCenterStats } from '../api/finance';

export function useCostCenterStats(year: number, month: number, costCenterId?: string) {
  const [data, setData] = useState<CostCenterStats[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getCostCenterStats(year, month, costCenterId)
      .then(setData)
      .catch(e => setError(e.message || 'Failed to load stats'))
      .finally(() => setLoading(false));
  }, [year, month, costCenterId]);

  return { data, loading, error };
}
