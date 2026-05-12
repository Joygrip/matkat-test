import { useState, useEffect, useMemo } from 'react';
import type { ConsolidationDashboard } from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { usePeriod } from '../../contexts/PeriodContext';
import { useToast } from '../../hooks/useToast';
import { OverviewTab } from '../finance/OverviewTab';

export interface FinanceOverviewProps {
  scope: 'pm' | 'manager' | 'finance' | 'admin' | 'reader';
  /** PM scope: restrict to cost centers touching these project IDs */
  projectIds?: string[];
  /** Manager scope: restrict to this cost center ID */
  costCenterId?: string;
  /** Extra project filter (Finance toolbar dropdown) passed through to OverviewTab */
  projectId?: string;
  /** Callback fired whenever dashboard is loaded or refreshed */
  onDashboardLoaded?: (dashboard: ConsolidationDashboard | null) => void;
}

export function FinanceOverview({
  scope,
  projectIds,
  costCenterId,
  projectId,
  onDashboardLoaded,
}: FinanceOverviewProps) {
  const { selectedPeriodId } = usePeriod();
  const { showApiError } = useToast();
  const [dashboard, setDashboard] = useState<ConsolidationDashboard | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDashboard = async (periodId: string) => {
    setLoading(true);
    try {
      const data = await consolidationApi.getDashboard(periodId);
      setDashboard(data);
      onDashboardLoaded?.(data);
    } catch (err) {
      showApiError(err as Error, 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPeriodId) {
      fetchDashboard(selectedPeriodId);
    } else {
      setDashboard(null);
      onDashboardLoaded?.(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  // Apply scope-based filtering to produce the dashboard slice this viewer should see.
  // The resulting dashboard is passed to OverviewTab; its own projectId filter works on top.
  const scopedDashboard = useMemo((): ConsolidationDashboard | null => {
    if (!dashboard) return null;

    if (scope === 'finance' || scope === 'admin' || scope === 'reader') {
      return dashboard;
    }

    if (scope === 'pm' && projectIds?.length) {
      const idSet = new Set(projectIds);
      const ccs = dashboard.cost_centers.filter(cc =>
        cc.project_ids.some(pid => idSet.has(pid))
      );
      const ccIdSet = new Set(ccs.map(cc => cc.cost_center_id ?? '__none__'));
      return {
        ...dashboard,
        cost_centers: ccs,
        over_allocations: dashboard.over_allocations.filter(
          oa => ccIdSet.has(oa.cost_center_id ?? '__none__')
        ),
        summary: {
          ...dashboard.summary,
          total_cost_centers: ccs.length,
        },
      };
    }

    if (scope === 'manager' && costCenterId) {
      const ccs = dashboard.cost_centers.filter(
        cc => (cc.cost_center_id ?? '__none__') === costCenterId
      );
      const ccIdSet = new Set(ccs.map(cc => cc.cost_center_id ?? '__none__'));
      return {
        ...dashboard,
        cost_centers: ccs,
        over_allocations: dashboard.over_allocations.filter(
          oa => ccIdSet.has(oa.cost_center_id ?? '__none__')
        ),
        summary: {
          ...dashboard.summary,
          total_cost_centers: ccs.length,
        },
      };
    }

    return dashboard;
  }, [dashboard, scope, projectIds, costCenterId]);

  const handleDashboardChanged = () => {
    if (selectedPeriodId) fetchDashboard(selectedPeriodId);
  };

  return (
    <OverviewTab
      dashboard={scopedDashboard}
      loading={loading}
      projectId={projectId}
      onDashboardChanged={handleDashboardChanged}
    />
  );
}
