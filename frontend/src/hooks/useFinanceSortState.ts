import { useState, useCallback } from 'react';

export interface FinanceSortState {
  sortKey: string;
  sortAsc: boolean;
  handleSort: (key: string) => void;
  sortIndicator: (key: string) => string;
  comparator: <T extends Record<string, unknown>>(a: T, b: T) => number;
}

export function useFinanceSortState(defaultKey = '', defaultAsc = true): FinanceSortState {
  const [sortKey, setSortKey] = useState<string>(defaultKey);
  const [sortAsc, setSortAsc] = useState<boolean>(defaultAsc);

  const handleSort = useCallback((key: string) => {
    setSortKey(prev => {
      if (prev === key) {
        setSortAsc(a => !a);
        return prev;
      }
      setSortAsc(true);
      return key;
    });
  }, []);

  const sortIndicator = useCallback((key: string): string => {
    if (sortKey !== key) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  }, [sortKey, sortAsc]);

  const comparator = useCallback(<T extends Record<string, unknown>>(a: T, b: T): number => {
    if (!sortKey) return 0;
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return ((aVal as string | number) > (bVal as string | number) ? 1 : -1) * (sortAsc ? 1 : -1);
  }, [sortKey, sortAsc]);

  return { sortKey, sortAsc, handleSort, sortIndicator, comparator };
}
