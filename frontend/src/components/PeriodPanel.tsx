/**
 * Period management panel for Finance users.
 */
import { useState, useEffect } from 'react';
import {
  Card,
  Title3,
  Body1,
  Button,
  Badge,
  Spinner,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Input,
  Label,
  makeStyles,
  tokens,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
} from '@fluentui/react-components';
import {
  LockClosedRegular,
  LockOpenRegular,
  AddRegular,
} from '@fluentui/react-icons';
import { Period } from '../types';
import { periodsApi } from '../api/periods';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../auth/AuthProvider';

const useStyles = makeStyles({
  card: {
    padding: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
  },
  status: {
    textTransform: 'capitalize',
  },
  dialogField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
});

const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function PeriodPanel() {
  const styles = useStyles();
  const { showSuccess, showApiError } = useToast();
  const { user } = useAuth();
  
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  
  // Dialog state
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedPeriod, setSelectedPeriod] = useState<Period | null>(null);
  const [unlockReason, setUnlockReason] = useState('');
  const [newPeriodYear, setNewPeriodYear] = useState(new Date().getFullYear());
  const [newPeriodMonth, setNewPeriodMonth] = useState(new Date().getMonth() + 1);
  
  const isFinanceOrAdmin = user?.role === 'Finance' || user?.role === 'Admin';
  
  useEffect(() => {
    loadPeriods();
  }, []);
  
  const loadPeriods = async () => {
    try {
      const data = await periodsApi.list();
      setPeriods(data);
    } catch (error) {
      showApiError(error as Error, 'Failed to load periods');
    } finally {
      setLoading(false);
    }
  };
  
  const handleLock = async (period: Period) => {
    setActionLoading(period.id);
    try {
      await periodsApi.lock(period.id);
      showSuccess('Period Locked', `${monthNames[period.month - 1]} ${period.year} has been locked.`);
      loadPeriods();
    } catch (error) {
      showApiError(error as Error, 'Failed to lock period');
    } finally {
      setActionLoading(null);
    }
  };
  
  const handleUnlockClick = (period: Period) => {
    setSelectedPeriod(period);
    setUnlockReason('');
    setUnlockDialogOpen(true);
  };
  
  const handleUnlockConfirm = async () => {
    if (!selectedPeriod || !unlockReason.trim()) return;
    
    setActionLoading(selectedPeriod.id);
    setUnlockDialogOpen(false);
    
    try {
      await periodsApi.unlock(selectedPeriod.id, unlockReason);
      showSuccess('Period Unlocked', `${monthNames[selectedPeriod.month - 1]} ${selectedPeriod.year} has been unlocked.`);
      loadPeriods();
    } catch (error) {
      showApiError(error as Error, 'Failed to unlock period');
    } finally {
      setActionLoading(null);
      setSelectedPeriod(null);
    }
  };
  
  const handleCreatePeriod = async () => {
    setCreateDialogOpen(false);
    setActionLoading('create');
    
    try {
      await periodsApi.create(newPeriodYear, newPeriodMonth);
      showSuccess('Period Created', `${monthNames[newPeriodMonth - 1]} ${newPeriodYear} has been created.`);
      loadPeriods();
    } catch (error) {
      showApiError(error as Error, 'Failed to create period');
    } finally {
      setActionLoading(null);
    }
  };
  
  if (loading) {
    return <Spinner label="Loading periods..." />;
  }
  
  return (
    <>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Title3>Period Management</Title3>
          {isFinanceOrAdmin && (
            <Button
              appearance="primary"
              icon={<AddRegular />}
              onClick={() => setCreateDialogOpen(true)}
              disabled={actionLoading === 'create'}
            >
              Create Period
            </Button>
          )}
        </div>
        
        {periods.length === 0 ? (
          <Body1>No periods found. Create one to get started.</Body1>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Period</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Locked At</TableHeaderCell>
                {isFinanceOrAdmin && <TableHeaderCell>Actions</TableHeaderCell>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map((period) => (
                <TableRow key={period.id}>
                  <TableCell>
                    {monthNames[period.month - 1]} {period.year}
                  </TableCell>
                  <TableCell>
                    <Badge
                      appearance="filled"
                      color={period.status === 'locked' ? 'danger' : 'success'}
                      className={styles.status}
                    >
                      {period.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {period.locked_at
                      ? new Date(period.locked_at).toLocaleString()
                      : '-'}
                  </TableCell>
                  {isFinanceOrAdmin && (
                    <TableCell>
                      <div className={styles.actions}>
                        {period.status === 'open' ? (
                          <Button
                            appearance="subtle"
                            icon={<LockClosedRegular />}
                            onClick={() => handleLock(period)}
                            disabled={actionLoading === period.id}
                          >
                            Lock
                          </Button>
                        ) : (
                          <Button
                            appearance="subtle"
                            icon={<LockOpenRegular />}
                            onClick={() => handleUnlockClick(period)}
                            disabled={actionLoading === period.id}
                          >
                            Unlock
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      
      {/* Unlock Dialog */}
      <Dialog open={unlockDialogOpen} onOpenChange={(_, data) => setUnlockDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Unlock Period</DialogTitle>
            <DialogContent>
              <Body1 style={{ marginBottom: tokens.spacingVerticalM }}>
                You are about to unlock{' '}
                <strong>
                  {selectedPeriod && `${monthNames[selectedPeriod.month - 1]} ${selectedPeriod.year}`}
                </strong>
                . Please provide a reason.
              </Body1>
              <div className={styles.dialogField}>
                <Label required htmlFor="unlock-reason">
                  Reason for unlocking
                </Label>
                <Input
                  id="unlock-reason"
                  value={unlockReason}
                  onChange={(_, data) => setUnlockReason(data.value)}
                  placeholder="e.g., Need to correct actuals for Project X"
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setUnlockDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={handleUnlockConfirm}
                disabled={!unlockReason.trim()}
              >
                Unlock Period
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      
      {/* Create Period Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(_, data) => setCreateDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Create New Period</DialogTitle>
            <DialogContent>
              <div className={styles.dialogField}>
                <Label htmlFor="period-year">Year</Label>
                <Input
                  id="period-year"
                  type="number"
                  value={String(newPeriodYear)}
                  onChange={(_, data) => setNewPeriodYear(Number(data.value))}
                />
              </div>
              <div className={styles.dialogField}>
                <Label htmlFor="period-month">Month</Label>
                <Input
                  id="period-month"
                  type="number"
                  min={1}
                  max={12}
                  value={String(newPeriodMonth)}
                  onChange={(_, data) => setNewPeriodMonth(Number(data.value))}
                />
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleCreatePeriod}>
                Create Period
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
