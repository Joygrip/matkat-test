/**
 * Demand Planning Page
 * 
 * PM/Finance: Create and edit demand lines (project + resource/placeholder + FTE)
 * Admin: Read-only view
 */
import React, { useState, useEffect } from 'react';
import {
  Body1,
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
  Title3,
  Checkbox,
  Toolbar,
  ToolbarButton,
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular, CalendarRegular } from '@fluentui/react-icons';
import { planningApi, DemandLine, CreateDemandLine } from '../api/planning';
import { periodsApi, Period } from '../api/periods';
import { lookupsApi, Project, Resource, Placeholder } from '../api/lookups';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';
import { ReadOnlyBanner } from '../components/ReadOnlyBanner';
import { PageHeader } from '../components/PageHeader';
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
  formRow: {
    display: 'flex',
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
    marginBottom: tokens.spacingVerticalM,
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
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

export const Demand: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showError } = useToast();
  const { user } = useAuth();
  
  const [demands, setDemands] = useState<DemandLine[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
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
  
  // Selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  
  // Bulk Edit Dialog State
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
  const [bulkEditForm, setBulkEditForm] = useState<Partial<CreateDemandLine>>({});
  const [bulkEditUseResource, setBulkEditUseResource] = useState<'resource' | 'placeholder' | ''>('');

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentPeriod = periods.find(p => p.id === selectedPeriod);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    if (selectedPeriod) {
      loadDemands();
    }
  }, [selectedPeriod]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [periodsData, projectsData, resourcesData, placeholdersData] = await Promise.all([
        periodsApi.list(),
        lookupsApi.listProjects(),
        lookupsApi.listResources(),
        lookupsApi.listPlaceholders(),
      ]);
      
      setPeriods(periodsData);
      setProjects(projectsData);
      setResources(resourcesData);
      setPlaceholders(placeholdersData);
      
      if (periodsData.length > 0) {
        const openPeriod = periodsData.find((p: Period) => p.status === 'open');
        const selectedId = openPeriod?.id || periodsData[0].id;
        console.log('[Demand] Setting selected period:', selectedId, 'from', periodsData.length, 'periods');
        setSelectedPeriod(selectedId);
        // Load demands immediately after setting period to avoid race condition
        if (selectedId) {
          planningApi.getDemandLines(selectedId).then(data => {
            console.log('[Demand] Loaded demand lines immediately:', data.length, data);
            setDemands(data);
          }).catch(err => {
            console.error('[Demand] Failed to load demand lines:', err);
            showApiError(err as Error, 'Failed to load demand lines');
          });
        }
      } else {
        console.warn('[Demand] No periods found!');
      }
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadDemands = async () => {
    if (!selectedPeriod) {
      console.log('[Demand] No period selected, skipping load');
      return;
    }
    try {
      console.log('[Demand] Loading demand lines for period:', selectedPeriod);
      const data = await planningApi.getDemandLines(selectedPeriod);
      console.log('[Demand] Loaded demand lines:', data.length, data);
      setDemands(data);
    } catch (err: unknown) {
      console.error('[Demand] Failed to load demand lines:', err);
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
    if (!selectedPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    const currentPeriod = periods.find(p => p.id === selectedPeriod);
    if (!currentPeriod) {
      showError('Invalid period', 'Selected period not found.');
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
        period_id: selectedPeriod,
        project_id: formData.project_id,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      };
      // XOR: either resource or placeholder
      if (useResource) {
        data.resource_id = formData.resource_id;
      } else {
        data.placeholder_id = formData.placeholder_id;
      }
      await planningApi.createDemandLine(data);
      showSuccess('Demand line created');
      setIsDialogOpen(false);
      loadDemands();
      // Reset form
      setFormData({
        period_id: selectedPeriod,
        project_id: '',
        fte_percent: 50,
      });
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
  
  const getProjectName = (id: string) => projects.find(p => p.id === id)?.name || 'Unknown';
  const getResourceName = (id?: string) => id ? resources.find(r => r.id === id)?.display_name || 'Unknown' : '-';
  const getPlaceholderName = (id?: string) => id ? placeholders.find(p => p.id === id)?.name || 'Unknown' : '-';
  
  const isLocked = currentPeriod?.status === 'locked';
  const canEdit = user?.role === 'Finance' || user?.role === 'PM';
  const isReadOnly = !canEdit && user?.role === 'Admin';
  
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
      // Call bulk API
      const actions = selectedIds.map(id => ({ action: 'delete', data: { id } }));
      // Replace with your API client call
      await planningApi.bulkDemandLines({ actions, all_or_nothing: true });
      showSuccess('Bulk delete successful');
      setSelectedIds([]);
      loadDemands();
    } catch (err) {
      showApiError(err, 'Bulk delete failed');
    }
  };
  
  // Bulk Edit
  const handleOpenBulkEdit = () => {
    setBulkEditForm({});
    setBulkEditUseResource('');
    setIsBulkEditOpen(true);
  };
  const handleCloseBulkEdit = () => setIsBulkEditOpen(false);

  const handleBulkEditSubmit = async () => {
    if (!canEdit) {
      showError('Read-only', 'Only PM/Finance can bulk edit demand lines.');
      return;
    }
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
          // XOR logic for resource/placeholder
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
          <p className={styles.pageSubtitle}>Manage project resource demand</p>
        </div>
        <div style={{ display: 'flex', gap: tokens.spacingHorizontalM, alignItems: 'center' }}>
          <Select
            value={selectedPeriod}
            onChange={(_, data) => setSelectedPeriod(data.value)}
          >
            {periods.map(p => (
              <option key={p.id} value={p.id}>
                {p.year}-{String(p.month).padStart(2, '0')} ({p.status})
              </option>
            ))}
          </Select>
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
                      <div className={styles.formField} style={{ marginBottom: tokens.spacingVerticalM }}>
                        <label>Period</label>
                        <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground3 }}>
                          {monthNames[currentPeriod.month - 1]} {currentPeriod.year} ({currentPeriod.status})
                        </Body1>
                      </div>
                    )}
                    <div className={styles.formField}>
                      <label>Project</label>
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
                    
                    <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                      <label>Assignment Type</label>
                      <Select
                        value={useResource ? 'resource' : 'placeholder'}
                        onChange={(_, data) => {
                          const nextUseResource = data.value === 'resource';
                          setUseResource(nextUseResource);
                          setFormData((prev) => ({
                            ...prev,
                            resource_id: nextUseResource ? prev.resource_id : '',
                            placeholder_id: nextUseResource ? '' : prev.placeholder_id,
                          }));
                        }}
                      >
                        <option value="resource">Named Resource</option>
                        <option value="placeholder">Placeholder (TBD)</option>
                      </Select>
                    </div>
                    
                    {useResource ? (
                      <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                        <label>Resource</label>
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
                      <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                        <label>Placeholder</label>
                        <Select
                          value={formData.placeholder_id || ''}
                          onChange={(_, data) => setFormData({ ...formData, placeholder_id: data.value })}
                        >
                          <option value="">Select placeholder...</option>
                          {placeholders.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </Select>
                      </div>
                    )}
                    
                    <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                      <label>FTE %</label>
                      <Select
                        value={String(formData.fte_percent)}
                        onChange={(_, data) => setFormData({ ...formData, fte_percent: parseInt(data.value || '50') })}
                      >
                        {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100].map(val => (
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
      
      {isLocked && (
        <StatusBanner
          intent="warning"
          title="Period Locked"
          message="This period is locked. Editing is disabled."
        />
      )}
      
      {error && (
        <StatusBanner intent="danger" title="Error" message={error} />
      )}

      {selectedIds.length > 0 && canEdit && (
        <Toolbar style={{ marginBottom: 16 }}>
          <ToolbarButton onClick={handleBulkDelete} icon={<Delete24Regular />}>Delete Selected</ToolbarButton>
          <ToolbarButton onClick={handleOpenBulkEdit}>Edit Selected</ToolbarButton>
          {/* Add more bulk actions here (Import, Export) */}
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
                  <label>Project</label>
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
                  <label>Assignment Type</label>
                  <Select
                    value={bulkEditUseResource}
                    onChange={(_, data) => {
                      setBulkEditUseResource(data.value as 'resource' | 'placeholder' | '');
                      setBulkEditForm(f => ({
                        ...f,
                        resource_id: data.value === 'resource' ? '' : f.resource_id,
                        placeholder_id: data.value === 'placeholder' ? '' : f.placeholder_id,
                      }));
                    }}
                  >
                    <option value="">No change</option>
                    <option value="resource">Named Resource</option>
                    <option value="placeholder">Placeholder (TBD)</option>
                  </Select>
                </div>
                {bulkEditUseResource === 'resource' && (
                  <div className={styles.formField}>
                    <label>Resource</label>
                    <Select
                      value={bulkEditForm.resource_id || ''}
                      onChange={(_, data) => setBulkEditForm(f => ({ ...f, resource_id: data.value }))}
                    >
                      <option value="">No change</option>
                      {resources.map(r => (
                        <option key={r.id} value={r.id}>{r.display_name}</option>
                      ))}
                    </Select>
                  </div>
                )}
                {bulkEditUseResource === 'placeholder' && (
                  <div className={styles.formField}>
                    <label>Placeholder</label>
                    <Select
                      value={bulkEditForm.placeholder_id || ''}
                      onChange={(_, data) => setBulkEditForm(f => ({ ...f, placeholder_id: data.value }))}
                    >
                      <option value="">No change</option>
                      {placeholders.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </div>
                )}
                <div className={styles.formField}>
                  <label>FTE %</label>
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
                <Button onClick={handleCloseBulkEdit}>Cancel</Button>
                <Button appearance="primary" onClick={handleBulkEditSubmit}>Apply Changes</Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
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
                <TableCell colSpan={canEdit ? 7 : 6} style={{ padding: tokens.spacingVerticalXXL }}>
                  <EmptyState
                    icon={<CalendarRegular style={{ fontSize: 48 }} />}
                    title="No demand lines"
                    message="No demand lines found for this period. Create one to get started."
                    action={
                      !isLocked && canEdit ? (
                        <Button
                          appearance="primary"
                          icon={<Add24Regular />}
                          onClick={() => setIsDialogOpen(true)}
                        >
                          Add Demand Line
                        </Button>
                      ) : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ) : (
              demands.map(d => (
                <TableRow key={d.id}>
                  {canEdit && (
                    <TableCell>
                      <Checkbox checked={selectedIds.includes(d.id)} onChange={() => toggleSelect(d.id)} />
                    </TableCell>
                  )}
                  <TableCell>{getProjectName(d.project_id)}</TableCell>
                  <TableCell>{getResourceName(d.resource_id)}</TableCell>
                  <TableCell>
                    {d.placeholder_id && (
                      <Badge appearance="outline" color="warning">
                        {getPlaceholderName(d.placeholder_id)}
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
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default Demand;
