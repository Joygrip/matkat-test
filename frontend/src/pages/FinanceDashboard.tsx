import { useEffect, useState } from 'react';
import { apiClient } from '../api/client';
import { lookupsApi } from '../api/lookups';

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
  { value: '', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'N/A', label: 'N/A' },
];

export function FinanceDashboard() {
  const [data, setData] = useState<FinanceActualsDashboardResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState<number | ''>('');
  const [month, setMonth] = useState<number | ''>('');
  const [projectId, setProjectId] = useState<string>('');
  const [costCenterId, setCostCenterId] = useState<string>('');
  const [approvalStatus, setApprovalStatus] = useState<string>('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [sortKey, setSortKey] = useState<string>('');
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  useEffect(() => {
    lookupsApi.listProjects().then(setProjects);
    lookupsApi.listCostCenters().then(setCostCenters);
  }, []);

  useEffect(() => {
    loadData();
    // eslint-disable-next-line
  }, [year, month, projectId, costCenterId, approvalStatus]);

  async function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (year) params.append('year', String(year));
    if (month) params.append('month', String(month));
    if (projectId) params.append('project_id', projectId);
    if (costCenterId) params.append('cost_center_id', costCenterId);
    if (approvalStatus) params.append('approval_status', approvalStatus);
    const result = await apiClient.get<FinanceActualsDashboardResponse[]>(`/finance/actuals-dashboard?${params.toString()}`);
    setData(result);
    setLoading(false);
  }

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  const sortedData = [...data].sort((a, b) => {
    if (!sortKey) return 0;
    const aVal = (a as any)[sortKey];
    const bVal = (b as any)[sortKey];
    if (aVal === bVal) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return (aVal > bVal ? 1 : -1) * (sortAsc ? 1 : -1);
  });

  return (
    <div style={{ padding: 24 }}>
      <h2>Finance Dashboard: Employee Actuals</h2>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <input
          type="number"
          placeholder="Year"
          value={year}
          onChange={e => setYear(e.target.value ? Number(e.target.value) : '')}
          style={{ width: 80 }}
        />
        <input
          type="number"
          placeholder="Month"
          value={month}
          min={1}
          max={12}
          onChange={e => setMonth(e.target.value ? Number(e.target.value) : '')}
          style={{ width: 60 }}
        />
        <select value={projectId} onChange={e => setProjectId(e.target.value)}>
          <option value="">All Projects</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select value={costCenterId} onChange={e => setCostCenterId(e.target.value)}>
          <option value="">All Cost Centers</option>
          {costCenters.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={approvalStatus} onChange={e => setApprovalStatus(e.target.value)}>
          {approvalStatusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      {loading ? (
        <div>Loading...</div>
      ) : sortedData.length === 0 ? (
        <div>No data found for selected filters.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th onClick={() => handleSort('employee_name')}>Employee</th>
              <th onClick={() => handleSort('employee_email')}>Email</th>
              <th onClick={() => handleSort('project_name')}>Project</th>
              <th onClick={() => handleSort('cost_center_name')}>Cost Center</th>
              <th onClick={() => handleSort('year')}>Year</th>
              <th onClick={() => handleSort('month')}>Month</th>
              <th onClick={() => handleSort('fte_percent')}>FTE %</th>
              <th onClick={() => handleSort('approval_status')}>Approval Status</th>
              <th onClick={() => handleSort('current_approval_step')}>Current Step</th>
              <th onClick={() => handleSort('current_approver_name')}>Current Approver</th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map(row => (
              <tr key={row.actual_id}>
                <td>{row.employee_name}</td>
                <td>{row.employee_email}</td>
                <td>{row.project_name}</td>
                <td>{row.cost_center_name}</td>
                <td>{row.year}</td>
                <td>{row.month}</td>
                <td>{row.fte_percent}</td>
                <td>{row.approval_status}</td>
                <td>{row.current_approval_step || '-'}</td>
                <td>{row.current_approver_name || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
