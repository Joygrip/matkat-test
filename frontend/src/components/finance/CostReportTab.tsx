import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Body2,
  Badge,
  Button,
  Input,
  Spinner,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Card,
} from '@fluentui/react-components';
import { MoneyRegular } from '@fluentui/react-icons';
import { EmptyState } from '../EmptyState';
import { getFinanceSetting, updateFinanceSetting } from '../../api/finance';
import type { FinanceActualRow } from './ActualsTab';

const COST_SETTING_KEY = 'monthly_fte_cost';
const DEFAULT_MONTHLY_FTE_COST = 99000;

export interface CostReportTabProps {
  actualsData: FinanceActualRow[];
  actualsLoading: boolean;
  selectedPeriodId: string;
  onLoadActuals: () => void;
  showSuccess: (title: string) => void;
  showError: (title: string) => void;
  showApiError: (err: Error, ctx?: string) => void;
}

const useStyles = makeStyles({
  costToolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    flexWrap: 'wrap' as const,
  },
  toolbarLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  card: {
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
  },
  sortableTable: {
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
    },
    '& td': {
      padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
      borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    },
    '& tbody tr:hover': { backgroundColor: tokens.colorNeutralBackground2 },
  },
  subtotalRow: {
    fontWeight: tokens.fontWeightSemibold,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  grandTotalRow: {
    fontWeight: tokens.fontWeightBold,
    backgroundColor: tokens.colorBrandBackground2,
  },
  loading: {
    display: 'flex',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
  },
});

const formatDKK = (n: number): string =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(n);

export function CostReportTab({
  actualsData,
  actualsLoading,
  selectedPeriodId,
  onLoadActuals,
  showSuccess,
  showError,
  showApiError,
}: CostReportTabProps) {
  const styles = useStyles();

  const [monthlyFteCost, setMonthlyFteCost] = useState<number>(DEFAULT_MONTHLY_FTE_COST);
  const [costOverrideInput, setCostOverrideInput] = useState<string>(String(DEFAULT_MONTHLY_FTE_COST));
  const [costOverrideSaving, setCostOverrideSaving] = useState(false);

  // Load setting + trigger actuals load on mount
  useEffect(() => {
    getFinanceSetting(COST_SETTING_KEY).then(s => {
      const v = parseInt(s.setting_value, 10);
      if (!isNaN(v)) {
        setMonthlyFteCost(v);
        setCostOverrideInput(String(v));
      }
    }).catch(() => { /* keep default */ });

    if (actualsData.length === 0) {
      onLoadActuals();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodId]);

  const handleCostSave = useCallback(async () => {
    const v = parseInt(costOverrideInput, 10);
    if (isNaN(v) || v <= 0) {
      showError('Monthly FTE cost must be a positive number');
      return;
    }
    setCostOverrideSaving(true);
    try {
      await updateFinanceSetting(COST_SETTING_KEY, String(v));
      setMonthlyFteCost(v);
      showSuccess('Monthly FTE cost updated');
    } catch (err) {
      showApiError(err as Error, 'Failed to save setting');
    } finally {
      setCostOverrideSaving(false);
    }
  }, [costOverrideInput, showError, showSuccess, showApiError]);

  const costRows = useMemo(() =>
    actualsData.map(r => ({ ...r, cost: Math.round((r.fte_percent / 100) * monthlyFteCost) })),
    [actualsData, monthlyFteCost]
  );

  const costByProject = useMemo(() => {
    const map = new Map<string, { name: string; rows: typeof costRows; total: number }>();
    for (const r of costRows) {
      const g = map.get(r.project_id) ?? { name: r.project_name, rows: [], total: 0 };
      g.rows.push(r);
      g.total += r.cost;
      map.set(r.project_id, g);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [costRows]);

  const grandTotal = useMemo(() => costRows.reduce((s, r) => s + r.cost, 0), [costRows]);

  return (
    <>
      {/* Cost setting toolbar */}
      <div className={styles.costToolbar}>
        <span className={styles.toolbarLabel}>Monthly FTE Cost (DKK)</span>
        <Input
          type="number"
          value={costOverrideInput}
          onChange={(_, d) => setCostOverrideInput(d.value)}
          style={{ width: 140 }}
          disabled={costOverrideSaving}
        />
        <Button
          appearance="primary"
          onClick={handleCostSave}
          disabled={costOverrideSaving}
        >
          {costOverrideSaving ? 'Saving…' : 'Apply'}
        </Button>
        <Body2 style={{ color: tokens.colorNeutralForeground3 }}>
          Current: {formatDKK(monthlyFteCost)}
        </Body2>
      </div>

      {/* Cost table */}
      {actualsLoading ? (
        <div className={styles.loading}><Spinner size="medium" label="Loading actuals…" /></div>
      ) : costRows.length === 0 ? (
        <EmptyState
          icon={<MoneyRegular style={{ fontSize: 48 }} />}
          title="No actuals data"
          message="No actuals found for this period. Select a different period or adjust filters."
        />
      ) : (
        <Card className={styles.card}>
          <Table className={styles.sortableTable}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Employee</TableHeaderCell>
                <TableHeaderCell>Project</TableHeaderCell>
                <TableHeaderCell>Month</TableHeaderCell>
                <TableHeaderCell>Actual %</TableHeaderCell>
                <TableHeaderCell>Monthly FTE Cost</TableHeaderCell>
                <TableHeaderCell>Cost (DKK)</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costByProject.map(g => (
                <React.Fragment key={g.name}>
                  {g.rows.map(r => (
                    <TableRow key={r.actual_id}>
                      <TableCell>{r.employee_name}</TableCell>
                      <TableCell>{r.project_name}</TableCell>
                      <TableCell>{r.year}-{String(r.month).padStart(2, '0')}</TableCell>
                      <TableCell>
                        <Badge appearance="filled" color="informative">{r.fte_percent}%</Badge>
                      </TableCell>
                      <TableCell>{formatDKK(monthlyFteCost)}</TableCell>
                      <TableCell><strong>{formatDKK(r.cost)}</strong></TableCell>
                    </TableRow>
                  ))}
                  <TableRow className={styles.subtotalRow}>
                    <TableCell>Project total: {g.name}</TableCell>
                    <TableCell /><TableCell /><TableCell /><TableCell />
                    <TableCell>{formatDKK(g.total)}</TableCell>
                  </TableRow>
                </React.Fragment>
              ))}
              <TableRow className={styles.grandTotalRow}>
                <TableCell>Grand Total</TableCell>
                <TableCell /><TableCell /><TableCell /><TableCell />
                <TableCell>{formatDKK(grandTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
