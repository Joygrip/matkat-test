import { useState, useMemo } from 'react';
import {
  makeStyles,
  tokens,
  Body1,
  Body2,
  Caption1,
  Title3,
  Subtitle2,
  Input,
  Badge,
  Tab,
  TabList,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Skeleton,
  SkeletonItem,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Button,
  Spinner,
  Divider,
} from '@fluentui/react-components';
import { SearchRegular, BuildingRegular, Warning24Regular, PersonRegular, Dismiss24Regular } from '@fluentui/react-icons';
import type {
  ConsolidationDashboard,
  DashboardCostCenter,
  DashboardResource,
  OverAllocation,
  ResourceDetail,
} from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { useWorkQueueSort } from '../../hooks/useWorkQueueSort';
import { FinanceSortBar } from './FinanceSortBar';
import { FinanceKpiStrip, KpiTile } from './FinanceKpiStrip';
import { FinanceIssueAlerts, IssueFilter } from './FinanceIssueAlerts';
import { GapBadge, GapStatusBadge, PlaceholderTypeBadge } from './FinanceBadges';

export interface OverviewTabProps {
  dashboard: ConsolidationDashboard | null;
  loading: boolean;
  projectId?: string;
}

type CcSortKey = 'gap' | 'name' | 'demand' | 'supply';

const CC_SORT_OPTIONS: { key: CcSortKey; label: string }[] = [
  { key: 'gap', label: 'Gap' },
  { key: 'name', label: 'Name' },
  { key: 'demand', label: 'Demand' },
  { key: 'supply', label: 'Supply' },
];

const useStyles = makeStyles({
  emptyPrompt: {
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    textAlign: 'center' as const,
    color: tokens.colorNeutralForeground3,
  },
  workQueueLayout: {
    display: 'grid',
    gridTemplateColumns: '280px 1fr',
    gap: tokens.spacingHorizontalL,
    minHeight: '480px',
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
  detailHeader: {
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    marginBottom: tokens.spacingVerticalXS,
  },
  detailMeta: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalXS,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
  },
  table: { width: '100%' },
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
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr:hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  overAllocCard: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
  },
  overAllocHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
  },
  issueSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalM,
  },
  issueCard: {
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
    overflow: 'hidden',
  },
  issueCardHeader: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  ccRowMeta: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },
  clickableRow: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: `${tokens.colorBrandBackground2} !important` },
  },
  assignmentSection: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: tokens.spacingVerticalS,
  },
  assignmentSectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    paddingBottom: tokens.spacingVerticalXS,
  },
});

