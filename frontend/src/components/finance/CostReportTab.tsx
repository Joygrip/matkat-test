import { useState, useEffect, useCallback } from 'react';
import {
  makeStyles,
  tokens,
  Body1,
  Body2,
  Button,
  Input,
  Spinner,
} from '@fluentui/react-components';
import { CheckmarkCircleRegular } from '@fluentui/react-icons';
import { getFinanceSetting, updateFinanceSetting } from '../../api/finance';
import { formatDKK } from '../../utils/format';
import type { Period } from '../../types';
import { PeriodSelector } from '../PeriodSelector';

const COST_SETTING_KEY = 'monthly_fte_cost';
const DEFAULT_MONTHLY_FTE_COST = 99000;

export interface CostReportTabProps {
  periods: Period[];
  selectedPeriodId: string;
  onSelectPeriod: (id: string) => void;
  showSuccess: (title: string) => void;
  showError: (title: string) => void;
  showApiError: (err: Error, ctx?: string) => void;
}

const useStyles = makeStyles({
  card: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    padding: tokens.spacingHorizontalL,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  periodRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: tokens.spacingHorizontalM,
    alignItems: 'flex-end',
  },
  periodField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  periodLabel: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  sectionTitle: {
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  sectionDescription: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalM,
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

export function CostReportTab({
  periods,
  selectedPeriodId,
  onSelectPeriod,
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

  return (
    <div className={styles.card}>
      <div className={styles.periodRow}>
        <div className={styles.periodField}>
          <span className={styles.periodLabel}>Period</span>
          <PeriodSelector periods={periods} selectedId={selectedPeriodId} onSelect={onSelectPeriod} />
        </div>
      </div>

      <div className={styles.section}>
        <div>
          <Body1 className={styles.sectionTitle}>Monthly FTE Cost</Body1>
          <Body2 className={styles.sectionDescription}>Set the monthly FTE cost rate used for cost calculations.</Body2>
        </div>
        <div>
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
      </div>
    </div>
  );
}
