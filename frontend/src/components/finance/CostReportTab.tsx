import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Body2,
  Button,
  Input,
  Spinner,
} from '@fluentui/react-components';
import { CheckmarkCircleRegular } from '@fluentui/react-icons';
import { getFinanceSetting, updateFinanceSetting } from '../../api/finance';
import { formatDKK } from '../../utils/format';

const COST_SETTING_KEY = 'monthly_fte_cost';
const DEFAULT_MONTHLY_FTE_COST = 99000;

export interface CostReportTabProps {
  selectedPeriodId: string;
  selectedPeriodStatus: 'open' | 'locked' | 'unknown';
  showSuccess: (title: string) => void;
  showError: (title: string) => void;
  showApiError: (err: Error, ctx?: string) => void;
}

const useStyles = makeStyles({
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flexWrap: 'wrap' as const,
  },
  label: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  controls: {
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

export function CostReportTab({
  selectedPeriodId,
  selectedPeriodStatus,
  showSuccess,
  showError,
  showApiError,
}: CostReportTabProps) {
  const styles = useStyles();

  const [monthlyFteCost, setMonthlyFteCost] = useState<number>(DEFAULT_MONTHLY_FTE_COST);
  const [costInput, setCostInput] = useState<string>(String(DEFAULT_MONTHLY_FTE_COST));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSaved(false);
    getFinanceSetting(COST_SETTING_KEY, selectedPeriodId).then(s => {
      const v = parseInt(s.setting_value, 10);
      if (!isNaN(v)) {
        setMonthlyFteCost(v);
        setCostInput(String(v));
      }
    }).catch(() => {});
  }, [selectedPeriodId]);

  const handleApply = useCallback(async () => {
    if (selectedPeriodStatus !== 'open') {
      showError('Locked period. Monthly FTE cost is frozen.');
      return;
    }
    const v = parseInt(costInput, 10);
    if (isNaN(v) || v <= 0) {
      showError('Monthly FTE cost must be a positive number');
      return;
    }
    setSaving(true);
    try {
      await updateFinanceSetting(COST_SETTING_KEY, String(v), selectedPeriodId);
      setMonthlyFteCost(v);
      setSaved(true);
      showSuccess('Monthly FTE cost updated');
    } catch (err) {
      showApiError(err as Error, 'Failed to save setting');
    } finally {
      setSaving(false);
    }
  }, [costInput, selectedPeriodId, selectedPeriodStatus, showError, showSuccess, showApiError]);

  const isLocked = selectedPeriodStatus !== 'open';

  return (
    <div className={styles.root}>
      <span className={styles.label}>Monthly FTE cost</span>
      <div className={styles.controls}>
        <Input
          type="number"
          value={costInput}
          onChange={(_, d) => { setCostInput(d.value); setSaved(false); }}
          style={{ width: 120 }}
          disabled={saving || isLocked}
        />
        <Button
          appearance="primary"
          size="small"
          onClick={handleApply}
          disabled={saving || isLocked}
        >
          {saving ? <><Spinner size="tiny" style={{ marginRight: 6 }} />Saving…</> : 'Apply'}
        </Button>
        <Body2 className={styles.savedRow}>
          {saved
            ? <><CheckmarkCircleRegular style={{ color: tokens.colorPaletteGreenForeground1 }} />&nbsp;Current: {formatDKK(monthlyFteCost)} ✓</>
            : <>Current: {formatDKK(monthlyFteCost)}</>
          }
        </Body2>
        <Body2 className={styles.savedRow}>
          {isLocked
            ? 'Locked period. Monthly FTE cost is frozen.'
            : 'Applies to the selected working period only.'}
        </Body2>
      </div>
    </div>
  );
}