function ResourceDetailModal({
  open,
  resourceName,
  detail,
  loading,
  onClose,
}: {
  open: boolean;
  resourceName: string;
  detail: ResourceDetail | null;
  loading: boolean;
  onClose: () => void;
}) {
  const styles = useStyles();
  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onClose(); }}>
      <DialogSurface style={{ minWidth: 560, maxWidth: 720 }}>
        <DialogBody>
          <DialogTitle
            action={
              <Button appearance="subtle" icon={<Dismiss24Regular />} onClick={onClose} />
            }
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalS }}>
              <PersonRegular />
              {resourceName}
            </span>
          </DialogTitle>
          <DialogContent>
            {loading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: tokens.spacingVerticalXL }}>
                <Spinner label="Loading assignments..." />
              </div>
            )}
            {!loading && detail && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }}>
                {/* Summary row */}
                <div style={{ display: 'flex', gap: tokens.spacingHorizontalXL }}>
                  <Body2>Demand: <strong>{detail.total_demand_fte}%</strong></Body2>
                  <Body2>Supply: <strong>{detail.total_supply_fte}%</strong></Body2>
                  <GapBadge gap={detail.gap_fte} />
                </div>

                <Divider />

                {/* Demand assignments */}
                <div className={styles.assignmentSection}>
                  <div className={styles.assignmentSectionTitle}>
                    <Subtitle2>Demand assignments</Subtitle2>
                    <Badge appearance="outline" size="small">{detail.demand_lines.length}</Badge>
                  </div>
                  {detail.demand_lines.length === 0 ? (
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No demand assignments.</Caption1>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell style={{ width: 100 }}>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.demand_lines.map((line, i) => (
                          <TableRow key={i}>
                            <TableCell>{line.project_name ?? '—'}</TableCell>
                            <TableCell>{line.fte_percent}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <Divider />

                {/* Supply assignments */}
                <div className={styles.assignmentSection}>
                  <div className={styles.assignmentSectionTitle}>
                    <Subtitle2>Supply assignments</Subtitle2>
                    <Badge appearance="outline" size="small">{detail.supply_lines.length}</Badge>
                  </div>
                  {detail.supply_lines.length === 0 ? (
                    <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>No supply assignments.</Caption1>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHeaderCell>Project</TableHeaderCell>
                          <TableHeaderCell style={{ width: 100 }}>FTE %</TableHeaderCell>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detail.supply_lines.map((line, i) => (
                          <TableRow key={i}>
                            <TableCell>{line.project_name ?? <em style={{ color: tokens.colorNeutralForeground3 }}>General availability</em>}</TableCell>
                            <TableCell>{line.fte_percent}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function OverAllocTable({ overAllocs }: { overAllocs: OverAllocation[] }) {
  const styles = useStyles();
  return (
    <div className={styles.overAllocCard}>
      <div className={styles.overAllocHeader}>
        <Warning24Regular style={{ color: tokens.colorPaletteRedForeground1 }} />
        Over-allocations ({overAllocs.length})
      </div>
      <Table className={styles.sortableTable}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Resource</TableHeaderCell>
            <TableHeaderCell>Cost Center</TableHeaderCell>
            <TableHeaderCell>Total Demand</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overAllocs.map((oa, i) => (
            <TableRow key={i}>
              <TableCell>{oa.resource_name}</TableCell>
              <TableCell>{oa.cost_center_name || '—'}</TableCell>
              <TableCell>
                <Badge appearance="filled" color="danger">{oa.total_demand_fte}%</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function CcDetailPanel({
  cc,
  overAllocs,
  onResourceClick,
}: {
  cc: DashboardCostCenter;
  overAllocs: OverAllocation[];
  onResourceClick: (resource: DashboardResource) => void;
}) {
  const styles = useStyles();
  const [detailTab, setDetailTab] = useState<'resources' | 'issues'>('resources');
  const understaffedResources = cc.resources.filter(r => r.status === 'under');
  const issueCount = cc.placeholders.length + overAllocs.length + understaffedResources.length;

  return (
    <>
      <div className={styles.detailHeader}>
        <Title3>{cc.cost_center_name}</Title3>
        <div className={styles.detailMeta}>
          <Body2>Demand: <strong>{cc.total_demand_fte}%</strong></Body2>
          <Body2>Supply: <strong>{cc.total_supply_fte}%</strong></Body2>
          <GapBadge gap={cc.gap_fte} />
          {issueCount > 0 && (
            <Badge appearance="outline" color="warning" size="small">{issueCount} issue{issueCount !== 1 ? 's' : ''}</Badge>
          )}
        </div>
      </div>

      <TabList
        selectedValue={detailTab}
        onTabSelect={(_, d) => setDetailTab(d.value as 'resources' | 'issues')}
        size="small"
      >
        <Tab value="resources">
          Resources ({cc.resources.length + cc.placeholders.length})
        </Tab>
        <Tab value="issues">
          Issues {issueCount > 0 ? `(${issueCount})` : ''}
        </Tab>
      </TabList>

      {detailTab === 'resources' && (
        <Table className={styles.sortableTable}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>Demand</TableHeaderCell>
              <TableHeaderCell>Supply</TableHeaderCell>
              <TableHeaderCell>Gap</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cc.resources.map(r => (
              <TableRow
                key={r.resource_id}
                className={styles.clickableRow}
                onClick={() => onResourceClick(r)}
                title="Click to view assignment details"
              >
                <TableCell>
                  <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
                    <PersonRegular style={{ fontSize: 14, color: tokens.colorNeutralForeground3 }} />
                    {r.resource_name}
                  </span>
                </TableCell>
                <TableCell>{r.demand_fte}%</TableCell>
                <TableCell>{r.supply_fte}%</TableCell>
                <TableCell><GapBadge gap={r.gap_fte} /></TableCell>
                <TableCell><GapStatusBadge status={r.status} /></TableCell>
              </TableRow>
            ))}
            {cc.placeholders.map(ph => (
              <TableRow key={ph.placeholder_id}>
                <TableCell>
                  <span style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalXS }}>
                    <PlaceholderTypeBadge type="TBH" />
                    {ph.placeholder_name}
                  </span>
                </TableCell>
                <TableCell>{ph.demand_fte}%</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
                <TableCell>—</TableCell>
              </TableRow>
            ))}
            {cc.resources.length === 0 && cc.placeholders.length === 0 && (
              <TableRow>
                <TableCell colSpan={5}>
                  <Body1 style={{ color: tokens.colorNeutralForeground3 }}>No resources or placeholders.</Body1>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {detailTab === 'issues' && (
        <div className={styles.issueSection}>
          {cc.placeholders.length > 0 && (
            <div className={styles.issueCard}>
              <div className={styles.issueCardHeader}>
                <Body1><strong>Orphan demands ({cc.placeholders.length})</strong></Body1>
              </div>
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Placeholder</TableHeaderCell>
                    <TableHeaderCell>Project</TableHeaderCell>
                    <TableHeaderCell>Demand</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cc.placeholders.map(ph => (
                    <TableRow key={ph.placeholder_id}>
                      <TableCell>{ph.placeholder_name}</TableCell>
                      <TableCell>{ph.project_name}</TableCell>
                      <TableCell>{ph.demand_fte}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {overAllocs.length > 0 && (
            <div className={styles.issueCard}>
              <div className={styles.issueCardHeader}>
                <Body1><strong>Over-allocations ({overAllocs.length})</strong></Body1>
              </div>
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Resource</TableHeaderCell>
                    <TableHeaderCell>Total Demand</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overAllocs.map((oa, i) => (
                    <TableRow key={i}>
                      <TableCell>{oa.resource_name}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="danger">{oa.total_demand_fte}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {understaffedResources.length > 0 && (
            <div className={styles.issueCard}>
              <div className={styles.issueCardHeader}>
                <Body1><strong>Understaffed resources ({understaffedResources.length})</strong></Body1>
              </div>
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Resource</TableHeaderCell>
                    <TableHeaderCell>Demand</TableHeaderCell>
                    <TableHeaderCell>Supply</TableHeaderCell>
                    <TableHeaderCell>Gap</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {understaffedResources.map(r => (
                    <TableRow key={r.resource_id}>
                      <TableCell>{r.resource_name}</TableCell>
                      <TableCell>{r.demand_fte}%</TableCell>
                      <TableCell>{r.supply_fte}%</TableCell>
                      <TableCell><GapBadge gap={r.gap_fte} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {issueCount === 0 && (
            <Body1 style={{ color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalM }}>
              No issues for this cost center.
            </Body1>
          )}
        </div>
      )}
    </>
  );
}

export function OverviewTab({ dashboard, loading, projectId }: OverviewTabProps) {
  const styles = useStyles();
  const [ccFilter, setCcFilter] = useState<IssueFilter>('none');
  const [selectedCcId, setSelectedCcId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [drillOpen, setDrillOpen] = useState(false);
  const [drillResourceName, setDrillResourceName] = useState('');
  const [resourceDetail, setResourceDetail] = useState<ResourceDetail | null>(null);
  const [resourceDetailLoading, setResourceDetailLoading] = useState(false);

  const handleResourceClick = async (resource: DashboardResource) => {
    if (!dashboard) return;
    setDrillResourceName(resource.resource_name);
    setDrillOpen(true);
    setResourceDetail(null);
    setResourceDetailLoading(true);
    try {
      const detail = await consolidationApi.getResourceDetail(dashboard.period_id, resource.resource_id);
      setResourceDetail(detail);
    } finally {
      setResourceDetailLoading(false);
    }
  };
  const { sort, sortDir, handleSortClick, sortItems } = useWorkQueueSort<CcSortKey>('gap');

  // Cost centers scoped to the selected project (no ccFilter/search applied).
  // Used for KPI and issue alert totals so they reflect the project scope,
  // not the secondary list filter.
  const projectFilteredCcs = useMemo(() => {
    if (!dashboard) return [];
    if (!projectId) return dashboard.cost_centers;
    return dashboard.cost_centers.filter(cc => cc.project_ids.includes(projectId));
  }, [dashboard, projectId]);

  const filteredOverAllocs = useMemo(() => {
    if (!dashboard) return [];
    if (!projectId) return dashboard.over_allocations;
    const projectCcIds = new Set(projectFilteredCcs.map(cc => cc.cost_center_id ?? '__none__'));
    return dashboard.over_allocations.filter(oa => projectCcIds.has(oa.cost_center_id ?? '__none__'));
  }, [dashboard, projectId, projectFilteredCcs]);

  const filteredSummary = useMemo(() => {
    if (!dashboard) return null;
    const total_cost_centers = projectFilteredCcs.length;
    const total_demand_fte = projectFilteredCcs.reduce((s, cc) => s + cc.total_demand_fte, 0);
    const total_supply_fte = projectFilteredCcs.reduce((s, cc) => s + cc.total_supply_fte, 0);
    const total_gap_fte = total_supply_fte - total_demand_fte;
    const orphans_count = projectFilteredCcs.reduce((s, cc) => s + cc.placeholders.length, 0);
    const over_allocations_count = filteredOverAllocs.length;
    const understaffed_count = projectFilteredCcs.reduce(
      (s, cc) => s + cc.resources.filter(r => r.status === 'under').length, 0
    );
    return { total_cost_centers, total_demand_fte, total_supply_fte, total_gap_fte, orphans_count, over_allocations_count, understaffed_count };
  }, [dashboard, projectFilteredCcs, filteredOverAllocs]);

  const kpiTiles = useMemo((): KpiTile[] => {
    if (!filteredSummary) return [];
    const s = filteredSummary;
    const gapColor = s.total_gap_fte < 0 ? 'danger' : s.total_gap_fte > 0 ? 'success' : 'default';
    return [
      { label: 'Cost Centers', value: s.total_cost_centers },
      { label: 'Demand', value: `${s.total_demand_fte}%` },
      { label: 'Supply', value: `${s.total_supply_fte}%` },
      {
        label: 'Gap',
        value: `${s.total_gap_fte > 0 ? '+' : ''}${s.total_gap_fte}%`,
        color: gapColor,
      },
    ];
  }, [filteredSummary]);

  const filteredCcs = useMemo(() => {
    if (!dashboard) return [];
    let ccs = projectFilteredCcs;
    if (ccFilter === 'orphans') ccs = ccs.filter(cc => cc.placeholders.length > 0);
    if (ccFilter === 'overalloc') {
      const overIds = new Set(filteredOverAllocs.map(oa => oa.cost_center_id ?? '__none__'));
      ccs = ccs.filter(cc => overIds.has(cc.cost_center_id ?? '__none__'));
    }
    if (ccFilter === 'understaffed') {
      ccs = ccs.filter(cc => cc.resources.some(r => r.status === 'under'));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      ccs = ccs.filter(cc => cc.cost_center_name.toLowerCase().includes(q));
    }
    return ccs;
  }, [dashboard, ccFilter, search, projectFilteredCcs, filteredOverAllocs]);

  const sortedCcs = useMemo(() =>
    sortItems(filteredCcs, (cc, key) => {
      switch (key) {
        case 'name': return cc.cost_center_name;
        case 'demand': return cc.total_demand_fte;
        case 'supply': return cc.total_supply_fte;
        case 'gap': return cc.gap_fte;
        default: return cc.gap_fte;
      }
    }),
    [filteredCcs, sortItems]
  );

  const selectedCc = useMemo(() =>
    selectedCcId && dashboard
      ? dashboard.cost_centers.find(cc => (cc.cost_center_id ?? '__none__') === selectedCcId) ?? null
      : null,
    [selectedCcId, dashboard]
  );

  const overAllocsForSelected = useMemo(() =>
    selectedCc && dashboard
      ? dashboard.over_allocations.filter(oa =>
          (oa.cost_center_id ?? '__none__') === (selectedCc.cost_center_id ?? '__none__'))
      : [],
    [selectedCc, dashboard]
  );

  if (loading) {
    return (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: tokens.spacingHorizontalM, marginBottom: tokens.spacingVerticalL }}>
          {[1,2,3,4].map(i => <Skeleton key={i} style={{ height: 72 }}><SkeletonItem style={{ height: '100%' }} /></Skeleton>)}
        </div>
        <div className={styles.workQueueLayout}>
          <div className={styles.workQueueLeft}>
            <Skeleton style={{ height: 32 }}><SkeletonItem /></Skeleton>
            <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
          </div>
          <Skeleton style={{ height: 300 }}><SkeletonItem /></Skeleton>
        </div>
      </>
    );
  }

  if (!dashboard) {
    return (
      <div className={styles.emptyPrompt}>
        <Body1>No planning data available. Select a period to view the overview.</Body1>
      </div>
    );
  }

  return (
    <>
      <FinanceKpiStrip tiles={kpiTiles} />

      <FinanceIssueAlerts
        orphansCount={filteredSummary?.orphans_count ?? 0}
        overAllocsCount={filteredSummary?.over_allocations_count ?? 0}
        understaffedCount={filteredSummary?.understaffed_count ?? 0}
        activeFilter={ccFilter}
        onFilterChange={filter => {
          setCcFilter(filter);
          setSelectedCcId(null);
        }}
      />

      {ccFilter === 'overalloc' && filteredOverAllocs.length > 0 && (
        <OverAllocTable overAllocs={filteredOverAllocs} />
      )}

      <div className={styles.workQueueLayout}>
        {/* Left: cost center list */}
        <div className={styles.workQueueLeft}>
          <Input
            contentBefore={<SearchRegular />}
            placeholder="Search cost centers..."
            value={search}
            onChange={(_, d) => setSearch(d.value)}
          />
          <FinanceSortBar
            options={CC_SORT_OPTIONS}
            sortKey={sort}
            sortDir={sortDir}
            onSort={handleSortClick}
          />
          <div className={styles.workQueueList}>
            {sortedCcs.length === 0 ? (
              <Body1 style={{ color: tokens.colorNeutralForeground3, padding: tokens.spacingVerticalM }}>
                No cost centers match the current filter.
              </Body1>
            ) : sortedCcs.map(cc => {
              const ccKey = cc.cost_center_id ?? '__none__';
              const isSelected = selectedCcId === ccKey;
              return (
                <div
                  key={ccKey}
                  className={`${styles.workQueueRow} ${isSelected ? styles.workQueueRowSelected : ''}`}
                  onClick={() => setSelectedCcId(ccKey)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => e.key === 'Enter' && setSelectedCcId(ccKey)}
                >
                  <div>
                    <Body1 style={{ fontWeight: tokens.fontWeightSemibold }}>{cc.cost_center_name}</Body1>
                    <div className={styles.ccRowMeta}>
                      D: {cc.total_demand_fte}% · S: {cc.total_supply_fte}% · G: {cc.gap_fte > 0 ? '+' : ''}{cc.gap_fte}%
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS, flexShrink: 0 }}>
                    {cc.placeholders.length > 0 && (
                      <Badge appearance="outline" color="warning" size="small">{cc.placeholders.length} orphan</Badge>
                    )}
                    {cc.resources.filter(r => r.status === 'under').length > 0 && (
                      <Badge appearance="outline" color="warning" size="small">
                        {cc.resources.filter(r => r.status === 'under').length} understaffed
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: cost center detail */}
        <div className={styles.workQueueDetails}>
          {selectedCc ? (
            <CcDetailPanel
              cc={selectedCc}
              overAllocs={overAllocsForSelected}
              onResourceClick={handleResourceClick}
            />
          ) : (
            <div className={styles.emptyPrompt} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
              <BuildingRegular style={{ fontSize: 40, color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM }} />
              <Body1>Select a cost center to view details.</Body1>
            </div>
          )}
        </div>
      </div>

      <ResourceDetailModal
        open={drillOpen}
        resourceName={drillResourceName}
        detail={resourceDetail}
        loading={resourceDetailLoading}
        onClose={() => setDrillOpen(false)}
      />
    </>
  );
}
