import { useState, useCallback } from 'react';

export type WorkQueueSortDir = 'asc' | 'desc';

export interface WorkQueueSortState<K extends string> {
  sort: K;
  sortDir: WorkQueueSortDir;
  handleSortClick: (key: K) => void;
  sortItems: <T>(items: T[], getter: (item: T, key: K) => string | number | null) => T[];
}

export function useWorkQueueSort<K extends string>(
  defaultSort: K,
  defaultDir: WorkQueueSortDir = 'desc',
): WorkQueueSortState<K> {
  const [sort, setSort] = useState<K>(defaultSort);
  const [sortDir, setSortDir] = useState<WorkQueueSortDir>(defaultDir);

  const handleSortClick = useCallback((key: K) => {
    setSort(prev => {
      if (prev === key) {
        setSortDir(d => (d === 'desc' ? 'asc' : 'desc'));
        return prev;
      }
      setSortDir('desc');
      return key;
    });
  }, []);

  const sortItems = useCallback(<T>(
    items: T[],
    getter: (item: T, key: K) => string | number | null,
  ): T[] => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...items].sort((a, b) => {
      const aVal = getter(a, sort);
      const bVal = getter(b, sort);
      if (aVal === bVal) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return aVal.localeCompare(bVal) * dir;
      }
      return ((aVal as number) - (bVal as number)) * dir;
    });
  }, [sort, sortDir]);

  return { sort, sortDir, handleSortClick, sortItems };
}
