/**
 * Actuals Entry Page
 * 
 * Employee: Enter and sign actuals
 * RO: View and proxy sign for absent employees
 */
import React, { useState, useEffect } from 'react';
import {
  Title1,
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
  Spinner,
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
  Textarea,
  ProgressBar,
} from '@fluentui/react-components';
import { 
  Add24Regular, 
  Delete24Regular, 
  Signature24Regular,
  CheckmarkCircle24Regular,
} from '@fluentui/react-icons';
import { actualsApi, ActualLine, CreateActualLine } from '../api/actuals';
import { periodsApi, Period } from '../api/periods';
import { lookupsApi, Project, Resource } from '../api/lookups';
import { planningApi, DemandLine, SupplyLine } from '../api/planning';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { ApiError } from '../types';
import { useAuth } from '../auth/AuthProvider';

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
  totalBar: {
    padding: tokens.spacingVerticalL,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    marginBottom: tokens.spacingVerticalM,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground2,
    },
  },
  overLimitRow: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    '&:hover': {
      backgroundColor: tokens.colorPaletteRedBackground2,
    },
  },
  planningSummary: {
    padding: tokens.spacingHorizontalL,
  },
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  summaryCard: {
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'all 0.2s ease',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: tokens.shadow8,
    },
  },
  summaryValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    lineHeight: '1',
    marginBottom: tokens.spacingVerticalXS,
  },
  summaryLabel: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: tokens.spacingVerticalXS,
  },
});

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const Actuals: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  const { user } = useAuth();
  
  const [actuals, setActuals] = useState<ActualLine[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overLimitIds, setOverLimitIds] = useState<string[]>([]);
  const [demandLines, setDemandLines] = useState<DemandLine[]>([]);
  const [supplyLines, setSupplyLines] = useState<SupplyLine[]>([]);
  
  const isEmployee = user?.role === 'Employee';
  const isRO = user?.role === 'RO';
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSignDialogOpen, setIsSignDialogOpen] = useState(false);
  const [selectedActual, setSelectedActual] = useState<ActualLine | null>(null);
  const [proxyReason, setProxyReason] = useState('');
  const [isProxySign, setIsProxySign] = useState(false);
  
  const [formData, setFormData] = useState<Omit<CreateActualLine, 'year' | 'month' | 'planned_fte_percent'>>({
    period_id: '',
    resource_id: '',
    project_id: '',
    actual_fte_percent: 50,
  });
  const [myResourceId, setMyResourceId] = useState<string | null>(null);
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  // Load employee's resource ID
  useEffect(() => {
    if (isEmployee) {
      actualsApi.getMyResource()
        .then(data => setMyResourceId(data.resource_id))
        .catch(() => setMyResourceId(null));
    }
  }, [isEmployee]);
  
  useEffect(() => {
    if (selectedPeriod) {
      loadActuals();
    }
  }, [selectedPeriod]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [periodsData, projectsData, resourcesData] = await Promise.all([
        periodsApi.list(),
        lookupsApi.listProjects(),
        lookupsApi.listResources(),
      ]);
      
      setPeriods(periodsData);
      setProjects(projectsData);
      setResources(resourcesData);
      
      if (periodsData.length > 0) {
        const openPeriod = periodsData.find((p: Period) => p.status === 'open');
        setSelectedPeriod(openPeriod?.id || periodsData[0].id);
      }
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadActuals = async () => {
    try {
      const currentPeriod = periods.find(p => p.id === selectedPeriod);
      // Employee role uses /actuals/my to see their own lines (filtered by year/month if period selected)
      // Other roles (RO, Finance, Admin) use /actuals?year=X&month=Y to see all lines
      const data = isEmployee 
        ? await actualsApi.getMyActuals(currentPeriod?.year, currentPeriod?.month)
        : await actualsApi.getActualLines(undefined, currentPeriod?.year, currentPeriod?.month);
      setActuals(data);
      setOverLimitIds([]);
      
      // For employees, also load demand and supply lines for their resource
      if (isEmployee && selectedPeriod) {
        try {
          const [demands, supplies] = await Promise.all([
            planningApi.getDemandLines(selectedPeriod).catch(() => []),
            planningApi.getSupplyLines(selectedPeriod).catch(() => []),
          ]);
          setDemandLines(demands || []);
          setSupplyLines(supplies || []);
        } catch (err) {
          console.error('Failed to load demand/supply lines:', err);
          setDemandLines([]);
          setSupplyLines([]);
        }
      }
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load actuals');
    }
  };
  
  const handleCreate = async () => {
    const period = periods.find(p => p.id === selectedPeriod);
    if (!period) {
      showError('No period selected', 'Please select a period first.');
      return;
    }
    // For employees, use their own resource
    const resourceId = isEmployee && myResourceId ? myResourceId : formData.resource_id;
    if (!resourceId) {
      showError('Missing resource', 'Please select a resource.');
      return;
    }
    if (!formData.project_id) {
      showError('Missing project', 'Please select a project.');
      return;
    }
    try {
      await actualsApi.createActualLine({
        period_id: selectedPeriod,
        resource_id: resourceId,
        project_id: formData.project_id,
        year: period.year,
        month: period.month,
        actual_fte_percent: formData.actual_fte_percent,
        // planned_fte_percent is omitted - backend will calculate it automatically
      });
      showSuccess('Actual line created');
      setIsDialogOpen(false);
      loadActuals();
      
      // Reset form
      setFormData({
        period_id: selectedPeriod,
        resource_id: '',
        project_id: '',
        actual_fte_percent: 50,
      });
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'ACTUALS_OVER_100') {
        const offending = err.extras?.offending_line_ids;
        if (Array.isArray(offending)) {
          setOverLimitIds(offending.filter((id): id is string => typeof id === 'string'));
        }
      }
      showApiError(err as Error, 'Failed to create actual line');
    }
  };
  
  const handleDelete = async (id: string) => {
    if (!confirm('Delete this actual line?')) return;
    
    try {
      await actualsApi.deleteActualLine(id);
      showSuccess('Actual line deleted');
      loadActuals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to delete actual line');
    }
  };
  
  const handleSign = async () => {
    if (!selectedActual) return;
    
    try {
      if (isProxySign) {
        if (!proxyReason.trim()) {
          showError('Reason is required for proxy signing');
          return;
        }
        await actualsApi.proxySignActuals(selectedActual.id, proxyReason);
        showSuccess('Proxy signed successfully');
      } else {
        await actualsApi.signActuals(selectedActual.id);
        showSuccess('Signed successfully');
      }
      
      setIsSignDialogOpen(false);
      setSelectedActual(null);
      setProxyReason('');
      setIsProxySign(false);
      loadActuals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to sign actuals');
    }
  };
  
  const openSignDialog = (actual: ActualLine, proxy: boolean = false) => {
    setSelectedActual(actual);
    setIsProxySign(proxy);
    setIsSignDialogOpen(true);
  };
  
  const getProjectName = (id: string) => projects.find(p => p.id === id)?.name || 'Unknown';
  const getResourceName = (id: string) => resources.find(r => r.id === id)?.display_name || 'Unknown';
  
  const currentPeriod = periods.find(p => p.id === selectedPeriod);
  const isLocked = currentPeriod?.status === 'locked';
  
  // Calculate total by resource
  const totalsByResource: Record<string, number> = {};
  actuals.forEach(a => {
    if (!totalsByResource[a.resource_id]) {
      totalsByResource[a.resource_id] = 0;
    }
    totalsByResource[a.resource_id] += a.actual_fte_percent;
  });
  
  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading..." />
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <h1 className={styles.pageTitle}>Actuals Entry</h1>
          <p className={styles.pageSubtitle}>Record actual time spent on projects</p>
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
          
          {!isLocked && (
            <Dialog 
              open={isDialogOpen} 
              onOpenChange={(_, data) => {
                setIsDialogOpen(data.open);
                // Auto-set resource for employees when dialog opens
                if (data.open && isEmployee && myResourceId) {
                  setFormData(prev => ({ ...prev, resource_id: myResourceId }));
                }
              }}
            >
              <DialogTrigger>
                <Button appearance="primary" icon={<Add24Regular />}>
                  Add Actual
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Add Actual Line</DialogTitle>
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
                      <label>Resource</label>
                      {isEmployee && myResourceId ? (
                        <div>
                          <Body1 style={{ padding: tokens.spacingVerticalS, color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold }}>
                            {resources.find(r => r.id === myResourceId)?.display_name || 'Your Resource'}
                          </Body1>
                          <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                            (Auto-selected - you can only enter actuals for your own resource)
                          </Body1>
                          <input type="hidden" value={myResourceId} />
                        </div>
                      ) : (
                        <Select
                          value={formData.resource_id}
                          onChange={(_, data) => setFormData({ ...formData, resource_id: data.value })}
                        >
                          <option value="">Select resource...</option>
                          {resources.map(r => (
                            <option key={r.id} value={r.id}>{r.display_name}</option>
                          ))}
                        </Select>
                      )}
                    </div>
                    
                    <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
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
                      <label>Actual FTE %</label>
                      <Input
                        type="number"
                        min={5}
                        max={100}
                        step={5}
                        value={String(formData.actual_fte_percent)}
                        onChange={(_, data) => setFormData({ ...formData, actual_fte_percent: parseInt(data.value) })}
                      />
                      <Body1 style={{ marginTop: tokens.spacingVerticalXS, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 }}>
                        Planned FTE will be automatically calculated from demand lines for this project.
                      </Body1>
                    </div>
                    
                    <MessageBar intent="warning" style={{ marginTop: tokens.spacingVerticalM }}>
                      <MessageBarBody>Total actuals per resource cannot exceed 100%</MessageBarBody>
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
      
      {isLocked && (
        <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>Period is locked. Editing is disabled.</MessageBarBody>
        </MessageBar>
      )}
      
      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      
      {/* Demand and Supply Summary for Employees */}
      {isEmployee && selectedPeriod && (demandLines.length > 0 || supplyLines.length > 0) && (
        <Card className={styles.card} style={{ marginBottom: tokens.spacingVerticalL }}>
          <CardHeader header={<Title1>Planning Summary</Title1>} />
          <div className={styles.planningSummary}>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryCard}>
                <Body1 className={styles.summaryLabel}>Total Demand</Body1>
                <Body1 className={styles.summaryValue} style={{ color: tokens.colorPaletteBlueForeground1 }}>
                  {demandLines.reduce((sum, d) => sum + (d.fte_percent || 0), 0)}%
                </Body1>
                <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                  {demandLines.length} demand line{demandLines.length !== 1 ? 's' : ''} across {new Set(demandLines.map(d => d.project_id)).size} project{new Set(demandLines.map(d => d.project_id)).size !== 1 ? 's' : ''}
                </Body1>
              </div>
              <div className={styles.summaryCard}>
                <Body1 className={styles.summaryLabel}>Total Supply</Body1>
                <Body1 className={styles.summaryValue} style={{ color: tokens.colorPaletteGreenForeground1 }}>
                  {supplyLines.reduce((sum, s) => sum + (s.fte_percent || 0), 0)}%
                </Body1>
                <Body1 style={{ fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 }}>
                  {supplyLines.length} supply line{supplyLines.length !== 1 ? 's' : ''}
                </Body1>
              </div>
            </div>
            {demandLines.length > 0 && (
              <div style={{ marginTop: tokens.spacingVerticalL }}>
                <Body1 style={{ fontWeight: tokens.fontWeightSemibold, marginBottom: tokens.spacingVerticalS }}>
                  Demand by Project:
                </Body1>
                <div style={{ display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalXS }}>
                  {Array.from(new Set(demandLines.map(d => d.project_id))).map(projectId => {
                    const projectDemands = demandLines.filter(d => d.project_id === projectId);
                    const projectTotal = projectDemands.reduce((sum, d) => sum + (d.fte_percent || 0), 0);
                    const projectName = projects.find(p => p.id === projectId)?.name || 'Unknown Project';
                    return (
                      <div key={projectId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Body1>{projectName}</Body1>
                        <Badge appearance="outline">{projectTotal}%</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Card>
      )}
      
      {/* Resource totals */}
      {Object.keys(totalsByResource).length > 0 && (
        <Card className={styles.card}>
          <CardHeader header={<Body1><strong>Resource Totals</strong></Body1>} />
          <div style={{ padding: tokens.spacingVerticalM }}>
            {Object.entries(totalsByResource).map(([resourceId, total]) => (
              <div key={resourceId} className={styles.totalBar}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: tokens.spacingVerticalXS }}>
                  <Body1>{getResourceName(resourceId)}</Body1>
                  <Badge 
                    appearance="filled" 
                    color={total > 100 ? 'danger' : total === 100 ? 'success' : 'informative'}
                  >
                    {total}% / 100%
                  </Badge>
                </div>
                <ProgressBar 
                  value={Math.min(total, 100) / 100} 
                  color={total > 100 ? 'error' : total === 100 ? 'success' : 'brand'}
                />
              </div>
            ))}
          </div>
        </Card>
      )}
      
      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Actual Lines ({actuals.length})</strong></Body1>} />
        
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>Project</TableHeaderCell>
              <TableHeaderCell>Period</TableHeaderCell>
              <TableHeaderCell>Planned</TableHeaderCell>
              <TableHeaderCell>Actual</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {actuals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>
                  <Body1>No actuals for this period</Body1>
                </TableCell>
              </TableRow>
            ) : (
              actuals.map(a => (
                <TableRow
                  key={a.id}
                  className={overLimitIds.includes(a.id) ? styles.overLimitRow : undefined}
                >
                  <TableCell>{getResourceName(a.resource_id)}</TableCell>
                  <TableCell>{getProjectName(a.project_id)}</TableCell>
                  <TableCell>{a.year}-{String(a.month).padStart(2, '0')}</TableCell>
                  <TableCell>
                    {a.planned_fte_percent !== null && a.planned_fte_percent !== undefined 
                      ? `${a.planned_fte_percent}%` 
                      : <span style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>No plan</span>}
                  </TableCell>
                  <TableCell>
                    <Badge appearance="filled" color="informative">{a.actual_fte_percent}%</Badge>
                  </TableCell>
                  <TableCell>
                    {a.employee_signed_at ? (
                      <Badge appearance="filled" color="success" icon={<CheckmarkCircle24Regular />}>
                        {a.is_proxy_signed ? 'Proxy Signed' : 'Signed'}
                      </Badge>
                    ) : (
                      <Badge appearance="outline" color="warning">Unsigned</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div style={{ display: 'flex', gap: tokens.spacingHorizontalXS }}>
                      {!a.employee_signed_at && !isLocked && (
                        <>
                          {/* Employee can sign their own actuals */}
                          {isEmployee && (
                            <Button
                              icon={<Signature24Regular />}
                              appearance="subtle"
                              title="Sign"
                              onClick={() => openSignDialog(a, false)}
                            />
                          )}
                          {/* RO can proxy-sign for absent employees */}
                          {isRO && (
                            <Button
                              icon={<Signature24Regular />}
                              appearance="subtle"
                              title="Proxy Sign (RO)"
                              onClick={() => openSignDialog(a, true)}
                            />
                          )}
                        </>
                      )}
                      {!a.employee_signed_at && !isLocked && (
                        <Button
                          icon={<Delete24Regular />}
                          appearance="subtle"
                          onClick={() => handleDelete(a.id)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
      
      {/* Sign Dialog */}
      <Dialog open={isSignDialogOpen} onOpenChange={(_, data) => setIsSignDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{isProxySign ? 'Proxy Sign Actuals' : 'Sign Actuals'}</DialogTitle>
            <DialogContent>
              {isProxySign ? (
                <>
                  <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
                    <MessageBarBody>
                      You are signing on behalf of an absent employee. This action will be audited.
                    </MessageBarBody>
                  </MessageBar>
                  <div className={styles.formField}>
                    <label>Reason for proxy signing (required)</label>
                    <Textarea
                      value={proxyReason}
                      onChange={(_, data) => setProxyReason(data.value)}
                      placeholder="e.g., Employee on extended leave"
                    />
                  </div>
                </>
              ) : (
                <Body1>
                  Confirm that the actuals are accurate and ready for approval.
                </Body1>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setIsSignDialogOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleSign}>
                {isProxySign ? 'Proxy Sign' : 'Sign'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};

export default Actuals;
