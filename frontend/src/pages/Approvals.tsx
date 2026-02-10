/**
 * Approvals Page
 * 
 * RO/Director: View and action pending approvals
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
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  MessageBar,
  MessageBarBody,
  Textarea,
  Accordion,
  AccordionItem,
  AccordionHeader,
  AccordionPanel,
} from '@fluentui/react-components';
import { 
  Checkmark24Regular, 
  Dismiss24Regular,
  Clock24Regular,
  CheckmarkCircle24Regular,
  DismissCircle24Regular,
  ArrowForward24Regular,
  ArrowClockwise24Regular,
} from '@fluentui/react-icons';
import { approvalsApi, ApprovalInstance, ApprovalStep } from '../api/approvals';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '1400px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },
  header: {
    marginBottom: tokens.spacingVerticalXXL,
    paddingBottom: tokens.spacingVerticalL,
    borderBottom: `2px solid ${tokens.colorNeutralStroke2}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
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
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
  approvalItem: {
    padding: tokens.spacingHorizontalL,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  stepFlow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalL,
    marginBottom: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    transition: 'all 0.2s ease',
    minWidth: '120px',
    justifyContent: 'center',
  },
  stepApproved: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground1,
    border: `1px solid ${tokens.colorPaletteGreenBorderActive}`,
  },
  stepRejected: {
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1,
    border: `1px solid ${tokens.colorPaletteRedBorderActive}`,
  },
  stepPending: {
    backgroundColor: tokens.colorPaletteYellowBackground2,
    color: tokens.colorPaletteYellowForeground1,
    border: `1px solid ${tokens.colorPaletteYellowBorderActive}`,
    animation: 'pulse 2s ease-in-out infinite',
  },
  stepSkipped: {
    backgroundColor: tokens.colorNeutralBackground4,
    color: tokens.colorNeutralForeground3,
    opacity: 0.6,
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
    marginTop: tokens.spacingVerticalL,
    paddingTop: tokens.spacingVerticalM,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
  },
  emptyState: {
    padding: tokens.spacingVerticalXXL,
    textAlign: 'center',
  },
  emptyStateIcon: {
    fontSize: '64px',
    color: tokens.colorPaletteGreenForeground1,
    marginBottom: tokens.spacingVerticalM,
    opacity: 0.8,
  },
  stepDetails: {
    marginTop: tokens.spacingVerticalM,
    padding: tokens.spacingVerticalM,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stepDetailItem: {
    padding: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    '&:last-child': {
      borderBottom: 'none',
    },
  },
  '@keyframes pulse': {
    '0%, 100%': {
      opacity: 1,
    },
    '50%': {
      opacity: 0.7,
    },
  },
});

const getStepIcon = (status: string) => {
  switch (status) {
    case 'approved':
      return <CheckmarkCircle24Regular />;
    case 'rejected':
      return <DismissCircle24Regular />;
    case 'skipped':
      return <ArrowForward24Regular />;
    default:
      return <Clock24Regular />;
  }
};

const getStepClass = (styles: ReturnType<typeof useStyles>, status: string) => {
  switch (status) {
    case 'approved':
      return `${styles.step} ${styles.stepApproved}`;
    case 'rejected':
      return `${styles.step} ${styles.stepRejected}`;
    case 'skipped':
      return `${styles.step} ${styles.stepSkipped}`;
    default:
      return `${styles.step} ${styles.stepPending}`;
  }
};

export const Approvals: React.FC = () => {
  const styles = useStyles();
  const { showSuccess, showApiError, showWarning } = useToast();
  const { user } = useAuth();
  
  const [approvals, setApprovals] = useState<ApprovalInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Action dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedApproval, setSelectedApproval] = useState<ApprovalInstance | null>(null);
  const [selectedStep, setSelectedStep] = useState<ApprovalStep | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject' | 'proxy-approve'>('approve');
  const [comment, setComment] = useState('');
  
  useEffect(() => {
    loadApprovals();
  }, []);
  
  const loadApprovals = async () => {
    try {
      setLoading(true);
      const data = await approvalsApi.getInbox();
      console.log('[Approvals] Loaded approvals:', data);
      console.log('[Approvals] First approval:', data[0]);
      if (data[0]) {
        console.log('[Approvals] Resource name:', data[0].resource_name);
        console.log('[Approvals] Project name:', data[0].project_name);
        console.log('[Approvals] Period label:', data[0].period_label);
      }
      setApprovals(data);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load approvals'));
    } finally {
      setLoading(false);
    }
  };
  
  const openActionDialog = (approval: ApprovalInstance, step: ApprovalStep, action: 'approve' | 'reject' | 'proxy-approve') => {
    setSelectedApproval(approval);
    setSelectedStep(step);
    setActionType(action);
    setComment('');
    setIsDialogOpen(true);
  };
  
  const handleAction = async () => {
    if (!selectedApproval || !selectedStep) return;
    
    // Proxy approval requires comment
    if (actionType === 'proxy-approve' && (!comment || !comment.trim())) {
      showApiError(new Error('Explanation is required for proxy approval'), 'Validation Error');
      return;
    }
    
    try {
      setLoading(true);
      if (actionType === 'approve') {
        await approvalsApi.approveStep(selectedApproval.id, selectedStep.id, comment || undefined);
        showSuccess('Approved successfully');
      } else if (actionType === 'proxy-approve') {
        await approvalsApi.proxyApproveDirectorStep(selectedApproval.id, selectedStep.id, comment);
        showSuccess('Proxy-approved successfully');
      } else {
        await approvalsApi.rejectStep(selectedApproval.id, selectedStep.id, comment || undefined);
        showWarning('Rejected');
      }
      
      setIsDialogOpen(false);
      setSelectedApproval(null);
      setSelectedStep(null);
      setComment('');
      // Reload approvals to get updated state
      await loadApprovals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to update approval');
    } finally {
      setLoading(false);
    }
  };
  
  const getCurrentStep = (approval: ApprovalInstance): ApprovalStep | null => {
    return approval.steps.find(s => s.status === 'pending') || null;
  };
  
  const getRoStep = (approval: ApprovalInstance): ApprovalStep | null => {
    return approval.steps.find(s => s.step_name === 'RO') || null;
  };
  
  const getDirectorStep = (approval: ApprovalInstance): ApprovalStep | null => {
    return approval.steps.find(s => s.step_name === 'Director') || null;
  };
  
  const canProxyApprove = (approval: ApprovalInstance): boolean => {
    if (user?.role !== 'RO') return false;
    const roStep = getRoStep(approval);
    const directorStep = getDirectorStep(approval);
    // RO can proxy-approve if RO step is approved and Director step is pending
    return roStep?.status === 'approved' && directorStep?.status === 'pending';
  };
  
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
          <h1 className={styles.pageTitle}>Approvals</h1>
          <p className={styles.pageSubtitle}>Review and action pending approvals</p>
        </div>
        <Button
          icon={<ArrowClockwise24Regular />}
          appearance="subtle"
          onClick={loadApprovals}
          title="Refresh"
        >
          Refresh
        </Button>
      </div>
      
      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      
      {approvals.length === 0 ? (
        <Card className={styles.card}>
          <div className={styles.emptyState}>
            <CheckmarkCircle24Regular className={styles.emptyStateIcon} />
            <Title1 style={{ marginTop: tokens.spacingVerticalM, marginBottom: tokens.spacingVerticalXS }}>All caught up!</Title1>
            <Body1 style={{ color: tokens.colorNeutralForeground3 }}>No pending approvals in your inbox.</Body1>
          </div>
        </Card>
      ) : (
        <Card className={styles.card}>
          <CardHeader header={<Body1><strong>Pending Approvals ({approvals.length})</strong></Body1>} />
          
          <Accordion collapsible>
            {approvals.map(approval => {
              const currentStep = getCurrentStep(approval);
              
              return (
                <AccordionItem key={approval.id} value={approval.id}>
                  <AccordionHeader>
                    <div style={{ display: 'flex', alignItems: 'center', gap: tokens.spacingHorizontalM, width: '100%' }}>
                      <Badge appearance="outline">
                        {approval.subject_type}
                      </Badge>
                      {approval.resource_name ? (
                        <Body1>
                          <strong>{approval.resource_name}</strong>
                          {approval.project_name && ` - ${approval.project_name}`}
                          {approval.period_label && ` (${approval.period_label})`}
                        </Body1>
                      ) : approval.subject_type === 'actuals' ? (
                        <Body1 style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                          Actuals (ID: {approval.subject_id.substring(0, 8)}...)
                        </Body1>
                      ) : (
                        <Body1>{approval.subject_id}</Body1>
                      )}
                      {user?.role === 'Director' && getRoStep(approval)?.status === 'pending' && (
                        <Badge appearance="outline" color="informative">
                          Awaiting RO Approval
                        </Badge>
                      )}
                      <Badge 
                        appearance="filled" 
                        color={approval.status === 'approved' ? 'success' : approval.status === 'rejected' ? 'danger' : 'warning'}
                      >
                        {approval.status}
                      </Badge>
                    </div>
                  </AccordionHeader>
                  <AccordionPanel>
                    <div className={styles.approvalItem}>
                      <Body1 style={{ color: tokens.colorNeutralForeground3, marginBottom: tokens.spacingVerticalM }}>
                        Created: {new Date(approval.created_at).toLocaleString()}
                      </Body1>
                      
                      {/* Step flow visualization */}
                      <div className={styles.stepFlow}>
                        {approval.steps.map((step, index) => (
                          <React.Fragment key={step.id}>
                            <div className={getStepClass(styles, step.status)}>
                              {getStepIcon(step.status)}
                              <span>{step.step_name}</span>
                            </div>
                            {index < approval.steps.length - 1 && (
                              <ArrowForward24Regular style={{ color: tokens.colorNeutralForeground3 }} />
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                      
                      {/* Step details */}
                      <div className={styles.stepDetails}>
                        {approval.steps.map(step => (
                          <div key={step.id} className={styles.stepDetailItem}>
                            <Body1>
                              <strong style={{ color: tokens.colorNeutralForeground1 }}>{step.step_name}:</strong>{' '}
                              <Badge 
                                appearance="filled" 
                                color={step.status === 'approved' ? 'success' : step.status === 'rejected' ? 'danger' : 'warning'}
                                style={{ marginLeft: tokens.spacingHorizontalS }}
                              >
                                {step.status}
                              </Badge>
                              {step.actioned_at && (
                                <span style={{ color: tokens.colorNeutralForeground3, marginLeft: tokens.spacingHorizontalM }}>
                                  {new Date(step.actioned_at).toLocaleString()}
                                </span>
                              )}
                            </Body1>
                            {step.comment && (
                              <Body1 style={{ marginTop: tokens.spacingVerticalXS, color: tokens.colorNeutralForeground2, fontStyle: 'italic' }}>
                                "{step.comment}"
                              </Body1>
                            )}
                          </div>
                        ))}
                      </div>
                      
                      {/* Action buttons for current step */}
                      {currentStep && (
                        <div className={styles.actions}>
                          <Button 
                            appearance="primary" 
                            icon={<Checkmark24Regular />}
                            onClick={() => openActionDialog(approval, currentStep, 'approve')}
                          >
                            Approve
                          </Button>
                          <Button 
                            appearance="secondary" 
                            icon={<Dismiss24Regular />}
                            onClick={() => openActionDialog(approval, currentStep, 'reject')}
                          >
                            Reject
                          </Button>
                        </div>
                      )}
                      
                      {/* Proxy approve button for RO when Director step is pending */}
                      {canProxyApprove(approval) && (
                        <div className={styles.actions} style={{ marginTop: tokens.spacingVerticalM }}>
                          <MessageBar intent="info" style={{ marginBottom: tokens.spacingVerticalS }}>
                            <MessageBarBody>
                              RO step is approved. You can proxy-approve the Director step with an explanation.
                            </MessageBarBody>
                          </MessageBar>
                          <Button 
                            appearance="primary" 
                            icon={<Checkmark24Regular />}
                            onClick={() => {
                              const directorStep = getDirectorStep(approval);
                              if (directorStep) {
                                openActionDialog(approval, directorStep, 'proxy-approve');
                              }
                            }}
                          >
                            Proxy-Approve Director Step
                          </Button>
                        </div>
                      )}
                    </div>
                  </AccordionPanel>
                </AccordionItem>
              );
            })}
          </Accordion>
        </Card>
      )}
      
      {/* Action Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={(_, data) => setIsDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {actionType === 'approve' ? 'Approve' : actionType === 'proxy-approve' ? 'Proxy-Approve Director Step' : 'Reject'} - {selectedStep?.step_name}
            </DialogTitle>
            <DialogContent>
              {actionType === 'proxy-approve' && (
                <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
                  <MessageBarBody>
                    You are approving the Director step on behalf of the Director. An explanation is required.
                  </MessageBarBody>
                </MessageBar>
              )}
              {actionType === 'reject' && (
                <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
                  <MessageBarBody>
                    Rejecting will close this approval and return it to the submitter.
                  </MessageBarBody>
                </MessageBar>
              )}
              <Textarea
                placeholder={actionType === 'proxy-approve' ? 'Explanation (required)' : 'Add a comment (optional)'}
                value={comment}
                onChange={(_, data) => setComment(data.value)}
                style={{ width: '100%', minHeight: '100px' }}
                required={actionType === 'proxy-approve'}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button 
                appearance="primary" 
                onClick={handleAction}
                style={actionType === 'reject' ? { backgroundColor: tokens.colorPaletteRedBackground3 } : undefined}
                disabled={actionType === 'proxy-approve' && (!comment || !comment.trim())}
              >
                {actionType === 'approve' ? 'Approve' : actionType === 'proxy-approve' ? 'Proxy-Approve' : 'Reject'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};

export default Approvals;
