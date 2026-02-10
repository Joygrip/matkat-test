/**
 * Consolidation Page
 * 
 * Finance: View dashboard, manage periods, publish snapshots
 */
import React, { useState, useEffect } from 'react';
import {
  Title1,
  Body1,
  Card,
  CardHeader,
  Button,
  Spinner,
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
  MessageBar,
  MessageBarBody,
  Input,
  Textarea,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Tab,
  TabList,
} from '@fluentui/react-components';
import { 
  ArrowDownload24Regular,
  DocumentBulletList24Regular,
  Warning24Regular,
  CheckmarkCircle24Regular,
} from '@fluentui/react-icons';
import { consolidationApi, ConsolidationDashboard, Snapshot } from '../api/consolidation';
import { periodsApi, Period } from '../api/periods';
import { PeriodPanel } from '../components/PeriodPanel';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1400px',
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalXL,
  },
  card: {
    marginBottom: tokens.spacingVerticalL,
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  statCard: {
    padding: tokens.spacingVerticalL,
    textAlign: 'center',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statNumber: {
    fontSize: '2rem',
    fontWeight: 'bold',
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
  table: {
    width: '100%',
  },
  formField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
});

export const Consolidation: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showError, showApiError } = useToast();
  
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [dashboard, setDashboard] = useState<ConsolidationDashboard | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  
  // Publish dialog state
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [publishName, setPublishName] = useState('');
  const [publishDescription, setPublishDescription] = useState('');
  
  useEffect(() => {
    loadPeriods();
  }, []);
  
  useEffect(() => {
    if (selectedPeriod) {
      loadDashboard();
      loadSnapshots();
    }
  }, [selectedPeriod]);
  
  const loadPeriods = async () => {
    try {
      const data = await periodsApi.list();
      setPeriods(data);
      
      if (data.length > 0) {
        const openPeriod = data.find((p: Period) => p.status === 'open');
        setSelectedPeriod(openPeriod?.id || data[0].id);
      }
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load periods'));
    } finally {
      setLoading(false);
    }
  };
  
  const loadDashboard = async () => {
    try {
      const data = await consolidationApi.getDashboard(selectedPeriod);
      setDashboard(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load dashboard');
    }
  };
  
  const loadSnapshots = async () => {
    try {
      const data = await consolidationApi.getSnapshots(selectedPeriod);
      setSnapshots(data);
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to load snapshots');
    }
  };
  
  const handlePublish = async () => {
    if (!publishName.trim()) {
      showError('Name is required');
      return;
    }
    
    try {
      await consolidationApi.publishSnapshot(selectedPeriod, publishName, publishDescription || undefined);
      showSuccess('Snapshot published successfully');
      setIsPublishDialogOpen(false);
      setPublishName('');
      setPublishDescription('');
      loadSnapshots();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to publish snapshot');
    }
  };
  
  const currentPeriod = periods.find(p => p.id === selectedPeriod);
  
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
        <div>
          <Title1>Consolidation</Title1>
          <Body1>Finance dashboard and snapshot management</Body1>
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
          
          <Dialog open={isPublishDialogOpen} onOpenChange={(_, data) => setIsPublishDialogOpen(data.open)}>
            <DialogTrigger>
              <Button appearance="primary" icon={<ArrowDownload24Regular />}>
                Publish Snapshot
              </Button>
            </DialogTrigger>
            <DialogSurface>
              <DialogBody>
                <DialogTitle>Publish Snapshot</DialogTitle>
                <DialogContent>
                  <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalM }}>
                    <MessageBarBody>
                      A snapshot is an immutable copy of planning data at this point in time.
                    </MessageBarBody>
                  </MessageBar>
                  
                  <div className={styles.formField}>
                    <label>Snapshot Name *</label>
                    <Input
                      value={publishName}
                      onChange={(_, data) => setPublishName(data.value)}
                      placeholder={`${currentPeriod?.year}-${String(currentPeriod?.month).padStart(2, '0')} Final`}
                    />
                  </div>
                  
                  <div className={styles.formField}>
                    <label>Description</label>
                    <Textarea
                      value={publishDescription}
                      onChange={(_, data) => setPublishDescription(data.value)}
                      placeholder="Optional description..."
                    />
                  </div>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setIsPublishDialogOpen(false)}>Cancel</Button>
                  <Button appearance="primary" onClick={handlePublish}>Publish</Button>
                </DialogActions>
              </DialogBody>
            </DialogSurface>
          </Dialog>
        </div>
      </div>
      
      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      
      {/* Period Panel */}
      <PeriodPanel />
      
      <TabList 
        selectedValue={activeTab} 
        onTabSelect={(_, data) => setActiveTab(data.value as string)}
        style={{ marginBottom: tokens.spacingVerticalL }}
      >
        <Tab value="dashboard" icon={<DocumentBulletList24Regular />}>Dashboard</Tab>
        <Tab value="snapshots" icon={<ArrowDownload24Regular />}>Snapshots</Tab>
      </TabList>
      
      {activeTab === 'dashboard' && dashboard && (
        <>
          {/* Stats Grid */}
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <div className={styles.statNumber}>{dashboard.summary.total_resources}</div>
              <Body1>Resources</Body1>
            </div>
            <div className={styles.statCard} style={{ 
              backgroundColor: dashboard.summary.gaps_count > 0 
                ? tokens.colorPaletteYellowBackground2 
                : tokens.colorPaletteGreenBackground2 
            }}>
              <div className={styles.statNumber}>{dashboard.summary.gaps_count}</div>
              <Body1>Gaps</Body1>
            </div>
            <div className={styles.statCard} style={{ 
              backgroundColor: dashboard.summary.orphans_count > 0 
                ? tokens.colorPaletteDarkOrangeBackground2 
                : tokens.colorPaletteGreenBackground2 
            }}>
              <div className={styles.statNumber}>{dashboard.summary.orphans_count}</div>
              <Body1>Orphan Demands</Body1>
            </div>
            <div className={styles.statCard} style={{ 
              backgroundColor: dashboard.summary.over_allocations_count > 0 
                ? tokens.colorPaletteRedBackground2 
                : tokens.colorPaletteGreenBackground2 
            }}>
              <div className={styles.statNumber}>{dashboard.summary.over_allocations_count}</div>
              <Body1>Over-allocations</Body1>
            </div>
          </div>
          
          {/* Gaps Table */}
          <Card className={styles.card}>
            <CardHeader 
              header={<Body1><strong>Demand/Supply Gaps</strong></Body1>}
              action={dashboard.gaps.length === 0 ? <CheckmarkCircle24Regular color={tokens.colorPaletteGreenForeground1} /> : undefined}
            />
            {dashboard.gaps.length > 0 ? (
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Resource</TableHeaderCell>
                    <TableHeaderCell>Period</TableHeaderCell>
                    <TableHeaderCell>Demand</TableHeaderCell>
                    <TableHeaderCell>Supply</TableHeaderCell>
                    <TableHeaderCell>Gap</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.gaps.map((gap, i) => (
                    <TableRow key={i}>
                      <TableCell>{gap.resource_name}</TableCell>
                      <TableCell>{gap.year}-{String(gap.month).padStart(2, '0')}</TableCell>
                      <TableCell>{gap.demand_fte}%</TableCell>
                      <TableCell>{gap.supply_fte}%</TableCell>
                      <TableCell>
                        <Badge 
                          appearance="filled" 
                          color={gap.gap_fte < 0 ? 'danger' : 'success'}
                        >
                          {gap.gap_fte > 0 ? '+' : ''}{gap.gap_fte}%
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge appearance="outline" color={gap.status === 'under' ? 'danger' : 'warning'}>
                          {gap.status === 'under' ? 'Under-staffed' : 'Over-staffed'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div style={{ padding: tokens.spacingVerticalL, textAlign: 'center' }}>
                <Body1>No gaps - demand and supply are balanced!</Body1>
              </div>
            )}
          </Card>
          
          {/* Orphan Demands */}
          {dashboard.orphan_demands.length > 0 && (
            <Card className={styles.card}>
              <CardHeader 
                header={<Body1><strong>Orphan Demands (Placeholders)</strong></Body1>}
                action={<Warning24Regular color={tokens.colorPaletteDarkOrangeForeground1} />}
              />
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Project</TableHeaderCell>
                    <TableHeaderCell>Placeholder</TableHeaderCell>
                    <TableHeaderCell>Period</TableHeaderCell>
                    <TableHeaderCell>FTE</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.orphan_demands.map(orphan => (
                    <TableRow key={orphan.demand_line_id}>
                      <TableCell>{orphan.project_name}</TableCell>
                      <TableCell>
                        <Badge appearance="outline" color="warning">{orphan.placeholder_name}</Badge>
                      </TableCell>
                      <TableCell>{orphan.year}-{String(orphan.month).padStart(2, '0')}</TableCell>
                      <TableCell>{orphan.fte_percent}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
          
          {/* Over-allocations */}
          {dashboard.over_allocations.length > 0 && (
            <Card className={styles.card}>
              <CardHeader 
                header={<Body1><strong>Over-allocations (&gt;100%)</strong></Body1>}
                action={<Warning24Regular color={tokens.colorPaletteRedForeground1} />}
              />
              <Table className={styles.table}>
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell>Resource</TableHeaderCell>
                    <TableHeaderCell>Period</TableHeaderCell>
                    <TableHeaderCell>Total Demand</TableHeaderCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.over_allocations.map((oa, i) => (
                    <TableRow key={i}>
                      <TableCell>{oa.resource_name}</TableCell>
                      <TableCell>{oa.year}-{String(oa.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="danger">{oa.total_demand_fte}%</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
      
      {activeTab === 'snapshots' && (
        <Card className={styles.card}>
          <CardHeader header={<Body1><strong>Published Snapshots</strong></Body1>} />
          {snapshots.length > 0 ? (
            <Table className={styles.table}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Description</TableHeaderCell>
                  <TableHeaderCell>Lines</TableHeaderCell>
                  <TableHeaderCell>Published At</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map(snapshot => (
                  <TableRow key={snapshot.id}>
                    <TableCell><strong>{snapshot.name}</strong></TableCell>
                    <TableCell>{snapshot.description || '-'}</TableCell>
                    <TableCell>{snapshot.lines_count}</TableCell>
                    <TableCell>{new Date(snapshot.published_at).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div style={{ padding: tokens.spacingVerticalL, textAlign: 'center' }}>
              <Body1>No snapshots published for this period yet.</Body1>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

export default Consolidation;
