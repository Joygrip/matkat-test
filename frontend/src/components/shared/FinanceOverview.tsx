import { useState, useEffect, useMemo } from 'react';
import type { ConsolidationDashboard, DashboardResource, OverAllocation } from '../../api/consolidation';
import { consolidationApi } from '../../api/consolidation';
import { usePeriod } from '../../contexts/PeriodContext';
import { useToast } from '../../hooks/useToast';
import { OverviewTab } from '../finance/OverviewTab';
import type { Period } from '../../types';

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

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtPeriod(p: Period): string {
  return `${MONTH_SHORT[p.month - 1]} ${p.year}`;
}

export function FinanceOverview({
  scope,
  projectIds,
  costCenterId,
  projectId,
  onDashboardLoaded,
}: FinanceOverviewProps) {
  const { periods } = usePeriod();
  const { showApiError } = useToast();
  const [dashboard, setDashboard] = useState<ConsolidationDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [localPeriodId, setLocalPeriodId] = useState<string>('');

  // Only open periods, sorted chronologically (oldest → newest) for slider navigation.
  const sortedPeriods = useMemo(
    () =>
      [...periods]
        .filter(p => p.status === 'open')
        .sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month),
    [periods]
  );

  // Initialize to earliest open period once the period list loads.
  useEffect(() => {
    if (!localPeriodId && sortedPeriods.length > 0) {
      setLocalPeriodId(sortedPeriods[0].id);
    }
  }, [sortedPeriods, localPeriodId]);

  const localIdx = sortedPeriods.findIndex(p => p.id === localPeriodId);
  const localPeriod = localIdx >= 0 ? sortedPeriods[localIdx] : null;
  const canPrev = localIdx > 0;
  const canNext = localIdx >= 0 && localIdx < sortedPeriods.length - 1;

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
    if (localPeriodId) {
      fetchDashboard(localPeriodId);
    } else {
      setDashboard(null);
      onDashboardLoaded?.(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPeriodId]);

  // Apply scope-based filtering to produce the dashboard slice this viewer should see.
  // The resulting dashboard is passed to OverviewTab; its own projectId filter works on top.
  const scopedDashboard = useMemo((): ConsolidationDashboard | null => {
    if (!dashboard) return null;

    if (scope === 'finance' || scope === 'admin' || scope === 'reader') {
      return dashboard;
    }

    if (scope === 'pm' && projectIds?.length) {
      const idSet = new Set(projectIds);

      const ccs = dashboard.cost_centers
        .filter(cc => cc.project_ids.some(pid => idSet.has(pid)))
        .map(cc => {
          const scopedPlaceholders = cc.placeholders.filter(ph => idSet.has(ph.project_id));

          // Scope each resource using project_allocations breakdown (available when the
          // backend is up-to-date). Supply lines with null project_id (general availability)
          // are included — consistent with how the resource detail modal treats them.
          const scopedResources = cc.resources
            .map((r): DashboardResource | null => {
              if (!r.project_allocations?.length) return r;
              const relevant = r.project_allocations.filter(
                pa => pa.project_id === null || idSet.has(pa.project_id)
              );
              const scopedDemand = relevant.reduce((s, pa) => s + pa.demand_fte, 0);
              const scopedSupply = relevant.reduce((s, pa) => s + pa.supply_fte, 0);
              if (scopedDemand === 0 && scopedSupply === 0) return null;
              const scopedGap = scopedSupply - scopedDemand;
              return {
                ...r,
                demand_fte: scopedDemand,
                supply_fte: scopedSupply,
                gap_fte: scopedGap,
                status: scopedGap < 0 ? 'under' : scopedGap > 0 ? 'over' : 'balanced',
              };
            })
            .filter((r): r is DashboardResource => r !== null);

          const resDemand  = scopedResources.reduce((s, r) => s + r.demand_fte, 0);
          const resSupply  = scopedResources.reduce((s, r) => s + r.supply_fte, 0);
          const phDemand   = scopedPlaceholders.reduce((s, ph) => s + ph.demand_fte, 0);
          const totalDemand = resDemand + phDemand;

          return {
            ...cc,
            project_ids: cc.project_ids.filter(pid => idSet.has(pid)),
            placeholders: scopedPlaceholders,
            resources: scopedResources,
            total_demand_fte: totalDemand,
            total_supply_fte: resSupply,
            gap_fte: resSupply - totalDemand,
          };
        });

      // Over-allocations are recomputed from scoped resource demand so a resource with
      // org-wide demand > 100% but scoped demand ≤ 100% is not flagged for the PM.
      const scopedOverAllocs: OverAllocation[] = ccs.flatMap(cc =>
        cc.resources
          .filter(r => r.demand_fte > 100)
          .map(r => ({
            resource_id: r.resource_id,
            resource_name: r.resource_name,
            cost_center_id: cc.cost_center_id ?? undefined,
            cost_center_name: cc.cost_center_name,
            total_demand_fte: r.demand_fte,
          }))
      );

      return {
        ...dashboard,
        cost_centers: ccs,
        over_allocations: scopedOverAllocs,
        summary: {
          total_cost_centers: ccs.length,
          total_demand_fte: ccs.reduce((s, cc) => s + cc.total_demand_fte, 0),
          total_supply_fte: ccs.reduce((s, cc) => s + cc.total_supply_fte, 0),
          total_gap_fte: ccs.reduce((s, cc) => s + cc.gap_fte, 0),
          orphans_count: ccs.reduce((s, cc) => s + cc.placeholders.length, 0),
          over_allocations_count: scopedOverAllocs.length,
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
    if (localPeriodId) fetchDashboard(localPeriodId);
  };

  return (
    <>
      {/* Period slider — compact, right-aligned in its own header strip */}
      {sortedPeriods.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Prev arrow */}
            <ArrowBtn
              direction="left"
              disabled={!canPrev}
              onClick={() => canPrev && setLocalPeriodId(sortedPeriods[localIdx - 1].id)}
            />

            {/* Period label */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              minWidth: 120, justifyContent: 'center',
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#1b1b1a' }}>
                {localPeriod ? fmtPeriod(localPeriod) : '—'}
              </span>
            </div>

            {/* Next arrow */}
            <ArrowBtn
              direction="right"
              disabled={!canNext}
              onClick={() => canNext && setLocalPeriodId(sortedPeriods[localIdx + 1].id)}
            />
          </div>
        </div>
      )}

      <OverviewTab
        dashboard={scopedDashboard}
        loading={loading}
        projectId={projectId}
        scopeProjectIds={scope === 'pm' ? projectIds : undefined}
        onDashboardChanged={handleDashboardChanged}
      />
    </>
  );
}

// ── Arrow button ──────────────────────────────────────────────────────────────

function ArrowBtn({
  direction,
  disabled,
  onClick,
}: {
  direction: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24, height: 24,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid #e5e4e0',
        borderRadius: 4,
        backgroundColor: hovered && !disabled ? '#f6f5f2' : '#ffffff',
        color: disabled ? '#c8c7c3' : hovered ? '#424242' : '#707070',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        outline: 'none',
        transition: 'background-color 0.1s, color 0.1s',
        flexShrink: 0,
      }}
      aria-label={direction === 'left' ? 'Previous period' : 'Next period'}
    >
      {direction === 'left' ? (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M6.5 2L3.5 5L6.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path d="M3.5 2L6.5 5L3.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  );
}
