/**
 * Supply Planning Page
 * 
 * RO/Finance: Create and edit supply lines (resource availability)
 * Admin/PM: Read-only view
 * 
 * Features: Department/CC filters, grouped table
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Body1,
  Title3,
  Card,
  CardHeader,
  Button,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Badge,
  tokens,
  makeStyles,
  Input,
  Select,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  MessageBar,
  MessageBarBody,
  Checkbox,
  Toolbar,
  ToolbarButton,
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular, PeopleRegular } from '@fluentui/react-icons';
import { BreakdownChart, BreakdownRow } from '../components/BreakdownChart';
import { planningApi, SupplyLine, CreateSupplyLine } from '../api/planning';
import { usePeriod } from '../contexts/PeriodContext';
import { lookupsApi, Resource, Department, Project } from '../api/lookups';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { StatusBanner } from '../components/StatusBanner';
import { LoadingState } from '../components/LoadingState';

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
  filters: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
    flexWrap: 'wrap' as const,
  },
  filterLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  filterGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  card: {
    marginBottom: tokens.spacingVerticalL,
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
      backgroundColor: tokens.colorNeutralBackground2,
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
  groupHeader: {
    backgroundColor: tokens.colorNeutralBackground3,
    fontWeight: tokens.fontWeightSemibold,
    '& td': {
      padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
      borderBottom: `2px solid ${tokens.colorBrandStroke1}`,
      fontSize: tokens.fontSizeBase400,
    },
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  formLabel: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXXS,
  },
  chartCard: {
    marginBottom: tokens.spacingVerticalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    overflow: 'hidden',
  },
  chartCardHeader: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chartCardBody: {
    padding: tokens.spacingHorizontalL,
  },
});

interface GroupedSupplies {
  departmentId: string | undefined;
  departmentName: string;
  supplies: SupplyLine[];
}

function groupSuppliesByDept(supplies: SupplyLine[]): GroupedSupplies[] {
  const deptMap = new Map<string, GroupedSupplies>();

  for (const s of supplies) {
    const deptKey = s.department_id || '__none__';
    const deptName = s.department_name || 'Unassigned';
    if (!deptMap.has(deptKey)) {
      deptMap.set(deptKey, { departmentId: s.department_id, departmentName: deptName, supplies: [] });
    }
    deptMap.get(deptKey)!.supplies.push(s);
  }

  const result = Array.from(deptMap.values());
  result.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return result;
}

export const Supply: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showError } = useToast();
  const { user } = useAuth();
  
  const { selectedPeriodId, selectedPeriod: currentPeriod } = usePeriod();
  
  const [supplies, setSupplies] = useState<SupplyLine[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateSupplyLine>({
    period_id: '',
    resource_id: '',
    fte_percent: 100,
  });
  
  // Bulk actions state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditFte, setBulkEditFte] = useState<number>(100);

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const isLocked = currentPeriod?.status === 'locked';
  const canEdit = user?.role === 'Finance' || user?.role === 'RO';

  const groupedSupplies = useMemo(() => groupSuppliesByDept(supplies), [supplies]);
  const totalColumns = canEdit ? 8 : 7;

  // Breakdown chart data: supply grouped by department
  const deptBreakdown: BreakdownRow[] = useMemo(() => {
    const deptMap = new Map<string, number>();
    for (const s of supplies) {
      const name = s.department_name || 'Unassigned';
      deptMap.set(name, (deptMap.get(name) || 0) + (s.fte_percent || 0));
    }
    return Array.from(deptMap.entries())
      .map(([label, fte]) => ({ label, demandFte: 0, supplyFte: fte }))
      .sort((a, b) => b.supplyFte - a.supplyFte);
  }, [supplies]);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    if (selectedPeriodId) {
      loadSupplies(selectedPeriodId, selectedDept);
    }
  }, [selectedPeriodId, selectedDept]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [resourcesData, projectsData, deptsData] = await Promise.all([
        lookupsApi.listResources(),
        lookupsApi.listProjects(),
        lookupsApi.listDepartments(),
      ]);
      
      setResources(resourcesData);
      setProjects(projectsData);
      setDepartments(deptsData);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadSupplies = async (periodId?: string, deptId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!pid) return;
    try {
      const data = await planningApi.getSupplyLines(pid, {
        departmentId: deptId ?? (selectedDept || undefined),
      });
      setSupplies(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load supply lines');
    }
  };
  
  const handleCreate = async () => {
    if (!canEdit) {
      showError('Read-only', 'Only ROs can edit supply lines.');
      return;
    }
    if (!formData.resource_id) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!selectedPeriodId || !currentPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    try {
      await planningApi.createSupplyLine({
        period_id: selectedPeriodId,
        resource_id: formData.resource_id,
        project_id: formData.project_id || undefined,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      });
      showSuccess('Supply line created');
      setIsDialogOpen(false);
      loadSupplies();
      setFormData({ period_id: selectedPeriodId, resource_id: '', project_id: '', fte_percent: 100 });
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to create supply line');
    }
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this supply line?')) return;
    try {
      await planningApi.deleteSupplyLine(id);
      showSuccess('Supply line deleted');
      loadSupplies();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete supply line');
    }
  };
  
  const allSelected = supplies.length > 0 && selectedIds.length === supplies.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : supplies.map(s => s.id));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };
  
  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} supply lines?`)) return;
    try {
      const actions = selectedIds.map(id => ({ action: 'delete', data: { id } }));
      await planningApi.bulkSupplyLines({ actions, all_or_nothing: true });
      showSuccess('Bulk delete successful');
      setSelectedIds([]);
      loadSupplies();
    } catch (err) {
      showApiError(err, 'Bulk delete failed');
    }
  };
  
  const handleBulkEdit = async () => {
    try {
      const actions = selectedIds.map(id => ({ action: 'update', data: { id, fte_percent: bulkEditFte } }));
      await planningApi.bulkSupplyLines({ actions, all_or_nothing: true });
      showSuccess('Bulk edit successful');
      setSelectedIds([]);
      setIsBulkEditOpen(false);
      loadSupplies();
    } catch (err) {
      showApiError(err, 'Bulk edit failed');
    }
  };
  
  if (loading) {
    return <LoadingState message="Loading supply planning data..." />;
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>Supply Planning</h1>
          <p className={styles.pageSubtitle}>Manage resource availability by department</p>
        </div>
        
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
          {!isLocked && canEdit && (
            <Dialog open={isDialogOpen} onOpenChange={(_, data) => setIsDialogOpen(data.open)}>
              <DialogTrigger>
                <Button appearance="primary" icon={<Add24Regular />}>
                  Add Supply
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Add Supply Line</DialogTitle>
                  <DialogContent>
                    {currentPeriod && (
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Period</label>
                        <Body1 style={{ color: tokens.colorNeutralForeground3 }}>
                          {monthNames[currentPeriod.month - 1]} {currentPeriod.year} ({currentPeriod.status})
                        </Body1>
                      </div>
                    )}
                    <div className={styles.formField}>
                      <label className={styles.formLabel}>Resource</label>
                      <Select
                        value={formData.resource_id}
                        onChange={(_, data) => setFormData({ ...formData, resource_id: data.value })}
                      >
                        <option value="">Select resource...</option>
                        {resources.map(r => (
                          <option key={r.id} value={r.id}>{r.display_name}</option>
                        ))}
                      </Select>
                    </div>
                    
                    <div className={styles.formField}>
                      <label className={styles.formLabel}>Project (optional)</label>
                      <Select
                        value={formData.project_id || ''}
                        onChange={(_, data) => setFormData({ ...formData, project_id: data.value })}
                      >
                        <option value="">General availability</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </Select>
                    </div>

                    <div className={styles.formField}>
                      <label className={styles.formLabel}>FTE %</label>
                      <Select
                        value={String(formData.fte_percent)}
                        onChange={(_, data) => setFormData({ ...formData, fte_percent: parseInt(data.value || '100') })}
                      >
                        {[5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100].map(val => (
                          <option key={val} value={val}>{val}%</option>
                        ))}
                      </Select>
                    </div>
                    
                    <MessageBar intent="info" style={{ marginTop: tokens.spacingVerticalM }}>
                      <MessageBarBody>Supply indicates resource availability. Optionally assign to a project.</MessageBarBody>
                    </MessageBar>
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                    <Button appearance="primary" onClick={handleCreate}>Create</Button>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
          )}
        </div>
      </div>

      {/* Filters bar */}
      <div className={styles.filters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Department</span>
          <Select
            value={selectedDept}
            onChange={(_, data) => setSelectedDept(data.value)}
          >
            <option value="">All departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
      </div>
      
      {isLocked && (
        <StatusBanner intent="warning" title="Period Locked" message="This period is locked. Editing is disabled." />
      )}
      {error && (
        <StatusBanner intent="error" title="Error" message={error} />
      )}
      
      {selectedIds.length > 0 && canEdit && (
        <Toolbar style={{ marginBottom: 16 }}>
          <ToolbarButton onClick={handleBulkDelete} icon={<Delete24Regular />}>Delete Selected</ToolbarButton>
          <ToolbarButton onClick={() => setIsBulkEditOpen(true)}>Edit FTE %</ToolbarButton>
        </Toolbar>
      )}
      
      {canEdit && (
        <Dialog open={isBulkEditOpen} onOpenChange={(_, data) => setIsBulkEditOpen(data.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Bulk Edit FTE %</DialogTitle>
              <DialogContent>
                <Input
                  type="number"
                  min={5}
                  max={100}
                  step={5}
                  value={bulkEditFte}
                  onChange={e => setBulkEditFte(Number(e.target.value))}
                  style={{ width: 120 }}
                />
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsBulkEditOpen(false)}>Cancel</Button>
                <Button appearance="primary" onClick={handleBulkEdit}>Apply</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      
      {/* Supply by Department chart */}
      {supplies.length > 0 && (
        <Card className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <Title3 style={{ margin: 0 }}>Supply by Department</Title3>
          </div>
          <div className={styles.chartCardBody}>
            <BreakdownChart rows={deptBreakdown} supplyOnly />
          </div>
        </Card>
      )}

      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Supply Lines ({supplies.length})</strong></Body1>} />
        
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              {canEdit && (
                <TableHeaderCell>
                  <Checkbox checked={allSelected} onChange={toggleSelectAll} />
                </TableHeaderCell>
              )}
              <TableHeaderCell>Department</TableHeaderCell>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Period</TableHeaderCell>
              <TableHeaderCell>FTE %</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColumns} style={{ padding: tokens.spacingVerticalXXL }}>
                  <EmptyState
                    icon={<PeopleRegular style={{ fontSize: 48 }} />}
                    title="No supply lines"
                    message="No supply lines found for the selected filters. Create one to get started."
                    action={
                      !isLocked && canEdit ? (
                        <Button appearance="primary" icon={<Add24Regular />} onClick={() => setIsDialogOpen(true)}>
                          Add Supply Line
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              groupedSupplies.map(dept => (
                <React.Fragment key={dept.departmentId || '__none__'}>
                  <TableRow className={styles.groupHeader}>
                    <TableCell colSpan={totalColumns}>
                      {dept.departmentName}
                      <Badge appearance="outline" style={{ marginLeft: 8 }}>
                        {dept.supplies.length} lines
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {dept.supplies.map(s => (
                    <TableRow key={s.id}>
                      {canEdit && (
                        <TableCell>
                          <Checkbox checked={selectedIds.includes(s.id)} onChange={() => toggleSelect(s.id)} />
                        </TableCell>
                      )}
                      <TableCell>{s.department_name || '-'}</TableCell>
                      <TableCell>{s.resource_name || 'Unknown'}</TableCell>
                      <TableCell>{s.project_name || '—'}</TableCell>
                      <TableCell>{s.year}-{String(s.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="success">{s.fte_percent}%</Badge>
                      </TableCell>
                      <TableCell>
                        {!isLocked && canEdit && (
                          <Button
                            icon={<Delete24Regular />}
                            appearance="subtle"
                            onClick={() => handleDelete(s.id)}
                          />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default Supply;
