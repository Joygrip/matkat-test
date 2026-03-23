/**
 * Compact filter toolbar used consistently across Admin tabs.
 */
import { Input, Button, Select, makeStyles, tokens } from '@fluentui/react-components';
import { SearchRegular, DismissRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalM,
    flexWrap: 'wrap',
  },
  search: {
    minWidth: '220px',
    flex: '1 1 220px',
    maxWidth: '360px',
  },
  filter: {
    minWidth: '160px',
  },
});

export interface FilterOption {
  value: string;
  label: string;
}

interface AdminToolbarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  filterOptions?: FilterOption[];
  filterPlaceholder?: string;
  onClear: () => void;
}

export function AdminToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  filterValue,
  onFilterChange,
  filterOptions,
  filterPlaceholder = 'All',
  onClear,
}: AdminToolbarProps) {
  const styles = useStyles();
  const hasActiveFilter = searchValue !== '' || (filterValue !== undefined && filterValue !== '');

  return (
    <div className={styles.toolbar}>
      <Input
        className={styles.search}
        contentBefore={<SearchRegular />}
        placeholder={searchPlaceholder}
        value={searchValue}
        onChange={(_, d) => onSearchChange(d.value)}
      />
      {filterOptions && onFilterChange && (
        <Select
          className={styles.filter}
          value={filterValue ?? ''}
          onChange={(_, d) => onFilterChange(d.value)}
        >
          <option value="">{filterPlaceholder}</option>
          {filterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
      )}
      {hasActiveFilter && (
        <Button
          appearance="subtle"
          icon={<DismissRegular />}
          onClick={onClear}
          title="Clear filters"
        >
          Clear
        </Button>
      )}
    </div>
  );
}
