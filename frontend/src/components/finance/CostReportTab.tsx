import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Button,
  Input,
  Spinner,
} from '@fluentui/react-components';
import { CheckmarkCircleRegular, ArrowDownloadRegular } from '@fluentui/react-icons';
import { getFinanceSetting, updateFinanceSetting } from '../../api/finance';
import { apiClient } from '../../api/client';
import type { FinanceActualRow } from './ActualsTab';

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
  section: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: '10px',
    padding: `${tokens.spacingVerticalXL} ${tokens.spacingHorizontalXL}`,
    maxWidth: '560px',
  },
  sectionTitle: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    marginBottom: tokens.spacingVerticalXS,
  },
  description: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalL,
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
    marginTop: tokens.spacingVerticalS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

const formatDKK = (n: number): string =>
  new Intl.NumberFormat('da-DK', { style: 'currency', currency: 'DKK', maximumFractionDigits: 0 }).format(n);

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
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Monthly FTE Cost (DKK)</div>
      <div className={styles.description}>
        Set the monthly FTE cost rate used for cost calculations across Cost Overview, Dashboards, and reports.
      </div>
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
        <Button
          appearance="secondary"
          icon={csvLoading ? <Spinner size="tiny" /> : <ArrowDownloadRegular />}
          onClick={handleDownloadCsv}
          disabled={csvLoading || !currentPeriod}
        >
          Download CSV
        </Button>
      </div>
      <div className={styles.savedRow}>
        {saved
          ? <><CheckmarkCircleRegular style={{ color: tokens.colorPaletteGreenForeground1 }} /> Current: {formatDKK(monthlyFteCost)} ✓</>
          : <>Current: {formatDKK(monthlyFteCost)}</>
        }
      </div>
    </div>
  );
}
