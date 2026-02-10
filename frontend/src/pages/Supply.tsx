/**
 * Supply Planning Page
 * 
 * RO role: Create and edit supply lines (resource availability)
 * Finance/Admin/PM: Read-only view
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
} from '@fluentui/react-components';
import { Add24Regular, Delete24Regular } from '@fluentui/react-icons';
import { planningApi, SupplyLine, CreateSupplyLine } from '../api/planning';
import { periodsApi, Period } from '../api/periods';
import { lookupsApi, Resource } from '../api/lookups';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';
import { ReadOnlyBanner } from '../components/ReadOnlyBanner';

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
});

export const Supply: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showError } = useToast();
  const { user } = useAuth();
  
  const [supplies, setSupplies] = useState<SupplyLine[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Form state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateSupplyLine>({
    period_id: '',
    resource_id: '',
    fte_percent: 100,
  });
  
  useEffect(() => {
    loadInitialData();
  }, []);
  
  useEffect(() => {
    if (selectedPeriod) {
      loadSupplies();
    }
  }, [selectedPeriod]);
  
  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [periodsData, resourcesData] = await Promise.all([
        periodsApi.list(),
        lookupsApi.listResources(),
      ]);
      
      setPeriods(periodsData);
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
  
  const loadSupplies = async () => {
    try {
      const data = await planningApi.getSupplyLines(selectedPeriod);
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
    if (!selectedPeriod) {
      showError('Missing period', 'Please select a period.');
      return;
    }
    const currentPeriod = periods.find(p => p.id === selectedPeriod);
    if (!currentPeriod) {
      showError('Invalid period', 'Selected period not found.');
      return;
    }
    try {
      await planningApi.createSupplyLine({
        period_id: selectedPeriod,
        resource_id: formData.resource_id,
        fte_percent: formData.fte_percent,
        year: currentPeriod.year,
        month: currentPeriod.month,
      });
      showSuccess('Supply line created');
      setIsDialogOpen(false);
      loadSupplies();
      
      // Reset form
      setFormData({
        period_id: selectedPeriod,
        resource_id: '',
        fte_percent: 100,
      });
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
  
  const getResourceName = (id: string) => resources.find(r => r.id === id)?.display_name || 'Unknown';
  
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const currentPeriod = periods.find(p => p.id === selectedPeriod);
  const isLocked = currentPeriod?.status === 'locked';
  const canEdit = user?.role === 'RO' || user?.role === 'Finance';
  const isReadOnly = user?.role === 'PM' || user?.role === 'Admin';
  
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
          <h1 className={styles.pageTitle}>Supply Planning</h1>
          <p className={styles.pageSubtitle}>Manage resource availability</p>
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
                  Add Supply
                </Button>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>Add Supply Line</DialogTitle>
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
                    
                    <div className={styles.formField} style={{ marginTop: tokens.spacingVerticalM }}>
                      <label>FTE %</label>
                      <Select
                        value={String(formData.fte_percent)}
                        onChange={(_, data) => setFormData({ ...formData, fte_percent: parseInt(data.value || '100') })}
                      >
                        {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100].map(val => (
                          <option key={val} value={val}>{val}%</option>
                        ))}
                      </Select>
                    </div>
                    
                    <MessageBar intent="info" style={{ marginTop: tokens.spacingVerticalM }}>
                      <MessageBarBody>Supply indicates resource availability (100% = full time)</MessageBarBody>
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
      
      {isReadOnly && !isLocked && (
        <ReadOnlyBanner message="Only ROs and Finance can edit supply lines. You can view all supply data." />
      )}
      
      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      
      <Card className={styles.card}>
        <CardHeader header={<Body1><strong>Supply Lines ({supplies.length})</strong></Body1>} />
        
        <Table className={styles.table}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Resource</TableHeaderCell>
              <TableHeaderCell>Period</TableHeaderCell>
              <TableHeaderCell>FTE %</TableHeaderCell>
              <TableHeaderCell>Actions</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplies.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Body1>No supply lines for this period</Body1>
                </TableCell>
              </TableRow>
            ) : (
              supplies.map(s => (
                <TableRow key={s.id}>
                  <TableCell>{getResourceName(s.resource_id)}</TableCell>
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
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
};

export default Supply;
