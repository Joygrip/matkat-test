/**
 * Supply vs Demand Chart Component
 * Shows a clean bar chart comparing total supply and demand for a selected period.
 * Supports standalone (wrapped in Card) or embedded mode (no outer Card).
 */
import React from 'react';
import {
  Card,
  CardHeader,
  Title3,
  Body1,
  Body2,
  tokens,
  makeStyles,
} from '@fluentui/react-components';
import { ChartMultipleRegular } from '@fluentui/react-icons';
import { DemandLine, SupplyLine } from '../api/planning';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';

const useStyles = makeStyles({
  chartContainer: {
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalXL}`,
  },
  legend: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalL,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  legendColor: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
  },
  legendLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
  chartArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  barRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  barLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  label: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  value: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
  },
  barContainer: {
    width: '100%',
    height: '32px',
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: '16px',
    position: 'relative',
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: tokens.spacingHorizontalM,
    paddingLeft: tokens.spacingHorizontalM,
    color: 'white',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    transition: 'width 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
    boxSizing: 'border-box',
    minWidth: '48px',
  },
  demandBar: {
    background: 'linear-gradient(90deg, #0078d4, #50a3e0)',
    position: 'absolute',
    left: 0,
    top: 0,
  },
  supplyBar: {
    background: 'linear-gradient(90deg, #107c10, #4caf50)',
    position: 'absolute',
    left: 0,
    top: 0,
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalXL,
    paddingTop: tokens.spacingVerticalL,
    borderTop: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  summaryItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    textAlign: 'center',
  },
  summaryLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
  summaryValue: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
  },
  gapPositive: {
    color: tokens.colorPaletteGreenForeground1,
  },
  gapNegative: {
    color: tokens.colorPaletteRedForeground1,
  },
  emptyMessage: {
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontStyle: 'italic',
  },
});

interface SupplyDemandChartProps {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  loading?: boolean;
  periodLabel?: string;
  /** When true, renders without outer Card wrapper (for embedding in a parent Card) */
  embedded?: boolean;
}

export const SupplyDemandChart: React.FC<SupplyDemandChartProps> = ({
  demandLines,
  supplyLines,
  loading = false,
  periodLabel,
  embedded = false,
}) => {
  const styles = useStyles();

  if (loading) {
    return embedded ? (
      <LoadingState message="Loading chart data..." />
    ) : (
      <Card>
        <CardHeader header={<Title3>Supply vs Demand</Title3>} />
        <LoadingState message="Loading chart data..." />
      </Card>
    );
  }

  const totalDemand = (demandLines || []).reduce((sum, line) => sum + (line?.fte_percent || 0), 0);
  const totalSupply = (supplyLines || []).reduce((sum, line) => sum + (line?.fte_percent || 0), 0);
  const gap = totalSupply - totalDemand;
  const maxValue = Math.max(totalDemand, totalSupply, 100);

  if ((!demandLines || demandLines.length === 0) && (!supplyLines || supplyLines.length === 0)) {
    const emptyContent = (
      <EmptyState
        icon={<ChartMultipleRegular style={{ fontSize: 48 }} />}
        title="No Data Available"
        message={periodLabel ? `No supply or demand data for ${periodLabel}` : 'Select a period to view supply and demand'}
      />
    );
    if (embedded) return emptyContent;
    return (
      <Card>
        <CardHeader header={<Title3>Supply vs Demand</Title3>} />
        {emptyContent}
      </Card>
    );
  }

  const demandWidthPercent = totalDemand > 0 ? (totalDemand / maxValue) * 100 : 0;
  const supplyWidthPercent = totalSupply > 0 ? (totalSupply / maxValue) * 100 : 0;

  const chartContent = (
    <div className={styles.chartContainer}>
      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <div className={styles.legendColor} style={{ backgroundColor: '#0078d4' }} />
          <Body2 className={styles.legendLabel}>Demand</Body2>
        </div>
        <div className={styles.legendItem}>
          <div className={styles.legendColor} style={{ backgroundColor: '#107c10' }} />
          <Body2 className={styles.legendLabel}>Supply</Body2>
        </div>
      </div>

      <div className={styles.chartArea}>
        {/* Demand Bar */}
        <div className={styles.barRow}>
          <div className={styles.barLabelRow}>
            <div className={styles.label}>Demand</div>
            <div className={styles.value}>{totalDemand.toFixed(0)}% FTE</div>
          </div>
          <div className={styles.barContainer}>
            {totalDemand > 0 ? (
              <div
                className={`${styles.bar} ${styles.demandBar}`}
                style={{ width: `${Math.max(demandWidthPercent, 4)}%` }}
              >
                {demandWidthPercent >= 12 && `${totalDemand.toFixed(0)}%`}
              </div>
            ) : (
              <div className={styles.emptyMessage}>No demand data</div>
            )}
          </div>
        </div>

        {/* Supply Bar */}
        <div className={styles.barRow}>
          <div className={styles.barLabelRow}>
            <div className={styles.label}>Supply</div>
            <div className={styles.value}>{totalSupply.toFixed(0)}% FTE</div>
          </div>
          <div className={styles.barContainer}>
            {totalSupply > 0 ? (
              <div
                className={`${styles.bar} ${styles.supplyBar}`}
                style={{ width: `${Math.max(supplyWidthPercent, 4)}%` }}
              >
                {supplyWidthPercent >= 12 && `${totalSupply.toFixed(0)}%`}
              </div>
            ) : (
              <div className={styles.emptyMessage}>No supply data</div>
            )}
          </div>
        </div>
      </div>

      {/* Summary Statistics */}
      <div className={styles.summary}>
        <div className={styles.summaryItem}>
          <Body2 className={styles.summaryLabel}>Total Demand</Body2>
          <Body1 className={styles.summaryValue}>{totalDemand.toFixed(0)}%</Body1>
        </div>
        <div className={styles.summaryItem}>
          <Body2 className={styles.summaryLabel}>Total Supply</Body2>
          <Body1 className={styles.summaryValue}>{totalSupply.toFixed(0)}%</Body1>
        </div>
        <div className={styles.summaryItem}>
          <Body2 className={styles.summaryLabel}>Gap (Supply &minus; Demand)</Body2>
          <Body1 className={`${styles.summaryValue} ${gap >= 0 ? styles.gapPositive : styles.gapNegative}`}>
            {gap >= 0 ? '+' : ''}{gap.toFixed(0)}%
          </Body1>
        </div>
      </div>
    </div>
  );

  if (embedded) return chartContent;

  return (
    <Card>
      <CardHeader header={<Title3>Supply vs Demand{periodLabel ? ` - ${periodLabel}` : ''}</Title3>} />
      {chartContent}
    </Card>
  );
};
