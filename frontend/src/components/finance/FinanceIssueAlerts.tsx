import { makeStyles, tokens, MessageBar, MessageBarBody, Button } from '@fluentui/react-components';
import { Warning24Regular, ErrorCircle24Regular, PersonAlert24Regular } from '@fluentui/react-icons';

export type IssueFilter = 'none' | 'orphans' | 'overalloc' | 'understaffed';

export interface FinanceIssueAlertsProps {
  orphansCount: number;
  overAllocsCount: number;
  understaffedCount: number;
  activeFilter: IssueFilter;
  onFilterChange: (filter: IssueFilter) => void;
}

const useStyles = makeStyles({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    marginBottom: tokens.spacingVerticalL,
  },
  alertRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
  },
  alertBar: {
    flex: 1,
  },
});

export function FinanceIssueAlerts({
  orphansCount,
  overAllocsCount,
  understaffedCount,
  activeFilter,
  onFilterChange,
}: FinanceIssueAlertsProps) {
  const styles = useStyles();

  if (orphansCount === 0 && overAllocsCount === 0 && understaffedCount === 0) return null;

  return (
    <div className={styles.wrapper}>
      {orphansCount > 0 && (
        <div className={styles.alertRow}>
          <MessageBar
            intent="warning"
            className={styles.alertBar}
            icon={<Warning24Regular />}
          >
            <MessageBarBody>
              <strong>{orphansCount}</strong> orphan demand{orphansCount !== 1 ? 's' : ''} — demands with no supply assignment.
            </MessageBarBody>
          </MessageBar>
          <Button
            size="small"
            appearance={activeFilter === 'orphans' ? 'primary' : 'outline'}
            onClick={() => onFilterChange(activeFilter === 'orphans' ? 'none' : 'orphans')}
          >
            {activeFilter === 'orphans' ? 'Clear filter' : 'Filter list'}
          </Button>
        </div>
      )}
      {overAllocsCount > 0 && (
        <div className={styles.alertRow}>
          <MessageBar
            intent="error"
            className={styles.alertBar}
            icon={<ErrorCircle24Regular />}
          >
            <MessageBarBody>
              <strong>{overAllocsCount}</strong> over-allocation{overAllocsCount !== 1 ? 's' : ''} — resources allocated beyond 100%.
            </MessageBarBody>
          </MessageBar>
          <Button
            size="small"
            appearance={activeFilter === 'overalloc' ? 'primary' : 'outline'}
            onClick={() => onFilterChange(activeFilter === 'overalloc' ? 'none' : 'overalloc')}
          >
            {activeFilter === 'overalloc' ? 'Clear filter' : 'Filter list'}
          </Button>
        </div>
      )}
      {understaffedCount > 0 && (
        <div className={styles.alertRow}>
          <MessageBar
            intent="warning"
            className={styles.alertBar}
            icon={<PersonAlert24Regular />}
          >
            <MessageBarBody>
              <strong>{understaffedCount}</strong> understaffed resource{understaffedCount !== 1 ? 's' : ''} — demand exceeds supply.
            </MessageBarBody>
          </MessageBar>
          <Button
            size="small"
            appearance={activeFilter === 'understaffed' ? 'primary' : 'outline'}
            onClick={() => onFilterChange(activeFilter === 'understaffed' ? 'none' : 'understaffed')}
          >
            {activeFilter === 'understaffed' ? 'Clear filter' : 'Filter list'}
          </Button>
        </div>
      )}
    </div>
  );
}
