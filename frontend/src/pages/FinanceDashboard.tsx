/**
 * Finance Dashboard: Employee Actuals Overview
 *
 * Shows all actuals across employees with approval status.
 * Finance role: filterable, sortable view for oversight.
 */
import { useEffect, useState } from 'react';
import {
  Card,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  Select,
  Input,
  tokens,
  makeStyles,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import {
  MoneyRegular,
} from '@fluentui/react-icons';
import { apiClient } from '../api/client';
import { lookupsApi } from '../api/lookups';
import { EmptyState } from '../components/EmptyState';
import { LoadingState } from '../components/LoadingState';

interface FinanceActualsDashboardResponse {
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

interface Project { id: string; name: string; }
interface CostCenter { id: string; name: string; }

const approvalStatusOptions = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'N/A', label: 'N/A (Unsigned)' },
];

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1600px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
  },
  headerContent: {
    flex: 1,
  },
  pageTitle: {
    fontSize: tokens.fontSizeHero800,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXS,
    lineHeight: '1.2',
  },
  pageSubtitle: {
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
  filtersCard: {
    marginBottom: tokens.spacingVerticalL,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  filtersRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  filterField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    minWidth: '120px',
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  card: {
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow4,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      boxShadow: tokens.shadow8,
    },
  },
  table: {
    width: '100%',
    '& thead': {
      backgroundColor: tokens.colorNeutralBackground2,
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
      userSelect: 'none',
      '&:hover': {
        backgroundColor: tokens.colorNeutralBackground1Hover,
      },
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr': {
      transition: 'background-color 0.15s ease',
      '&:hover': {
        backgroundColor: tokens.colorNeutralBackground1,
      },
    },
  },
  summaryRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  summaryCard: {
    flex: 1,
    padding: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    textAlign: 'center',
  },
  summaryValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorBrandForeground1,
  },
  summaryLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
});

function getApprovalBadge(status: string) {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return <Badge color="success" appearance="filled">Approved</Badge>;
    case 'PENDING':
      return <Badge color="warning" appearance="filled">Pending</Badge>;
    case 'REJECTED':
      return <Badge color="danger" appearance="filled">Rejected</Badge>;
    default:
      return <Badge color="informative" appearance="outline">Unsigned</Badge>;
  }
}

export function FinanceDashboard() {
  const styles = useStyles();
  const [data, setData] = useState<FinanceActualsDashboardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState<string>('');
  const [month, setMonth] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [costCenterId, setCostCenterId] = useState<string>('');
  const [approvalStatus, setApprovalStatus] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  useEffect(() => {
    Promise.all([
      lookupsApi.listProjects(),
      lookupsApi.listCostCenters(),
    ]).then(([p, c]) => {
      setProjects(p);
      setCostCenters(c);
    });
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line
  }, [year, month, projectId, costCenterId, approvalStatus]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (year) params.append('year', year);
      if (month) params.append('month', month);
      if (projectId) params.append('project_id', projectId);
      if (costCenterId) params.append('cost_center_id', costCenterId);
      if (approvalStatus) params.append('approval_status', approvalStatus);
      const result = await apiClient.get<FinanceActualsDashboardResponse[]>(
        `/finance/actuals-dashboard?${params.toString()}`
      );
      setData(result);
    } catch (err) {
      setError('Failed to load finance dashboard data');
      console.error('FinanceDashboard load error:', err);
    } finally {
      setLoading(false);
    }
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  }

  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = (a as Record<string, unknown>)[sortKey];
    const bVal = (b as Record<string, unknown>)[sortKey];
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return ((aVal as string | number) > (bVal as string | number) ? 1 : -1) * (sortAsc ? 1 : -1);
  });

  // Summary stats
  const totalLines = data.length;
  const totalFte = data.reduce((sum, d) => sum + d.fte_percent, 0);
  const pendingCount = data.filter(d => d.approval_status === 'PENDING').length;
  const approvedCount = data.filter(d => d.approval_status === 'APPROVED').length;

  if (loading && data.length === 0) {
    return <LoadingState message="Loading finance dashboard..." />;
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>Finance Dashboard</h1>
          <p className={styles.pageSubtitle}>Employee actuals overview with approval tracking</p>
        </div>
      </div>

      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {/* Summary Cards */}
      <div className={styles.summaryRow}>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryValue}>{totalLines}</div>
          <div className={styles.summaryLabel}>Total Lines</div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryValue}>{totalFte}%</div>
          <div className={styles.summaryLabel}>Total FTE</div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryValue}>{pendingCount}</div>
          <div className={styles.summaryLabel}>Pending Approval</div>
        </Card>
        <Card className={styles.summaryCard}>
          <div className={styles.summaryValue}>{approvedCount}</div>
          <div className={styles.summaryLabel}>Approved</div>
        </Card>
      </div>

      {/* Filters */}
      <Card className={styles.filtersCard}>
        <div className={styles.filtersRow}>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Year</span>
            <Input
              type="number"
              placeholder="All"
              value={year}
              onChange={(_, d) => setYear(d.value)}
              style={{ width: '100px' }}
            />
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Month</span>
            <Input
              type="number"
              placeholder="All"
              min={1}
              max={12}
              value={month}
              onChange={(_, d) => setMonth(d.value)}
              style={{ width: '80px' }}
            />
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Project</span>
            <Select value={projectId} onChange={(_, d) => setProjectId(d.value)}>
              <option value="">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Cost Center</span>
            <Select value={costCenterId} onChange={(_, d) => setCostCenterId(d.value)}>
              <option value="">All Cost Centers</option>
              {costCenters.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className={styles.filterField}>
            <span className={styles.filterLabel}>Approval</span>
            <Select value={approvalStatus} onChange={(_, d) => setApprovalStatus(d.value)}>
              {approvalStatusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          </div>
        </div>
      </Card>

      {/* Data Table */}
      <Card className={styles.card}>
        {loading ? (
          <LoadingState message="Refreshing..." />
        ) : sortedData.length === 0 ? (
          <EmptyState
            icon={<MoneyRegular style={{ fontSize: 48 }} />}
            title="No actuals data"
            message="No actuals found for the selected filters. Try adjusting the filters above."
          />
        ) : (
          <Table className={styles.table}>
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
              {sortedData.map(row => (
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
                  <TableCell>{getApprovalBadge(row.approval_status)}</TableCell>
                  <TableCell>{row.current_approval_step || '-'}</TableCell>
                  <TableCell>{row.current_approver_name || '-'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
