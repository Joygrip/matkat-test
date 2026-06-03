import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Button,
  Body2,
  Input,
  Spinner,
} from '@fluentui/react-components';
import { CheckmarkCircleRegular, ArrowDownloadRegular } from '@fluentui/react-icons';
import { getFinanceSetting, updateFinanceSetting } from '../../api/finance';
import { apiClient } from '../../api/client';
import type { FinanceActualRow } from './ActualsTab';
import { formatDKK } from '../../utils/format';

const COST_SETTING_KEY = 'monthly_fte_cost';
const DEFAULT_MONTHLY_FTE_COST = 99000;

export interface CostReportTabProps {
  selectedPeriodId: string;
  currentPeriod: { year: number; month: number } | null;
  showSuccess: (title: string) => void;
  showError: (title: string) => void;
  showApiError: (err: Error, ctx?: string) => void;
}

const useStyles = makeStyles({
  wrapper: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: tokens.spacingHorizontalL,
    alignItems: 'start',
  },
  card: {
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow4,
  },
  cardHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} 0`,
  },
  cardTitle: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  cardDescription: {
    color: tokens.colorNeutralForeground3,
  },
  cardBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM} ${tokens.spacingVerticalL}`,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap' as const,
  },
  savedRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});


function toCsv(rows: FinanceActualRow[], monthlyFteCost: number): string {
  const header = ['Employee', 'Project', 'Month', 'Actual %', 'Monthly FTE Cost', 'Cost (DKK)'];
  const lines = [header.join(',')];
  rows.forEach(r => {
    const cost = Math.round((r.fte_percent / 100) * monthlyFteCost);
    lines.push([
      r.employee_name,
      r.project_name,
      `${r.year}-${String(r.month).padStart(2, '0')}`,
      r.fte_percent,
      monthlyFteCost,
      cost,
    ].join(','));
  });
  return lines.join('\r\n');
}

export function CostReportTab({
  selectedPeriodId,
  currentPeriod,
  showSuccess,
  showError,
  showApiError,
}: CostReportTabProps) {
  const styles = useStyles();

  const [monthlyFteCost, setMonthlyFteCost] = useState<number>(DEFAULT_MONTHLY_FTE_COST);
  const [costInput, setCostInput] = useState<string>(String(DEFAULT_MONTHLY_FTE_COST));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  useEffect(() => {
    setSaved(false);
    getFinanceSetting(COST_SETTING_KEY).then(s => {
      const v = parseInt(s.setting_value, 10);
      if (!isNaN(v)) {
        setMonthlyFteCost(v);
        setCostInput(String(v));
      }
    }).catch(() => {});
  }, [selectedPeriodId]);

  const handleApply = useCallback(async () => {
    const v = parseInt(costInput, 10);
    if (isNaN(v) || v <= 0) {
      showError('Monthly FTE cost must be a positive number');
      return;
    }
    setSaving(true);
    try {
      await updateFinanceSetting(COST_SETTING_KEY, String(v));
      setMonthlyFteCost(v);
      setSaved(true);
      showSuccess('Monthly FTE cost updated');
    } catch (err) {
      showApiError(err as Error, 'Failed to save setting');
    } finally {
      setSaving(false);
    }
  }, [costInput, showError, showSuccess, showApiError]);

  const handleDownloadCsv = useCallback(async () => {
    if (!currentPeriod) return;
    setCsvLoading(true);
    try {
      const params = new URLSearchParams({
        year: String(currentPeriod.year),
        month: String(currentPeriod.month),
      });
      const rows = await apiClient.get<FinanceActualRow[]>(`/finance/actuals-dashboard?${params.toString()}`);
      const csv = toCsv(rows, monthlyFteCost);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cost-report-${selectedPeriodId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showApiError(err as Error, 'Failed to download CSV');
    } finally {
      setCsvLoading(false);
    }
  }, [currentPeriod, monthlyFteCost, selectedPeriodId, showApiError]);

  return (
    <div className={styles.wrapper}>

      {/* Card 1 — Monthly FTE Cost */}
      <Card className={styles.card}>
        <div className={styles.cardHeader}>
          <Body2 className={styles.cardTitle}>Monthly FTE Cost</Body2>
          <Body2 className={styles.cardDescription}>
            Set the monthly FTE cost rate used for cost calculations across cost overview, dashboards, and reports.
          </Body2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.row}>
            <Input
              type="number"
              value={costInput}
              onChange={(_, d) => { setCostInput(d.value); setSaved(false); }}
              style={{ width: 160 }}
              disabled={saving}
            />
            <Button
              appearance="primary"
              onClick={handleApply}
              disabled={saving}
            >
              {saving ? <><Spinner size="tiny" style={{ marginRight: 6 }} />Saving…</> : 'Apply'}
            </Button>
          </div>
          <div className={styles.savedRow}>
            {saved
              ? <><CheckmarkCircleRegular style={{ color: tokens.colorPaletteGreenForeground1 }} />&nbsp;Current: {formatDKK(monthlyFteCost)} ✓</>
              : <>Current: {formatDKK(monthlyFteCost)}</>
            }
          </div>
        </div>
      </Card>

      {/* Card 2 — Export Cost Report */}
      <Card className={styles.card}>
        <div className={styles.cardHeader}>
          <Body2 className={styles.cardTitle}>Export Cost Report</Body2>
          <Body2 className={styles.cardDescription}>
            Download reporting data for the selected period.
          </Body2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.row}>
            <Button
              appearance="secondary"
              icon={csvLoading ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
              onClick={handleDownloadCsv}
              disabled={csvLoading || !currentPeriod}
            >
              Download CSV
            </Button>
          </div>
        </div>
      </Card>

    </div>
  );
}
