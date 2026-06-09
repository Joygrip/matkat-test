import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  makeStyles,
  tokens,
  Tab,
  TabList,
  Badge,
  Button,
  Spinner,
} from '@fluentui/react-components';
import { ManagerDashboard } from './ManagerDashboard';
import { PMDashboard } from './PMDashboard';
import { lookupsApi } from '../../api/lookups';
import type { DemandLine, SupplyLine } from '../../api/planning';
import type { CostCenter, Project } from '../../api/admin';
import type { Period, MeResponse } from '../../types/index';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: tokens.spacingHorizontalM,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  title: {
    fontSize: tokens.fontSizeBase500,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    margin: 0,
  },
  badges: {
    display: 'flex',
    gap: tokens.spacingHorizontalXS,
  },
  actions: {
    display: 'flex',
    gap: tokens.spacingHorizontalS,
  },
  emptyPmModule: {
    padding: `${tokens.spacingVerticalXXL} ${tokens.spacingHorizontalL}`,
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
    background: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px dashed ${tokens.colorNeutralStroke2}`,
  },
  emptyPmTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    marginBottom: tokens.spacingVerticalS,
    color: tokens.colorNeutralForeground2,
  },
  emptyPmText: {
    fontSize: tokens.fontSizeBase300,
    marginBottom: tokens.spacingVerticalM,
  },
  pmLoadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingVerticalL,
    color: tokens.colorNeutralForeground3,
  },
});

interface Props {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  costCenters: CostCenter[];
  /** General project list from context (all active projects — used by Manager section). */
  projects: Project[];
  periods: Period[];
  approvalStatuses: Record<string, { status: string }>;
  user: MeResponse;
  userCcId?: string | null;
}

type ViewTab = 'manager' | 'pm';

export function ManagerPMDashboard({
  demandLines,
  supplyLines,
  costCenters,
  periods,
  approvalStatuses,
  user,
  userCcId,
}: Props) {
  const styles = useStyles();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ViewTab>('manager');

  // PM-assigned projects fetched independently so the PM section shows only assigned
  // projects even though AppDataContext keeps the general project list broad.
  const [pmProjects, setPmProjects] = useState<Project[]>([]);
  const [pmProjectsLoading, setPmProjectsLoading] = useState(true);

  useEffect(() => {
    setPmProjectsLoading(true);
    lookupsApi.listProjectsScoped()
      .then(setPmProjects)
      .catch(() => setPmProjects([]))
      .finally(() => setPmProjectsLoading(false));
  }, [user.id]);

  const hasPmProjects = pmProjects.length > 0;

  // Filter demand lines to only those belonging to PM-assigned projects (for PM section).
  const pmProjectIds = new Set(pmProjects.map(p => p.id));
  const pmDemandLines = demandLines.filter(d => pmProjectIds.has(d.project_id));

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h2 className={styles.title}>My Dashboard</h2>
          <div className={styles.badges}>
            <Badge appearance="filled" color="brand" style={{ fontSize: '11px' }}>
              Manager
            </Badge>
            <Badge appearance="filled" color="success" style={{ fontSize: '11px' }}>
              Project Manager
            </Badge>
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            size="small"
            appearance="outline"
            onClick={() => navigate('/resource-planning')}
          >
            Resource Planning
          </Button>
          <Button
            size="small"
            appearance="outline"
            onClick={() => navigate('/actuals')}
          >
            FTE Approval
          </Button>
        </div>
      </div>

      {/* Tab switcher */}
      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, data) => setActiveTab(data.value as ViewTab)}
      >
        <Tab value="manager">
          Manager View
        </Tab>
        <Tab value="pm">
          Project Manager View
          {!pmProjectsLoading && hasPmProjects && (
            <Badge
              appearance="filled"
              color="brand"
              size="small"
              style={{ marginLeft: '6px', fontSize: '10px' }}
            >
              {pmProjects.length}
            </Badge>
          )}
        </Tab>
      </TabList>

      {/* Manager content */}
      {activeTab === 'manager' && (
        <ManagerDashboard
          demandLines={demandLines}
          supplyLines={supplyLines}
          costCenters={costCenters}
          periods={periods}
          approvalStatuses={approvalStatuses}
          user={user}
          userCcId={userCcId}
        />
      )}

      {/* PM content */}
      {activeTab === 'pm' && (
        pmProjectsLoading ? (
          <div className={styles.pmLoadingRow}>
            <Spinner size="tiny" />
            Loading assigned projects…
          </div>
        ) : hasPmProjects ? (
          <PMDashboard
            demandLines={pmDemandLines}
            supplyLines={supplyLines}
            projects={pmProjects}
            periods={periods}
            approvalStatuses={approvalStatuses}
            user={user}
          />
        ) : (
          <div className={styles.emptyPmModule}>
            <div className={styles.emptyPmTitle}>No assigned projects</div>
            <div className={styles.emptyPmText}>
              You have not been assigned as Project Manager for any projects yet.
              Ask your Admin to assign you to a project.
            </div>
            <Button
              appearance="primary"
              size="small"
              onClick={() => navigate('/resource-planning')}
            >
              Go to Resource Planning
            </Button>
          </div>
        )
      )}
    </div>
  );
}
