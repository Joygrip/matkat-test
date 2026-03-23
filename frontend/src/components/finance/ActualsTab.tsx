import { useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Body1,
  Card,
  CardHeader,
  Input,
  Badge,
  MessageBar,
  MessageBarBody,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Skeleton,
  SkeletonItem,
} from '@fluentui/react-components';
import { SearchRegular, MoneyRegular } from '@fluentui/react-icons';
import { EmptyState } from '../EmptyState';
import { LoadingState } from '../LoadingState';
import { DemandVsActualsBarChart } from '../DemandVsActualsBarChart';
import { useWorkQueueSort } from '../../hooks/useWorkQueueSort';
import { useFinanceSortState } from '../../hooks/useFinanceSortState';
import { useEmployeeStats } from '../../hooks/useEmployeeStats';
import { FinanceSortBar } from './FinanceSortBar';
import { FinanceKpiStrip, KpiTile } from './FinanceKpiStrip';
import { ApprovalBadge } from './FinanceBadges';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FinanceActualRow {
  actual_id: string;
  employee_name: string;
  employee_email: string;
  project_id: string;
  project_name: string;
  cost_center_id: string;
  cost_center_name: string;
  year: number;
  month: number;
  fte_percent: number;
  approval_status: string;
  current_approval_step?: string;
  current_approver_name?: string;
}

interface LookupProject { id: string; name: string; }

export interface ActualsTabProps {
  actualsData: FinanceActualRow[];
  actualsLoading: boolean;
  actualsError: string | null;
  projects: LookupProject[];
  actualsProjectId: string;
  actualsApprovalStatus: string;
  year: number;
  month: number;
  canSeeStats: boolean;
}

type CcSortKey = 'name' | 'fte' | 'pending';

const CC_SORT_OPTIONS: { key: CcSortKey; label: string }[] = [
  { key: 'fte', label: 'FTE' },
  { key: 'name', label: 'Name' },
  { key: 'pending', label: 'Pending' },
];

// ─── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles({
  workQueueLayout: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    gap: tokens.spacingHorizontalL,
    minHeight: '400px',
  },
  workQueueLeft: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalM,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
    paddingRight: tokens.spacingHorizontalL,
  },
  workQueueList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalXS,
    overflowY: 'auto' as const,
    maxHeight: 'calc(100vh - 380px)',
    minHeight: '200px',
  },
  workQueueRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    cursor: 'pointer',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  workQueueRowSelected: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  workQueueDetails: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalM,
    minWidth: 0,
  },
  sortableTable: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
      position: 'sticky' as const,
      top: 0,
      zIndex: 1,
    },
    '& th': {
      fontWeight: tokens.fontWeightSemibold,
      fontSize: tokens.fontSizeBase300,
      color: tokens.colorNeutralForeground2,
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
      cursor: 'pointer',
      userSelect: 'none' as const,
      '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr:hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  card: {
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
  },
  ccRowMeta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },
  chartCard: {
    marginTop: tokens.spacingVerticalL,
    minHeight: '360px',
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
  },
});

// ─── Component ───────────────────────────────────────────────────────────────

