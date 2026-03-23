import { Button, makeStyles, tokens } from '@fluentui/react-components';
import type { WorkQueueSortDir } from '../../hooks/useWorkQueueSort';

export interface SortOption<K extends string = string> {
  key: K;
  label: string;
}

export interface FinanceSortBarProps<K extends string = string> {
  options: SortOption<K>[];
  sortKey: K;
  sortDir: WorkQueueSortDir;
  onSort: (key: K) => void;
  className?: string;
}

const useStyles = makeStyles({
  bar: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
});

export function FinanceSortBar<K extends string,>({
  options,
  sortKey,
  sortDir,
  onSort,
  className,
}: FinanceSortBarProps<K>) {
  const styles = useStyles();
  return (
    <div className={`${styles.bar}${className ? ` ${className}` : ''}`}>
      {options.map(opt => {
        const isActive = sortKey === opt.key;
        const dir = isActive ? (sortDir === 'desc' ? ' \u25BC' : ' \u25B2') : '';
        return (
          <Button
            key={opt.key}
            size="small"
            appearance={isActive ? 'primary' : 'subtle'}
            onClick={() => onSort(opt.key)}
          >
            {opt.label}{dir}
          </Button>
        );
      })}
    </div>
  );
}
