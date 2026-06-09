/**
 * Shared Period Context
 *
 * Provides the period list and the currently selected period to the entire app.
 * The AppShell header dropdown controls the selection; all pages consume it.
 */
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { periodsApi, Period } from '../api/periods';
import { getEarliestOpenPeriod } from '../utils/periodUtils';

interface PeriodContextValue {
  periods: Period[];
  selectedPeriodId: string;
  setSelectedPeriodId: (id: string) => void;
  /** The full Period object for the selected ID (undefined while loading or if not found) */
  selectedPeriod: Period | undefined;
  loading: boolean;
  refreshPeriods: () => void;
}

const PeriodContext = createContext<PeriodContextValue | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [loading, setLoading] = useState(true);

  const loadPeriods = () => {
    periodsApi
      .list()
      .then((data) => {
        setPeriods(data);
        if (data.length > 0 && !selectedPeriodId) {
          const earliest = getEarliestOpenPeriod(data);
          setSelectedPeriodId(earliest?.id || data[0].id);
        }
      })
      .catch((err) => {
        console.error('PeriodProvider: failed to load periods', err);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadPeriods();
  }, []);

  const selectedPeriod = periods.find((p) => p.id === selectedPeriodId);

  return (
    <PeriodContext.Provider
      value={{ periods, selectedPeriodId, setSelectedPeriodId, selectedPeriod, loading, refreshPeriods: loadPeriods }}
    >
      {children}
    </PeriodContext.Provider>
  );
}

export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) {
    throw new Error('usePeriod must be used within a PeriodProvider');
  }
  return ctx;
}
