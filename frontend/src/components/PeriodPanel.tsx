/**
 * Period management panel — renders inside the Finance Operations page.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  mergeClasses,
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
import { periodsApi, CreateYearResponse } from '../api/periods';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../auth/AuthProvider';
import { usePeriod } from '../contexts/PeriodContext';
import { MONTH_NAMES } from '../utils/format';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
  },
  yearTabsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flexWrap: 'wrap',
  },
  yearPill: {
    padding: '3px 12px',
    borderRadius: '999px',
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    cursor: 'pointer',
    fontSize: tokens.fontSizeBase200,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground2,
  },
  yearPillActive: {
    border: `1px solid ${tokens.colorBrandStroke1}`,
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  tableWrap: {
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
  },
  table: {
    width: '100%',
    tableLayout: 'fixed',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
    '& th': {
      fontSize: tokens.fontSizeBase200,
      color: tokens.colorNeutralForeground2,
      fontWeight: tokens.fontWeightSemibold,
      textTransform: 'uppercase',
      letterSpacing: '0.4px',
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      height: '34px',
    },
    '& td': {
      padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
      verticalAlign: 'middle',
      height: '36px',
    },
    '& tbody tr:last-child td': {
      borderBottom: 'none',
    },
    '& th:nth-child(2), & td:nth-child(2)': {
      width: '96px',
    },
    '& th:nth-child(3), & td:nth-child(3)': {
      width: '88px',
    },
  },
  rowClickable: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  rowSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    '& td:first-child': {
      boxShadow: `inset 2px 0 0 ${tokens.colorBrandStroke1}`,
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
  selectedWorkingPeriodId?: string;
  onSelectWorkingPeriod?: (periodId: string) => void;
}

export function PeriodPanel({
  variant: _variant = 'card',
  selectedWorkingPeriodId,
  onSelectWorkingPeriod,
}: PeriodPanelProps) {
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

  // Add Year dialog state (create all 12 months for an arbitrary year)
  const [addYearDialogOpen, setAddYearDialogOpen] = useState(false);
  const [addYearInput, setAddYearInput] = useState<string>(String(currentYear - 1));
  const [addYearStatus, setAddYearStatus] = useState<'auto' | 'open' | 'locked'>('auto');
  const [addYearLoading, setAddYearLoading] = useState(false);

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

  const periodsInActiveYear = useMemo(
    () => periods.filter(p => p.year === activeYear).sort((a, b) => a.month - b.month),
    [periods, activeYear],
  );

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
    handleChangeYear(nextYear);
  };

  const openAddYearDialog = () => {
    setAddYearInput(String(currentYear - 1));
    setAddYearStatus('auto');
    setAddYearDialogOpen(true);
  };

  const resolvedAddYearStatus = (year: number, mode: 'auto' | 'open' | 'locked'): string => {
    if (mode === 'open') return 'open';
    if (mode === 'locked') return 'locked';
    return year < currentYear ? 'locked' : 'open';
  };

  const handleAddYearConfirm = async () => {
    const year = parseInt(addYearInput, 10);
    if (isNaN(year) || year < 2000 || year > currentYear + 20) return;
    setAddYearLoading(true);
    try {
      const result: CreateYearResponse = await periodsApi.createYear(year, addYearStatus);
      const statusLabel = result.status_used === 'locked' ? 'locked' : 'open';
      if (result.created > 0) {
        showSuccess(
          'Year Added',
          `${result.created} ${statusLabel} period${result.created !== 1 ? 's' : ''} created for ${year}.` +
          (result.skipped_existing > 0 ? ` ${result.skipped_existing} month${result.skipped_existing !== 1 ? 's' : ''} already existed.` : ''),
        );
      } else {
        showSuccess('Nothing to Create', `All periods for ${year} already exist.`);
      }
      setAddYearDialogOpen(false);
      await loadPeriods();
      refreshContextPeriods();
      setActiveYear(year);
    } catch (error) {
      showApiError(error as Error, `Failed to create periods for ${year}`);
    } finally {
      setAddYearLoading(false);
    }
  };

  const selectFallbackForYear = (year: number, yearPeriods: Period[] = periods.filter(p => p.year === year)) => {
    if (!onSelectWorkingPeriod || yearPeriods.length === 0) return;
    const open = yearPeriods.find(p => p.status === 'open');
    const fallback = open ?? yearPeriods[0];
    onSelectWorkingPeriod(fallback.id);
  };

  const handleChangeYear = (year: number) => {
    setActiveYear(year);
    const selectedInYear = periods.some(p => p.id === selectedWorkingPeriodId && p.year === year);
    if (!selectedInYear) {
      const yearPeriods = periods.filter(p => p.year === year).sort((a, b) => a.month - b.month);
      selectFallbackForYear(year, yearPeriods);
    }
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

  useEffect(() => {
    if (!selectedWorkingPeriodId) return;
    const selected = periods.find(p => p.id === selectedWorkingPeriodId);
    if (selected) {
      setActiveYear(selected.year);
    }
  }, [selectedWorkingPeriodId, periods]);

  useEffect(() => {
    if (loading) return;
    if (!selectedWorkingPeriodId) {
      selectFallbackForYear(activeYear, periodsInActiveYear);
      return;
    }
    const selectedExists = periods.some(p => p.id === selectedWorkingPeriodId);
    if (!selectedExists) {
      selectFallbackForYear(activeYear, periodsInActiveYear);
    }
  }, [loading, periods, periodsInActiveYear, activeYear, selectedWorkingPeriodId]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return <Spinner label="Loading periods..." />;
  }

  return (
    <div className={styles.root}>

      <div className={styles.toolbar}>
        <div className={styles.yearTabsRow}>
          {availableYears.map(year => (
            <button
              key={year}
              type="button"
              className={mergeClasses(styles.yearPill, activeYear === year && styles.yearPillActive)}
              onClick={() => handleChangeYear(year)}
            >
              {year}
            </button>
          ))}
          <Button appearance="secondary" size="small" onClick={handleAddYear}>Add Year</Button>
        </div>

        <div className={styles.actionsRow}>
          {isFinanceOrAdmin && (
            <>
              <Button appearance="secondary" size="small" icon={<AddRegular />} onClick={openAddYearDialog}>
                Add Year
              </Button>
              <Button appearance="secondary" size="small" icon={<AddRegular />} onClick={() => openBulkDialog()}>
                Create Periods
              </Button>
            </>
          )}
        </div>
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
              const isSelected = !!period && period.id === selectedWorkingPeriodId;

              return (
                <TableRow
                  key={month}
                  className={mergeClasses(period && styles.rowClickable, isSelected && styles.rowSelected)}
                  onClick={() => {
                    if (period && onSelectWorkingPeriod) onSelectWorkingPeriod(period.id);
                  }}
                >
                  <TableCell>
                    <Text className={styles.monthName}>{MONTH_NAMES[month - 1]}</Text>
                  </TableCell>
                  <TableCell>
                    {period ? (
                      <Badge
                        appearance={isLocked ? 'tint' : 'filled'}
                        color={isLocked ? 'informative' : 'brand'}
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
                            appearance="primary"
                            icon={<LockClosedRegular />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLockClick(period);
                            }}
                            disabled={actionLoading === period.id}
                          >
                            Lock
                          </Button>
                        ) : (
                          <Button
                            size="small"
                            appearance="subtle"
                            icon={<LockOpenRegular />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnlockClick(period);
                            }}
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
                          onClick={(e) => {
                            e.stopPropagation();
                            openBulkDialog(activeYear, month, month);
                          }}
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

      {/* Add Year Dialog */}
      <Dialog open={addYearDialogOpen} onOpenChange={(_, data) => { if (!addYearLoading) setAddYearDialogOpen(data.open); }}>
        <DialogSurface style={{ minWidth: 400 }}>
          <DialogBody>
            <DialogTitle>Add Year</DialogTitle>
            <DialogContent>
              <Body1 style={{ display: 'block', marginBottom: tokens.spacingVerticalM, color: tokens.colorNeutralForeground2 }}>
                Creates all 12 months for the selected year. Months that already exist are skipped.
              </Body1>

              <div className={styles.dialogField}>
                <Label htmlFor="add-year-input">Year</Label>
                <Input
                  id="add-year-input"
                  type="number"
                  value={addYearInput}
                  onChange={(_, data) => setAddYearInput(data.value)}
                  min={2000}
                  max={currentYear + 20}
                  style={{ width: '140px' }}
                />
              </div>

              <div className={styles.dialogField}>
                <Label htmlFor="add-year-status">Status</Label>
                <select
                  id="add-year-status"
                  className={styles.nativeSelect}
                  value={addYearStatus}
                  onChange={e => setAddYearStatus(e.target.value as 'auto' | 'open' | 'locked')}
                >
                  <option value="auto">Auto (recommended)</option>
                  <option value="locked">Locked</option>
                  <option value="open">Open</option>
                </select>
              </div>

              {(() => {
                const year = parseInt(addYearInput, 10);
                if (isNaN(year)) return null;
                const resolved = resolvedAddYearStatus(year, addYearStatus);
                const isHistorical = year < currentYear;
                return (
                  <Body1 style={{
                    display: 'block',
                    marginTop: tokens.spacingVerticalXS,
                    color: resolved === 'locked' ? tokens.colorNeutralForeground3 : tokens.colorBrandForeground1,
                    fontSize: tokens.fontSizeBase200,
                  }}>
                    {isHistorical && addYearStatus === 'auto'
                      ? `Historical year — will be created as locked so it does not become an active planning period.`
                      : `Periods will be created as ${resolved}.`}
                  </Body1>
                );
              })()}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setAddYearDialogOpen(false)} disabled={addYearLoading}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={handleAddYearConfirm}
                disabled={addYearLoading || isNaN(parseInt(addYearInput, 10))}
                icon={addYearLoading ? <Spinner size="tiny" /> : undefined}
              >
                {addYearLoading ? 'Creating…' : 'Add Year'}
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
