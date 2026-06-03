/**
 * Period management panel — renders inside the Finance Operations page.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Body1,
  Button,
  Badge,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Spinner,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Input,
  Label,
  makeStyles,
  tokens,
  Text,
} from '@fluentui/react-components';
import {
  LockClosedRegular,
  LockOpenRegular,
  AddRegular,
} from '@fluentui/react-icons';
import { Period } from '../types';
import { periodsApi } from '../api/periods';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../auth/AuthProvider';
import { usePeriod } from '../contexts/PeriodContext';
import { MONTH_NAMES } from '../utils/format';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
  },
  topBar: {
    display: 'flex',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  yearTabsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
    paddingBottom: tokens.spacingVerticalS,
  },
  tableWrap: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
    '& th': {
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
      fontWeight: tokens.fontWeightSemibold,
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    },
    '& td': {
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      verticalAlign: 'middle',
    },
    '& tbody tr:last-child td': {
      borderBottom: 'none',
    },
  },
  monthName: {
    fontWeight: tokens.fontWeightSemibold,
  },
  statusBadge: {
    minWidth: '72px',
    justifyContent: 'center',
  },
  dialogField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  rangeRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
  },
  rangeField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    flex: 1,
  },
  previewBox: {
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    padding: tokens.spacingHorizontalM,
    maxHeight: '160px',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground2,
  },
  previewItem: {
    fontSize: tokens.fontSizeBase200,
    padding: `2px 0`,
    color: tokens.colorNeutralForeground2,
  },
  previewItemExists: {
    fontSize: tokens.fontSizeBase200,
    padding: `2px 0`,
    color: tokens.colorNeutralForeground3,
    textDecoration: 'line-through',
  },
  nativeSelect: {
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: tokens.fontSizeBase300,
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground1,
  },
});

interface PeriodPanelProps {
  variant?: 'card' | 'embedded' | 'compact';
}

export function PeriodPanel({ variant: _variant = 'card' }: PeriodPanelProps) {
  const styles = useStyles();
  const { showSuccess, showApiError } = useToast();
  const { user } = useAuth();
  const { refreshPeriods: refreshContextPeriods } = usePeriod();

  const currentYear = new Date().getFullYear();

  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Year tab state
  const [manualYears, setManualYears] = useState<Set<number>>(new Set());
  const [activeYear, setActiveYear] = useState<number>(currentYear);

  // Lock dialog state
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [periodToLock, setPeriodToLock] = useState<Period | null>(null);

  // Unlock dialog state
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [unlockReason, setUnlockReason] = useState('');

  // Bulk create dialog state
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkYear, setBulkYear] = useState(currentYear);
  const [bulkFromMonth, setBulkFromMonth] = useState(1);
  const [bulkToMonth, setBulkToMonth] = useState(12);
  const [bulkCreating, setBulkCreating] = useState(false);

  const isFinanceOrAdmin = user?.role === 'Finance' || user?.role === 'Admin';

  useEffect(() => {
    loadPeriods();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPeriods = async () => {
    setLoading(true);
    try {
      const data = await periodsApi.list();
      setPeriods(data);
    } catch (error) {
      showApiError(error as Error, 'Failed to load periods');
    } finally {
      setLoading(false);
    }
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear]);
    periods.forEach(p => years.add(p.year));
    manualYears.forEach(y => years.add(y));
    return [...years].sort((a, b) => a - b);
  }, [periods, manualYears, currentYear]);

  const maxAvailableYear = availableYears[availableYears.length - 1] ?? currentYear;

  const existingSet = useMemo(
    () => new Set(periods.map(p => `${p.year}-${p.month}`)),
    [periods],
  );

  const periodMap = useMemo(() => {
    const map = new Map<string, Period>();
    periods.forEach(p => map.set(`${p.year}-${p.month}`, p));
    return map;
  }, [periods]);

  // Bulk preview — only within selected year, month range
  const bulkPreviewItems = useMemo(() => {
    if (bulkFromMonth > bulkToMonth) return [];
    return Array.from({ length: bulkToMonth - bulkFromMonth + 1 }, (_, i) => {
      const month = bulkFromMonth + i;
      return { year: bulkYear, month, exists: existingSet.has(`${bulkYear}-${month}`) };
    });
  }, [bulkYear, bulkFromMonth, bulkToMonth, existingSet]);

  const toCreateCount = bulkPreviewItems.filter(p => !p.exists).length;

  const bulkYearOptions = useMemo(() => {
    const years = new Set(availableYears);
    years.add(maxAvailableYear + 1);
    return [...years].sort((a, b) => a - b);
  }, [availableYears, maxAvailableYear]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleAddYear = () => {
    const nextYear = maxAvailableYear + 1;
    setManualYears(prev => new Set([...prev, nextYear]));
    setActiveYear(nextYear);
  };

  const openBulkDialog = (year?: number, fromMonth?: number, toMonth?: number) => {
    setBulkYear(year ?? activeYear);
    setBulkFromMonth(fromMonth ?? 1);
    setBulkToMonth(toMonth ?? 12);
    setBulkDialogOpen(true);
  };

  const handleLockClick = (period: Period) => {
    setPeriodToLock(period);
    setLockConfirmOpen(true);
  };

  const handleLockConfirm = async () => {
    if (!periodToLock) return;
    setLockConfirmOpen(false);
    setActionLoading(periodToLock.id);
    try {
      await periodsApi.lock(periodToLock.id);
      showSuccess('Period Locked', `${MONTH_NAMES[periodToLock.month - 1]} ${periodToLock.year} has been locked.`);
      loadPeriods();
      refreshContextPeriods();
    } catch (error) {
      showApiError(error as Error, 'Failed to lock period');
    } finally {
      setActionLoading(null);
      setPeriodToLock(null);
    }
  };

  const handleUnlockClick = (period: Period) => {
    setSelectedPeriod(period);
    setUnlockReason('');
    setUnlockDialogOpen(true);
  };

  const handleUnlockConfirm = async () => {
    if (!selectedPeriod || !unlockReason.trim()) return;
    setActionLoading(selectedPeriod.id);
    setUnlockDialogOpen(false);
    try {
      await periodsApi.unlock(selectedPeriod.id, unlockReason);
      showSuccess('Period Unlocked', `${MONTH_NAMES[selectedPeriod.month - 1]} ${selectedPeriod.year} has been unlocked.`);
      loadPeriods();
      refreshContextPeriods();
    } catch (error) {
      showApiError(error as Error, 'Failed to unlock period');
    } finally {
      setActionLoading(null);
      setSelectedPeriod(null);
    }
  };

  const handleBulkCreate = async () => {
    setBulkCreating(true);
    let created = 0;
    for (const { year, month, exists } of bulkPreviewItems) {
      if (exists) continue;
      try {
        await periodsApi.create(year, month);
        created++;
      } catch (error) {
        showApiError(error as Error, `Failed to create ${MONTH_NAMES[month - 1]} ${year}`);
      }
    }
    setBulkCreating(false);
    setBulkDialogOpen(false);
    if (created > 0) {
      showSuccess('Periods Created', `${created} period${created !== 1 ? 's' : ''} created successfully.`);
      loadPeriods();
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <Spinner label="Loading periods..." />;
  }

  return (
    <div className={styles.root}>

      {/* "+ Create Periods" button */}
      {isFinanceOrAdmin && (
        <div className={styles.topBar}>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={() => openBulkDialog()}
          >
            Create Periods
          </Button>
        </div>
      )}

      {/* Year tabs */}
      <div className={styles.yearTabsRow}>
        {availableYears.map(year => (
          <button
            key={year}
            onClick={() => setActiveYear(year)}
            style={{
              padding: '6px 18px',
              borderRadius: '20px',
              border: activeYear === year
                ? `2px solid ${tokens.colorBrandBackground}`
                : `1px solid ${tokens.colorNeutralStroke1}`,
              cursor: 'pointer',
              fontSize: tokens.fontSizeBase300,
              fontWeight: activeYear === year
                ? tokens.fontWeightSemibold
                : tokens.fontWeightRegular,
              backgroundColor: activeYear === year
                ? tokens.colorBrandBackground
                : tokens.colorNeutralBackground1,
              color: activeYear === year
                ? tokens.colorNeutralForegroundOnBrand
                : tokens.colorNeutralForeground1,
              lineHeight: 1.4,
            }}
          >
            {year}
          </button>
        ))}
        <button
          onClick={handleAddYear}
          style={{
            padding: '5px 12px',
            borderRadius: '20px',
            border: `1px dashed ${tokens.colorNeutralStroke1}`,
            cursor: 'pointer',
            fontSize: tokens.fontSizeBase200,
            fontWeight: tokens.fontWeightRegular,
            backgroundColor: 'transparent',
            color: tokens.colorNeutralForeground3,
            lineHeight: 1.4,
          }}
        >
          + Add Year
        </button>
      </div>

      {/* Compact month table for the active year */}
      <div className={styles.tableWrap}>
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Month</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 12 }, (_, i) => i + 1).map(month => {
              const period = periodMap.get(`${activeYear}-${month}`);
              const isOpen = period?.status === 'open';
              const isLocked = period?.status === 'locked';

              return (
                <TableRow key={month}>
                  <TableCell>
                    <Text className={styles.monthName}>{MONTH_NAMES[month - 1]}</Text>
                  </TableCell>
                  <TableCell>
                    {period ? (
                      <Badge
                        appearance="filled"
                        color={isLocked ? 'danger' : 'success'}
                        size="small"
                        className={styles.statusBadge}
                      >
                        {isLocked ? 'Locked' : 'Open'}
                      </Badge>
                    ) : (
                      <Badge appearance="tint" color="informative" size="small" className={styles.statusBadge}>
                        Not Created
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {isFinanceOrAdmin ? (
                      period ? (
                        isOpen ? (
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<LockClosedRegular />}
                            onClick={() => handleLockClick(period)}
                            disabled={actionLoading === period.id}
                          >
                            Lock
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<LockOpenRegular />}
                            onClick={() => handleUnlockClick(period)}
                            disabled={actionLoading === period.id}
                          >
                            Unlock
                          </Button>
                        )
                      ) : (
                        <Button
                          size="small"
                          appearance="subtle"
                          icon={<AddRegular />}
                          onClick={() => openBulkDialog(activeYear, month, month)}
                        >
                          Create
                        </Button>
                      )
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Lock Confirmation Dialog */}
      <Dialog
        open={lockConfirmOpen}
        onOpenChange={(_, data) => {
          setLockConfirmOpen(data.open);
          if (!data.open) setPeriodToLock(null);
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Lock Period</DialogTitle>
            <DialogContent>
              <Body1 style={{ marginBottom: tokens.spacingVerticalM }}>
                Locking{' '}
                <strong>
                  {periodToLock && `${MONTH_NAMES[periodToLock.month - 1]} ${periodToLock.year}`}
                </strong>
                {' '}will prevent further edits to planning data for this period. Continue?
              </Body1>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setLockConfirmOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleLockConfirm}>Lock Period</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Unlock Dialog */}
      <Dialog open={unlockDialogOpen} onOpenChange={(_, data) => setUnlockDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Unlock Period</DialogTitle>
            <DialogContent>
              <Body1 style={{ marginBottom: tokens.spacingVerticalM }}>
                You are about to unlock{' '}
                <strong>
                  {selectedPeriod && `${MONTH_NAMES[selectedPeriod.month - 1]} ${selectedPeriod.year}`}
                </strong>
                . Please provide a reason.
              </Body1>
              <div className={styles.dialogField}>
                <Label required htmlFor="unlock-reason">Reason for unlocking</Label>
                <Input
                  id="unlock-reason"
                  value={unlockReason}
                  onChange={(_, data) => setUnlockReason(data.value)}
                  placeholder="e.g., Need to correct actuals for Project X"
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setUnlockDialogOpen(false)}>Cancel</Button>
              <Button
                appearance="primary"
                onClick={handleUnlockConfirm}
                disabled={!unlockReason.trim()}
              >
                Unlock Period
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Bulk Create Periods Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={(_, data) => setBulkDialogOpen(data.open)}>
        <DialogSurface style={{ minWidth: 440 }}>
          <DialogBody>
            <DialogTitle>Create Periods</DialogTitle>
            <DialogContent>

              {/* Year selector */}
              <div className={styles.dialogField}>
                <Label htmlFor="bulk-year">Year</Label>
                <select
                  id="bulk-year"
                  className={styles.nativeSelect}
                  value={bulkYear}
                  onChange={e => setBulkYear(Number(e.target.value))}
                >
                  {bulkYearOptions.map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>

              {/* From / To month dropdowns */}
              <div className={styles.rangeRow}>
                <div className={styles.rangeField}>
                  <Label htmlFor="bulk-from-month">From</Label>
                  <select
                    id="bulk-from-month"
                    className={styles.nativeSelect}
                    value={bulkFromMonth}
                    onChange={e => setBulkFromMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.rangeField}>
                  <Label htmlFor="bulk-to-month">To</Label>
                  <select
                    id="bulk-to-month"
                    className={styles.nativeSelect}
                    value={bulkToMonth}
                    onChange={e => setBulkToMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <option key={m} value={m}>{MONTH_NAMES[m - 1]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview */}
              <div style={{ marginTop: tokens.spacingVerticalM, marginBottom: tokens.spacingVerticalXS }}>
                <Label>
                  {bulkFromMonth > bulkToMonth
                    ? 'Invalid range — "From" must be before "To"'
                    : toCreateCount === 0
                    ? 'All periods in this range already exist'
                    : `${toCreateCount} period${toCreateCount !== 1 ? 's' : ''} will be created:`}
                </Label>
              </div>

              {bulkPreviewItems.length > 0 && (
                <div className={styles.previewBox}>
                  {bulkPreviewItems.map(({ year, month, exists }) => (
                    <div
                      key={`${year}-${month}`}
                      className={exists ? styles.previewItemExists : styles.previewItem}
                    >
                      {MONTH_NAMES[month - 1]} {year}{exists ? ' (exists)' : ''}
                    </div>
                  ))}
                </div>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setBulkDialogOpen(false)}>Cancel</Button>
              <Button
                appearance="primary"
                onClick={handleBulkCreate}
                disabled={toCreateCount === 0 || bulkCreating || bulkFromMonth > bulkToMonth}
                icon={bulkCreating ? <Spinner size="tiny" /> : undefined}
              >
                {bulkCreating ? 'Creating…' : `Create ${toCreateCount} Period${toCreateCount !== 1 ? 's' : ''}`}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

    </div>
  );
}
