/**
 * Demand Planning Page
 * 
 * PM/Finance: Create and edit demand lines (project + resource/placeholder + FTE)
 * Admin: Read-only view
 * 
 * Features: Department/CC filters, grouped table, placeholder-by-department dialog
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
  Select,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Toolbar,
  ToolbarButton,
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular, CalendarRegular } from '@fluentui/react-icons';
import { BreakdownChart, BreakdownRow } from '../components/BreakdownChart';
import { planningApi, DemandLine, CreateDemandLine } from '../api/planning';
import { usePeriod } from '../contexts/PeriodContext';
import { lookupsApi, Project, Resource, Placeholder, Department } from '../api/lookups';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';
import { StatusBanner } from '../components/StatusBanner';
import { EmptyState } from '../components/EmptyState';
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

interface GroupedDemands {
  departmentId: string | undefined;
  departmentName: string;
  demands: DemandLine[];
}

function groupDemandsByDept(demands: DemandLine[]): GroupedDemands[] {
  const deptMap = new Map<string, GroupedDemands>();

  for (const d of demands) {
    const deptKey = d.department_id || '__none__';
    const deptName = d.department_name || 'Unassigned';
    if (!deptMap.has(deptKey)) {
      deptMap.set(deptKey, { departmentId: d.department_id, departmentName: deptName, demands: [] });
    }
    deptMap.get(deptKey)!.demands.push(d);
  }

  const result = Array.from(deptMap.values());
  result.sort((a, b) => a.departmentName.localeCompare(b.departmentName));
  return result;
}

export const Demand: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showError } = useToast();
  const { user } = useAuth();
  
  const { selectedPeriodId, selectedPeriod: currentPeriod } = usePeriod();
  
  const [demands, setDemands] = useState<DemandLine[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDept, setSelectedDept] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateDemandLine>({
    period_id: '',
    project_id: '',
    fte_percent: 50,
  });
  const [useResource, setUseResource] = useState(true);
  const [dialogDept, setDialogDept] = useState<string>('');
  const [filteredPlaceholders, setFilteredPlaceholders] = useState<Placeholder[]>([]);
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Bulk Edit Dialog State
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState<Partial<CreateDemandLine>>({});
  const [bulkEditUseResource, setBulkEditUseResource] = useState<'resource' | 'placeholder' | ''>('');

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const groupedDemands = useMemo(() => groupDemandsByDept(demands), [demands]);
  const totalColumns = (user?.role === 'Finance' || user?.role === 'PM') ? 8 : 7;

  // Breakdown chart data: demand grouped by project
  const projectBreakdown: BreakdownRow[] = useMemo(() => {
    const projMap = new Map<string, number>();
    for (const d of demands) {
      const name = d.project_name || 'Unknown';
      projMap.set(name, (projMap.get(name) || 0) + (d.fte_percent || 0));
    }
    return Array.from(projMap.entries())
      .map(([label, fte]) => ({ label, demandFte: fte, supplyFte: 0 }))
      .sort((a, b) => b.demandFte - a.demandFte);
  }, [demands]);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    if (selectedPeriodId) {
      loadDemands(selectedPeriodId, selectedDept);
    }
  }, [selectedPeriodId, selectedDept]);

  // When dialog dept changes, filter placeholders
  useEffect(() => {
    if (dialogDept) {
      lookupsApi.listPlaceholders(dialogDept).then(setFilteredPlaceholders);
    } else {
      setFilteredPlaceholders(placeholders);
    }
  }, [dialogDept, placeholders]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [projectsData, resourcesData, placeholdersData, deptsData] = await Promise.all([
        lookupsApi.listProjects(),
        lookupsApi.listResources(),
        lookupsApi.listPlaceholders(),
        lookupsApi.listDepartments(),
      ]);
      
      setProjects(projectsData);
      setResources(resourcesData);
      setPlaceholders(placeholdersData);
      setDepartments(deptsData);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadDemands = async (periodId?: string, deptId?: string) => {
    const pid = periodId || selectedPeriodId;
    if (!pid) return;
    try {
      const data = await planningApi.getDemandLines(pid, {
        departmentId: deptId ?? (selectedDept || undefined),
      });
      setDemands(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load demand lines');
    }
  };
  
  const handleCreate = async () => {
    if (!canEdit) {
      showError('Read-only', 'Only PMs can edit demand lines.');
      return;
    }
    if (!formData.project_id) {
      showError('Missing project', 'Please select a project.');
      return;
    }
    if (!selectedPeriodId || !currentPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    if (useResource && !formData.resource_id) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!useResource && !formData.placeholder_id) {
      showError('Missing placeholder', 'Please select a placeholder.');
      return;
    }
    try {
      const data: CreateDemandLine = {
        period_id: selectedPeriodId,
        project_id: formData.project_id,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      };
      if (useResource) {
        data.resource_id = formData.resource_id;
      } else {
        data.placeholder_id = formData.placeholder_id;
      }
      await planningApi.createDemandLine(data);
      showSuccess('Demand line created');
      setIsDialogOpen(false);
      loadDemands();
      setFormData({ period_id: selectedPeriodId, project_id: '', fte_percent: 50 });
      setDialogDept('');
    } catch (err: any) {
      showApiError(err, 'Failed to create demand line');
    }
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this demand line?')) return;
    try {
      await planningApi.deleteDemandLine(id);
      showSuccess('Demand line deleted');
      loadDemands();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete demand line');
    }
  };
  
  const isLocked = currentPeriod?.status === 'locked';
  const canEdit = user?.role === 'Finance' || user?.role === 'PM';
  
  const allSelected = demands.length > 0 && selectedIds.length === demands.length;
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? [] : demands.map(d => d.id));
  };
  const toggleSelect = (id: string) => {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]);
  };
  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedIds.length} demand lines?`)) return;
    try {
      const actions = selectedIds.map(id => ({ action: 'delete', data: { id } }));
      await planningApi.bulkDemandLines({ actions, all_or_nothing: true });
      showSuccess('Bulk delete successful');
      setSelectedIds([]);
      loadDemands();
    } catch (err) {
      showApiError(err, 'Bulk delete failed');
    }
  };

  const handleOpenBulkEdit = () => {
    setBulkEditForm({});
    setBulkEditUseResource('');
    setIsBulkEditOpen(true);
  };

  const handleBulkEditSubmit = async () => {
    if (!canEdit) return;
    if (Object.keys(bulkEditForm).length === 0 && !bulkEditUseResource) {
      showError('No changes', 'Please select at least one field to update.');
      return;
    }
    try {
      const actions = selectedIds.map(id => ({
        action: 'update',
        data: {
          id,
          ...bulkEditForm,
          ...(bulkEditUseResource === 'resource' ? { resource_id: bulkEditForm.resource_id, placeholder_id: undefined } : {}),
          ...(bulkEditUseResource === 'placeholder' ? { placeholder_id: bulkEditForm.placeholder_id, resource_id: undefined } : {}),
        },
      }));
      await planningApi.bulkDemandLines({ actions, all_or_nothing: true });
      showSuccess('Bulk edit successful');
      setIsBulkEditOpen(false);
      setSelectedIds([]);
      loadDemands();
    } catch (err) {
      showApiError(err, 'Bulk edit failed');
    }
  };
  
  if (loading) {
    return <LoadingState message="Loading demand planning data..." />;
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>Demand Planning</h1>
          <p className={styles.pageSubtitle}>Manage project resource demand by department</p>
        </div>
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
          {!isLocked && canEdit && (
            <Dialog open={isDialogOpen} onOpenChange={(_, data) => setIsDialogOpen(data.open)}>
              <DialogTrigger>
                <Button appearance="primary" icon={<Add24Regular />}>
                  Add Demand
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Add Demand Line</DialogTitle>
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
                      <label className={styles.formLabel}>Project</label>
                      <Select
                        value={formData.project_id}
                        onChange={(_, data) => setFormData({ ...formData, project_id: data.value })}
                      >
                        <option value="">Select project...</option>
                        {projects.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </Select>
                    </div>
                    
                    <div className={styles.formField}>
                      <label className={styles.formLabel}>Assignment Type</label>
                      <Select
                        value={useResource ? 'resource' : 'placeholder'}
                        onChange={(_, data) => {
                          const next = data.value === 'resource';
                          setUseResource(next);
                          setFormData((prev) => ({
                            ...prev,
                            resource_id: next ? prev.resource_id : '',
                            placeholder_id: next ? '' : prev.placeholder_id,
                          }));
                          if (next) setDialogDept('');
                        }}
                      >
                        <option value="resource">Named Resource</option>
                        <option value="placeholder">Placeholder (TBD)</option>
                      </Select>
                    </div>
                    
                    {useResource ? (
                      <div className={styles.formField}>
                        <label className={styles.formLabel}>Resource</label>
                        <Select
                          value={formData.resource_id || ''}
                          onChange={(_, data) => setFormData({ ...formData, resource_id: data.value })}
                        >
                          <option value="">Select resource...</option>
                          {resources.map(r => (
                            <option key={r.id} value={r.id}>{r.display_name}</option>
                          ))}
                        </Select>
                      </div>
                    ) : (
                      <>
                        <div className={styles.formField}>
                          <label className={styles.formLabel}>Department (filter placeholders)</label>
                          <Select
                            value={dialogDept}
                            onChange={(_, data) => {
                              setDialogDept(data.value);
                              setFormData(prev => ({ ...prev, placeholder_id: '' }));
                            }}
                          >
                            <option value="">All departments</option>
                            {departments.map(d => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </Select>
                        </div>
                        <div className={styles.formField}>
                          <label className={styles.formLabel}>Placeholder</label>
                          <Select
                            value={formData.placeholder_id || ''}
                            onChange={(_, data) => setFormData({ ...formData, placeholder_id: data.value })}
                          >
                            <option value="">Select placeholder...</option>
                            {filteredPlaceholders.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.name}{p.department_name ? ` (${p.department_name})` : ''}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </>
                    )}
                    
                    <div className={styles.formField}>
                      <label className={styles.formLabel}>FTE %</label>
                      <Select
                        value={String(formData.fte_percent)}
                        onChange={(_, data) => setFormData({ ...formData, fte_percent: parseInt(data.value || '50') })}
                      >
                        {[5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100].map(val => (
                          <option key={val} value={val}>{val}%</option>
                        ))}
                      </Select>
                    </div>
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
          <ToolbarButton onClick={handleOpenBulkEdit}>Edit Selected</ToolbarButton>
        </Toolbar>
      )}

      {/* Bulk Edit Dialog */}
      {canEdit && (
        <Dialog open={isBulkEditOpen} onOpenChange={(_, d) => setIsBulkEditOpen(d.open)}>
          <DialogSurface>
            <DialogBody>
              <DialogTitle>Bulk Edit Demand Lines</DialogTitle>
              <DialogContent>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>Project</label>
                  <Select
                    value={bulkEditForm.project_id || ''}
                    onChange={(_, data) => setBulkEditForm(f => ({ ...f, project_id: data.value }))}
                  >
                    <option value="">No change</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel}>FTE %</label>
                  <Select
                    value={bulkEditForm.fte_percent ? String(bulkEditForm.fte_percent) : ''}
                    onChange={(_, data) => setBulkEditForm(f => ({ ...f, fte_percent: data.value ? parseInt(data.value) : undefined }))}
                  >
                    <option value="">No change</option>
                    {[5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100].map(val => (
                      <option key={val} value={val}>{val}%</option>
                    ))}
                  </Select>
                </div>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setIsBulkEditOpen(false)}>Cancel</Button>
                <Button appearance="primary" onClick={handleBulkEditSubmit}>Apply Changes</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
      
      {/* Demand by Project chart */}
      {demands.length > 0 && (
        <Card className={styles.chartCard}>
          <div className={styles.chartCardHeader}>
            <Title3 style={{ margin: 0 }}>Demand by Project</Title3>
          </div>
          <div className={styles.chartCardBody}>
            <BreakdownChart rows={projectBreakdown} demandOnly />
          </div>
        </Card>
      )}

      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Demand Lines ({demands.length})</strong></Body1>} />
        
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              {canEdit && (
                <TableHeaderCell>
                  <Checkbox checked={allSelected} onChange={toggleSelectAll} />
                </TableHeaderCell>
              )}
              <TableHeaderCell>Department</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>Placeholder</TableHeaderCell>
              <TableHeaderCell>Period</TableHeaderCell>
              <TableHeaderCell>FTE %</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {demands.length === 0 ? (
              <TableRow>
                <TableCell colSpan={totalColumns} style={{ padding: tokens.spacingVerticalXXL }}>
                  <EmptyState
                    icon={<CalendarRegular style={{ fontSize: 48 }} />}
                    title="No demand lines"
                    message="No demand lines found for the selected filters. Create one to get started."
                    action={
                      !isLocked && canEdit ? (
                        <Button appearance="primary" icon={<Add24Regular />} onClick={() => setIsDialogOpen(true)}>
                          Add Demand Line
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              groupedDemands.map(dept => (
                <React.Fragment key={dept.departmentId || '__none__'}>
                  {/* Department group header */}
                  <TableRow className={styles.groupHeader}>
                    <TableCell colSpan={totalColumns}>
                      {dept.departmentName}
                      <Badge appearance="outline" style={{ marginLeft: 8 }}>
                        {dept.demands.length} lines
                      </Badge>
                    </TableCell>
                  </TableRow>
                  {dept.demands.map(d => (
                    <TableRow key={d.id}>
                      {canEdit && (
                        <TableCell>
                          <Checkbox checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} />
                        </TableCell>
                      )}
                      <TableCell>{d.department_name || '-'}</TableCell>
                      <TableCell>{d.project_name || 'Unknown'}</TableCell>
                      <TableCell>{d.resource_name || '-'}</TableCell>
                      <TableCell>
                        {d.placeholder_name && (
                          <Badge appearance="outline" color="warning">
                            {d.placeholder_name}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{d.year}-{String(d.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="informative">{d.fte_percent}%</Badge>
                      </TableCell>
                      <TableCell>
                        {!isLocked && canEdit && (
                          <Button
                            icon={<Delete24Regular />}
                            appearance="subtle"
                            onClick={() => handleDelete(d.id)}
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

export default Demand;
