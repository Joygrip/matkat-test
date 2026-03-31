/**
 * Approvals Page
 *
 * RO/Director: View and action pending approvals
 */
import React, { useState, useEffect } from 'react';
import {
  Body1,
  Body2,
  Caption1,
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
  mergeClasses,
} from '@fluentui/react-components';
import {
  Checkmark24Regular,
  Dismiss24Regular,
  Clock24Regular,
  CheckmarkCircle24Filled,
  DismissCircle24Filled,
  ArrowForward24Regular,
  ArrowClockwise24Regular,
  ClipboardCheckmark24Regular,
} from '@fluentui/react-icons';
import { approvalsApi, ApprovalInstance, ApprovalStep } from '../api/approvals';
import { useToast } from '../hooks/useToast';
import { formatApiError } from '../utils/errors';
import { useAuth } from '../auth/AuthProvider';
import { PageHeader } from '../components/PageHeader';

const useStyles = makeStyles({
  container: {
    padding: tokens.spacingHorizontalXXL,
    maxWidth: '900px',
    margin: '0 auto',
    minHeight: 'calc(100vh - 80px)',
  },

  // ── List ──────────────────────────────────────────────────────────────
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },

  // ── Approval Card ─────────────────────────────────────────────────────
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    overflow: 'hidden',
    transition: 'box-shadow 0.15s ease',
    '&:hover': {
      boxShadow: tokens.shadow8,
    },
  },

  // title bar at top of card
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    flexWrap: 'wrap',
  },
  cardTitle: {
    flex: 1,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    color: tokens.colorNeutralForeground1,
  },

  // subtitle / meta below the title bar
  cardMeta: {
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  cardMetaText: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },

  // ── Stepper ───────────────────────────────────────────────────────────
  stepperSection: {
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  stepperLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: tokens.spacingVerticalM,
  },
  stepper: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0',
  },
  stepWrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    flex: '0 0 auto',
    minWidth: '120px',
  },
  stepConnectorWrapper: {
    flex: '1 1 auto',
    display: 'flex',
    alignItems: 'center',
    paddingTop: '14px', // align with centre of the node circle
  },
  stepConnectorLine: {
    flex: 1,
    height: '2px',
    backgroundColor: tokens.colorNeutralStroke2,
  },
  stepConnectorLineDone: {
    backgroundColor: tokens.colorPaletteGreenBorderActive,
  },
  stepIcon: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `2px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
    fontSize: '18px',
  },
  stepIconDone: {
    border: `2px solid ${tokens.colorPaletteGreenBorderActive}`,
    backgroundColor: tokens.colorPaletteGreenBackground2,
    color: tokens.colorPaletteGreenForeground1,
  },
  stepIconRejected: {
    border: `2px solid ${tokens.colorPaletteRedBorderActive}`,
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorPaletteRedForeground1,
  },
  stepIconPending: {
    border: `2px solid ${tokens.colorBrandStroke1}`,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  stepIconSkipped: {
    opacity: 0.45,
  },
  stepName: {
    marginTop: tokens.spacingVerticalXS,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textAlign: 'center',
  },
  stepStatus: {
    marginTop: '2px',
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
  },
  stepComment: {
    marginTop: '2px',
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    textAlign: 'center',
    maxWidth: '110px',
    fontStyle: 'italic',
    wordBreak: 'break-word',
  },

  // ── Action footer ─────────────────────────────────────────────────────
  actionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  actionBarSpacer: {
    flex: 1,
  },

  // proxy-approve inline notice
  proxyNotice: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground2,
  },

  // ── Loading / Empty / Error ───────────────────────────────────────────
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
  emptyCard: {
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalXXL}`,
    gap: tokens.spacingVerticalM,
    textAlign: 'center',
    minHeight: '240px',
  },
  emptyIcon: {
    fontSize: '48px',
    color: tokens.colorPaletteGreenForeground1,
    opacity: 0.8,
  },

  // ── Reject button tint ────────────────────────────────────────────────
  rejectBtn: {
    color: tokens.colorPaletteRedForeground1,
  },

  '@keyframes pulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.55 },
  },
  pendingPulse: {
    animationName: 'pulse',
    animationDuration: '2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite',
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function buildTitle(approval: ApprovalInstance): string {
  if (approval.resource_name) {
    let t = approval.resource_name;
    if (approval.project_name) t += ` – ${approval.project_name}`;
    if (approval.period_label) t += ` (${approval.period_label})`;
    return t;
  }
  if (approval.subject_type === 'actuals') {
    return `Actuals (${approval.subject_id.substring(0, 8)}…)`;
  }
  return approval.subject_id;
}

function overallStatusColor(status: string): 'success' | 'danger' | 'warning' | 'informative' {
  if (status === 'approved') return 'success';
  if (status === 'rejected') return 'danger';
  return 'warning';
}

// ── Stepper node ───────────────────────────────────────────────────────────────

interface StepNodeProps {
  step: ApprovalStep;
  styles: ReturnType<typeof useStyles>;
}

function StepNode({ step, styles }: StepNodeProps) {
  const iconClass = (() => {
    if (step.status === 'approved') return mergeClasses(styles.stepIcon, styles.stepIconDone);
    if (step.status === 'rejected') return mergeClasses(styles.stepIcon, styles.stepIconRejected);
    if (step.status === 'pending') return mergeClasses(styles.stepIcon, styles.stepIconPending, styles.pendingPulse);
    return mergeClasses(styles.stepIcon, styles.stepIconSkipped);
  })();

  const icon = (() => {
    if (step.status === 'approved') return <CheckmarkCircle24Filled style={{ fontSize: '20px' }} />;
    if (step.status === 'rejected') return <DismissCircle24Filled style={{ fontSize: '20px' }} />;
    if (step.status === 'pending') return <Clock24Regular style={{ fontSize: '18px' }} />;
    return <ArrowForward24Regular style={{ fontSize: '18px' }} />;
  })();

  const statusLabel = (() => {
    if (step.status === 'approved' && step.actioned_at) return formatDate(step.actioned_at);
    if (step.status === 'rejected' && step.actioned_at) return formatDate(step.actioned_at);
    if (step.status === 'pending') return 'Awaiting action';
    if (step.status === 'skipped') return 'Skipped';
    return step.status;
  })();

  return (
    <div className={styles.stepWrapper}>
      <div className={iconClass}>{icon}</div>
      <span className={styles.stepName}>{step.step_name}</span>
      <span className={styles.stepStatus}>{statusLabel}</span>
      {step.comment && (
        <span className={styles.stepComment} title={step.comment}>
          "{step.comment.length > 50 ? step.comment.substring(0, 47) + '…' : step.comment}"
        </span>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

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
      setApprovals(data);
    } catch (err: unknown) {
      setError(formatApiError(err, 'Failed to load approvals'));
    } finally {
      setLoading(false);
    }
  };

  const openActionDialog = (
    approval: ApprovalInstance,
    step: ApprovalStep,
    action: 'approve' | 'reject' | 'proxy-approve',
  ) => {
    setSelectedApproval(approval);
    setSelectedStep(step);
    setActionType(action);
    setComment('');
    setIsDialogOpen(true);
  };

  const handleAction = async () => {
    if (!selectedApproval || !selectedStep) return;

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
      await loadApprovals();
    } catch (err: unknown) {
      showApiError(err as Error, 'Failed to update approval');
    } finally {
      setLoading(false);
    }
  };

  const getCurrentStep = (approval: ApprovalInstance): ApprovalStep | null =>
    approval.steps.find(s => s.status === 'pending') || null;

  const getManagerStep = (approval: ApprovalInstance): ApprovalStep | null =>
    approval.steps.find(s => s.step_name === 'Manager') || null;

  const getSeniorManagerStep = (approval: ApprovalInstance): ApprovalStep | null =>
    approval.steps.find(s => s.step_name === 'Senior Manager') || null;

  const canProxyApprove = (approval: ApprovalInstance): boolean => {
    if (user?.role !== 'Manager') return false;
    const managerStep = getManagerStep(approval);
    const seniorManagerStep = getSeniorManagerStep(approval);
    return managerStep?.status === 'approved' && seniorManagerStep?.status === 'pending';
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spinner size="large" label="Loading approvals…" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="Approvals"
        subtitle={
          approvals.length > 0
            ? `${approvals.length} item${approvals.length === 1 ? '' : 's'} pending your review`
            : undefined
        }
        actions={
          <Button
            icon={<ArrowClockwise24Regular />}
            appearance="subtle"
            onClick={loadApprovals}
            title="Refresh"
          >
            Refresh
          </Button>
        }
      />

      {error && (
        <MessageBar intent="error" style={{ marginBottom: tokens.spacingVerticalM }}>
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}

      {approvals.length === 0 ? (
        <div className={styles.emptyCard}>
          <ClipboardCheckmark24Regular className={styles.emptyIcon} style={{ fontSize: '48px' }} />
          <Body1 style={{ fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase400 }}>
            All caught up!
          </Body1>
          <Caption1 style={{ color: tokens.colorNeutralForeground3 }}>
            There are no pending approvals in your queue.
          </Caption1>
        </div>
      ) : (
        <div className={styles.list}>
          {approvals.map(approval => {
            const currentStep = getCurrentStep(approval);
            const proxy = canProxyApprove(approval);
            const awaitingRO =
              user?.role === 'Manager' && getManagerStep(approval)?.status === 'pending';

            // Determine if the connector between consecutive steps should be "done"
            const connectorDone = (idx: number) => {
              if (idx >= approval.steps.length - 1) return false;
              return approval.steps[idx].status === 'approved';
            };

            return (
              <div key={approval.id} className={styles.card}>
                {/* ── Title row ─────────────────────────────────────────── */}
                <div className={styles.cardTop}>
                  <Badge appearance="tint" color="informative" style={{ flexShrink: 0 }}>
                    {approval.subject_type}
                  </Badge>

                  <span className={styles.cardTitle}>{buildTitle(approval)}</span>

                  {awaitingRO && (
                    <Badge appearance="tint" color="warning" style={{ flexShrink: 0 }}>
                      Awaiting RO
                    </Badge>
                  )}

                  <Badge
                    appearance="filled"
                    color={overallStatusColor(approval.status)}
                    style={{ flexShrink: 0 }}
                  >
                    {approval.status}
                  </Badge>
                </div>

                {/* ── Meta row ──────────────────────────────────────────── */}
                <div className={styles.cardMeta}>
                  <span className={styles.cardMetaText}>
                    Submitted {formatDate(approval.created_at)}
                  </span>
                </div>

                {/* ── Approval flow stepper ──────────────────────────────── */}
                <div className={styles.stepperSection}>
                  <div className={styles.stepperLabel}>Approval flow</div>
                  <div className={styles.stepper}>
                    {approval.steps.map((step, idx) => (
                      <React.Fragment key={step.id}>
                        <StepNode step={step} styles={styles} />
                        {idx < approval.steps.length - 1 && (
                          <div className={styles.stepConnectorWrapper}>
                            <div
                              className={mergeClasses(
                                styles.stepConnectorLine,
                                connectorDone(idx) ? styles.stepConnectorLineDone : undefined,
                              )}
                            />
                          </div>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>

                {/* ── Action footer ──────────────────────────────────────── */}
                {(currentStep || proxy) && (
                  <>
                    {proxy && (
                      <div className={styles.proxyNotice}>
                        <Caption1 style={{ color: tokens.colorNeutralForeground2 }}>
                          RO step approved. You may proxy-approve the Director step on behalf of the Director — an explanation is required.
                        </Caption1>
                        <div>
                          <Button
                            appearance="primary"
                            icon={<Checkmark24Regular />}
                            size="small"
                            onClick={() => {
                              const ds = getDirectorStep(approval);
                              if (ds) openActionDialog(approval, ds, 'proxy-approve');
                            }}
                          >
                            Proxy-Approve Director Step
                          </Button>
                        </div>
                      </div>
                    )}

                    {currentStep && (
                      <div className={styles.actionBar}>
                        <Body2 style={{ color: tokens.colorNeutralForeground3 }}>
                          Action required:{' '}
                          <strong style={{ color: tokens.colorNeutralForeground2 }}>
                            {currentStep.step_name} step
                          </strong>
                        </Body2>
                        <div className={styles.actionBarSpacer} />
                        <Button
                          appearance="outline"
                          icon={<Dismiss24Regular />}
                          className={styles.rejectBtn}
                          style={{ borderColor: tokens.colorPaletteRedBorderActive }}
                          onClick={() => openActionDialog(approval, currentStep, 'reject')}
                        >
                          Reject
                        </Button>
                        <Button
                          appearance="primary"
                          icon={<Checkmark24Regular />}
                          onClick={() => openActionDialog(approval, currentStep, 'approve')}
                        >
                          Approve
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Action Dialog ────────────────────────────────────────────────── */}
      <Dialog open={isDialogOpen} onOpenChange={(_, data) => setIsDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {actionType === 'approve'
                ? 'Approve'
                : actionType === 'proxy-approve'
                ? 'Proxy-Approve Director Step'
                : 'Reject'}{' '}
              — {selectedStep?.step_name}
            </DialogTitle>
            <DialogContent>
              {actionType === 'proxy-approve' && (
                <MessageBar intent="warning" style={{ marginBottom: tokens.spacingVerticalM }}>
                  <MessageBarBody>
                    You are approving the Director step on behalf of the Director. An explanation is
                    required.
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
                placeholder={
                  actionType === 'proxy-approve'
                    ? 'Explanation (required)'
                    : 'Add a comment (optional)'
                }
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
                style={
                  actionType === 'reject'
                    ? { backgroundColor: tokens.colorPaletteRedBackground3 }
                    : undefined
                }
                disabled={actionType === 'proxy-approve' && (!comment || !comment.trim())}
              >
                {actionType === 'approve'
                  ? 'Approve'
                  : actionType === 'proxy-approve'
                  ? 'Proxy-Approve'
                  : 'Reject'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};

export default Approvals;
