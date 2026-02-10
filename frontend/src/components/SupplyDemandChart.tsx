/**
 * Supply vs Demand Chart Component
 * Shows a simple bar chart comparing total supply and demand for a selected period
 */
import React from 'react';
import {
  Card,
  CardHeader,
  Title3,
  Body1,
  tokens,
  makeStyles,
} from '@fluentui/react-components';
import { DemandLine, SupplyLine } from '../api/planning';
import { LoadingState } from './LoadingState';
import { EmptyState } from './EmptyState';

const useStyles = makeStyles({
  chartContainer: {
    padding: tokens.spacingHorizontalL,
  },
  chartArea: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    marginTop: tokens.spacingVerticalL,
  },
  barRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalS,
  },
  barLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalXS,
  },
  label: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  value: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    minWidth: '80px',
    textAlign: 'right',
  },
  barContainer: {
    width: '100%',
    height: '40px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
    position: 'relative',
    overflow: 'hidden',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  bar: {
    height: '100%',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: tokens.spacingHorizontalM,
    paddingLeft: tokens.spacingHorizontalM,
    color: 'white',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    transition: 'width 0.3s ease',
    boxSizing: 'border-box',
    minWidth: '60px',
  },
  demandBar: {
    backgroundColor: '#0078d4',
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 2,
  },
  supplyBar: {
    backgroundColor: '#107c10',
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  summary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: tokens.spacingHorizontalM,
    marginTop: tokens.spacingVerticalXL,
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  summaryItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    textAlign: 'center',
  },
  summaryLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
  },
  summaryValue: {
    fontSize: tokens.fontSizeBase500,
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
    height: '40px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
    fontStyle: 'italic',
  },
  legend: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    marginTop: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalM,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusSmall,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  legendColor: {
    width: '16px',
    height: '16px',
    borderRadius: tokens.borderRadiusSmall,
  },
  legendLabel: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
  },
});

interface SupplyDemandChartProps {
  demandLines: DemandLine[];
  supplyLines: SupplyLine[];
  loading?: boolean;
  periodLabel?: string;
}

export const SupplyDemandChart: React.FC<SupplyDemandChartProps> = ({
  demandLines,
  supplyLines,
  loading = false,
  periodLabel,
}) => {
  const styles = useStyles();

  if (loading) {
    return (
      <Card>
        <CardHeader header={<Title3>Supply vs Demand</Title3>} />
        <LoadingState message="Loading chart data..." />
      </Card>
    );
  }

  // Calculate totals - ensure arrays exist and handle undefined/null values
  const totalDemand = (demandLines || []).reduce((sum, line) => {
    const fte = line?.fte_percent || 0;
    return sum + fte;
  }, 0);
  const totalSupply = (supplyLines || []).reduce((sum, line) => {
    const fte = line?.fte_percent || 0;
    return sum + fte;
  }, 0);
  const gap = totalSupply - totalDemand;

  // Find max value for scaling - use the larger value or 100 as minimum
  const maxValue = Math.max(totalDemand, totalSupply, 100);

  if ((!demandLines || demandLines.length === 0) && (!supplyLines || supplyLines.length === 0)) {
    return (
      <Card>
        <CardHeader header={<Title3>Supply vs Demand</Title3>} />
        <EmptyState
          title="No Data Available"
          description={periodLabel ? `No supply or demand data for ${periodLabel}` : 'Select a period to view supply and demand'}
        />
      </Card>
    );
  }

  // Calculate bar widths as percentage of max value
  // Use a fixed container width approach for better visibility
  const demandWidthPercent = totalDemand > 0 ? (totalDemand / maxValue) * 100 : 0;
  const supplyWidthPercent = totalSupply > 0 ? (totalSupply / maxValue) * 100 : 0;

  return (
    <Card>
      <CardHeader header={<Title3>Supply vs Demand{periodLabel ? ` - ${periodLabel}` : ''}</Title3>} />
      <div className={styles.chartContainer}>
        {/* Legend */}
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <div className={styles.legendColor} style={{ backgroundColor: '#0078d4' }} />
            <Body1 className={styles.legendLabel}>Demand</Body1>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendColor} style={{ backgroundColor: '#107c10' }} />
            <Body1 className={styles.legendLabel}>Supply</Body1>
          </div>
        </div>

        <div className={styles.chartArea}>
          {/* Demand Bar */}
          <div className={styles.barRow}>
            <div className={styles.barLabelRow}>
              <div className={styles.label}>Demand</div>
              <div className={styles.value}>{totalDemand.toFixed(1)}%</div>
            </div>
            <div className={styles.barContainer}>
              {totalDemand > 0 ? (
                <div
                  className={`${styles.bar} ${styles.demandBar}`}
                  style={{ width: `${demandWidthPercent}%` }}
                >
                  {totalDemand >= 10 && `${totalDemand.toFixed(0)}%`}
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
              <div className={styles.value}>{totalSupply.toFixed(1)}%</div>
            </div>
            <div className={styles.barContainer}>
              {totalSupply > 0 ? (
                <div
                  className={`${styles.bar} ${styles.supplyBar}`}
                  style={{ width: `${supplyWidthPercent}%` }}
                >
                  {totalSupply >= 10 && `${totalSupply.toFixed(0)}%`}
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
            <Body1 className={styles.summaryLabel}>Total Demand</Body1>
            <Title3 className={styles.summaryValue}>{totalDemand.toFixed(1)}%</Title3>
          </div>
          <div className={styles.summaryItem}>
            <Body1 className={styles.summaryLabel}>Total Supply</Body1>
            <Title3 className={styles.summaryValue}>{totalSupply.toFixed(1)}%</Title3>
          </div>
          <div className={styles.summaryItem}>
            <Body1 className={styles.summaryLabel}>Gap (Supply - Demand)</Body1>
            <Title3 className={`${styles.summaryValue} ${gap >= 0 ? styles.gapPositive : styles.gapNegative}`}>
              {gap >= 0 ? '+' : ''}{gap.toFixed(1)}%
            </Title3>
          </div>
        </div>
      </div>
    </Card>
  );
};