export function ActualsTab({
  actualsData,
  actualsLoading,
  actualsError,
  actualsProjectId,
  year,
  month,
  canSeeStats,
}: ActualsTabProps) {
  const styles = useStyles();

  // Work queue state
  const [selectedCcId, setSelectedCcId] = useState<string | null>(null);
  const [ccSearch, setCcSearch] = useState('');
  const { sort: ccSort, sortDir: ccSortDir, handleSortClick: handleCcSort, sortItems: sortCcItems } = useWorkQueueSort<CcSortKey>('fte');

  // Scoreboard filter state
  const [scoreboardFilter, setScoreboardFilter] = useState<'none' | 'pending' | 'approved'>('none');

  // Table sort
  const { handleSort, sortIndicator, comparator } = useFinanceSortState();

  // ── Derived values ──

  const totalLines = actualsData.length;
  const totalFte = actualsData.reduce((s, d) => s + d.fte_percent, 0);
  const pendingCount = actualsData.filter(d => d.approval_status?.toUpperCase() === 'PENDING').length;
  const approvedCount = actualsData.filter(d => d.approval_status?.toUpperCase() === 'APPROVED').length;

  const kpiTiles = useMemo((): KpiTile[] => [
    { label: 'Lines', value: totalLines },
    { label: 'Total FTE', value: `${totalFte}%` },
    {
      label: 'Pending',
      value: pendingCount,
      color: pendingCount > 0 ? 'warning' : 'default',
      onClick: () => setScoreboardFilter(f => f === 'pending' ? 'none' : 'pending'),
      active: scoreboardFilter === 'pending',
    },
    {
      label: 'Approved',
      value: approvedCount,
      color: approvedCount > 0 ? 'success' : 'default',
      onClick: () => setScoreboardFilter(f => f === 'approved' ? 'none' : 'approved'),
      active: scoreboardFilter === 'approved',
    },
  ], [totalLines, totalFte, pendingCount, approvedCount, scoreboardFilter]);

  // Build CC summary list
  const ccList = useMemo(() => {
    const byCc = new Map<string, {
      cost_center_id: string;
      cost_center_name: string;
      totalFte: number;
      lineCount: number;
      pendingCount: number;
    }>();
    for (const row of actualsData) {
      const id = row.cost_center_id;
      const existing = byCc.get(id);
      const isPending = row.approval_status?.toUpperCase() === 'PENDING' ? 1 : 0;
      if (existing) {
        existing.totalFte += row.fte_percent;
        existing.lineCount += 1;
        existing.pendingCount += isPending;
      } else {
        byCc.set(id, {
          cost_center_id: id,
          cost_center_name: row.cost_center_name,
          totalFte: row.fte_percent,
          lineCount: 1,
          pendingCount: isPending,
        });
      }
    }
    return Array.from(byCc.values());
  }, [actualsData]);

  const filteredCcList = useMemo(() => {
    let list = ccList;
    if (ccSearch.trim()) {
      const q = ccSearch.toLowerCase();
      list = list.filter(cc => cc.cost_center_name.toLowerCase().includes(q));
    }
    return list;
  }, [ccList, ccSearch]);

  const sortedCcList = useMemo(() =>
    sortCcItems(filteredCcList, (cc, key) => {
      switch (key) {
        case 'name': return cc.cost_center_name;
        case 'fte': return cc.totalFte;
        case 'pending': return cc.pendingCount;
        default: return cc.totalFte;
      }
    }),
    [filteredCcList, sortCcItems]
  );

  // Filter actuals by scoreboard and selected CC
  const filteredActuals = useMemo(() => {
    let out = actualsData;
    if (scoreboardFilter === 'pending') out = out.filter(d => d.approval_status?.toUpperCase() === 'PENDING');
    if (scoreboardFilter === 'approved') out = out.filter(d => d.approval_status?.toUpperCase() === 'APPROVED');
    if (selectedCcId) out = out.filter(d => d.cost_center_id === selectedCcId);
    return out;
  }, [actualsData, scoreboardFilter, selectedCcId]);

  const sortedActuals = useMemo(() =>
    [...filteredActuals].sort((a, b) =>
      comparator(a as unknown as Record<string, unknown>, b as unknown as Record<string, unknown>)
    ),
    [filteredActuals, comparator]
  );

  // Chart
  const { data: empStats, loading: empStatsLoading, error: empStatsError } = useEmployeeStats(
    year,
    month,
    selectedCcId ?? undefined,
    actualsProjectId || undefined,
    year > 0 && month > 0
  );

  return (
    <>
      {actualsError && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{actualsError}</MessageBarBody>
        </MessageBar>
      )}

      <FinanceKpiStrip tiles={kpiTiles} loading={actualsLoading} />

      {actualsLoading ? (
        <div className={styles.workQueueLayout}>
          <div className={styles.workQueueLeft}>
            <Skeleton style={{ height: 32 }}><SkeletonItem /></Skeleton>
            <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
          </div>
          <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
        </div>
      ) : (
        <div className={styles.workQueueLayout}>
          {/* Left: CC list */}
          <div className={styles.workQueueLeft}>
            <Input
              contentBefore={<SearchRegular />}
              placeholder="Search cost centers..."
              value={ccSearch}
              onChange={(_, d) => setCcSearch(d.value)}
            />
            <FinanceSortBar
              options={CC_SORT_OPTIONS}
              sortKey={ccSort}
              sortDir={ccSortDir}
              onSort={handleCcSort}
            />
            <div className={styles.workQueueList}>
              {/* All cost centers row */}
              <div
                className={`${styles.workQueueRow} ${selectedCcId === null ? styles.workQueueRowSelected : ''}`}
                onClick={() => setSelectedCcId(null)}
                role="button"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && setSelectedCcId(null)}
              >
                <div>
                  <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>All cost centers</Body1>
                  <div className={styles.ccRowMeta}>{totalFte}% FTE · {totalLines} lines</div>
                </div>
              </div>

              {sortedCcList.map(cc => (
                <div
                  key={cc.cost_center_id}
                  className={`${styles.workQueueRow} ${selectedCcId === cc.cost_center_id ? styles.workQueueRowSelected : ''}`}
                  onClick={() => setSelectedCcId(cc.cost_center_id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && setSelectedCcId(cc.cost_center_id)}
                >
                  <div>
                    <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>{cc.cost_center_name}</Body1>
                    <div className={styles.ccRowMeta}>{cc.totalFte}% FTE · {cc.lineCount} lines</div>
                  </div>
                  {cc.pendingCount > 0 && (
                    <Badge appearance="outline" color="warning" size="small">{cc.pendingCount} pending</Badge>
                  )}
                </div>
              ))}

              {ccList.length === 0 && (
                <Body1 style={{ color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalM }}>
                  No actuals for this period.
                </Body1>
              )}
            </div>
          </div>

          {/* Right: actuals table */}
          <div className={styles.workQueueDetails}>
            <Card className={styles.card}>
              <CardHeader header={<Body1><strong>Employee actuals</strong></Body1>} />
              {sortedActuals.length === 0 ? (
                <EmptyState
                  icon={<MoneyRegular style={{ fontSize: 48 }} />}
                  title="No actuals data"
                  message="No actuals found for this period. Adjust the filters or select a different period."
                />
              ) : (
                <Table className={styles.sortableTable}>
                  <TableHeader>
                    <TableRow>
                      <TableHeaderCell onClick={() => handleSort('employee_name')}>
                        Employee{sortIndicator('employee_name')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('project_name')}>
                        Project{sortIndicator('project_name')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('cost_center_name')}>
                        Cost Center{sortIndicator('cost_center_name')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('year')}>
                        Period{sortIndicator('year')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('fte_percent')}>
                        FTE %{sortIndicator('fte_percent')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('approval_status')}>
                        Approval{sortIndicator('approval_status')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('current_approval_step')}>
                        Current Step{sortIndicator('current_approval_step')}
                      </TableHeaderCell>
                      <TableHeaderCell onClick={() => handleSort('current_approver_name')}>
                        Approver{sortIndicator('current_approver_name')}
                      </TableHeaderCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedActuals.map(row => (
                      <TableRow key={row.actual_id}>
                        <TableCell>
                          <div>
                            <strong>{row.employee_name}</strong>
                            <div style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                              {row.employee_email}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{row.project_name}</TableCell>
                        <TableCell>{row.cost_center_name}</TableCell>
                        <TableCell>{row.year}-{String(row.month).padStart(2, '0')}</TableCell>
                        <TableCell>
                          <Badge appearance="filled" color="informative">{row.fte_percent}%</Badge>
                        </TableCell>
                        <TableCell><ApprovalBadge status={row.approval_status} /></TableCell>
                        <TableCell>{row.current_approval_step || '—'}</TableCell>
                        <TableCell>{row.current_approver_name || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Chart — visible when stats enabled */}
      {canSeeStats && year > 0 && month > 0 && (
        <Card className={styles.chartCard}>
          <CardHeader header={<Body1><strong>Actuals vs Demand by Employee</strong></Body1>} />
          {empStatsLoading ? (
            <LoadingState message="Loading employee stats..." />
          ) : empStatsError ? (
            <MessageBar intent="error"><MessageBarBody>{empStatsError}</MessageBarBody></MessageBar>
          ) : empStats && empStats.length > 0 ? (
            <div style={{ width: '100%', minHeight: 320 }}>
              <DemandVsActualsBarChart data={empStats} height={320} />
            </div>
          ) : (
            <MessageBar intent="info" style={{ margin: tokens.spacingVerticalM }}>
              <MessageBarBody>No employee demand or actuals for this period.</MessageBarBody>
            </MessageBar>
          )}
        </Card>
      )}
    </>
  );
}
