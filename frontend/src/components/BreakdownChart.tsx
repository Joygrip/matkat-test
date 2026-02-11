/**
 * BreakdownChart – modern grouped horizontal bar chart
 *
 * Shows demand vs supply (or single-mode) per row label.
 * Features: inline value labels, row hover, summary totals, gap indicators.
 */
import { makeStyles, tokens, Badge } from '@fluentui/react-components';

export interface BreakdownRow {
  label: string;
  demandFte: number;
  supplyFte: number;
}

interface BreakdownChartProps {
  rows: BreakdownRow[];
  /** If true only show a single demand bar per row (no supply) */
  demandOnly?: boolean;
  /** If true only show a single supply bar per row (no demand) */
  supplyOnly?: boolean;
  /** Maximum value for scaling bars. Auto-detected if omitted. */
  maxValue?: number;
}

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0px',
  },
  legend: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    marginBottom: tokens.spacingVerticalM,
    paddingBottom: tokens.spacingVerticalS,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  legendSwatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr 72px',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    padding: `${tokens.spacingVerticalS} ${tokens.spacingHorizontalS}`,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusSmall,
    transition: 'background-color 0.15s ease',
    '&:hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  summaryRow: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr 72px',
    gap: tokens.spacingHorizontalM,
    alignItems: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalS}`,
    borderTop: `2px solid ${tokens.colorNeutralStroke1}`,
    marginTop: tokens.spacingVerticalXS,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: `0 0 ${tokens.borderRadiusMedium} ${tokens.borderRadiusMedium}`,
  },
  label: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightMedium,
    color: tokens.colorNeutralForeground1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  summaryLabel: {
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  },
  barGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  barTrack: {
    height: '22px',
    borderRadius: '6px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
    position: 'relative' as const,
    flex: 1,
  },
  demandBar: {
    height: '100%',
    borderRadius: '6px',
    background: `linear-gradient(90deg, #4f6bed 0%, #637ced 100%)`,
    transition: 'width 0.4s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: '8px',
    minWidth: '0px',
  },
  supplyBar: {
    height: '100%',
    borderRadius: '6px',
    background: `linear-gradient(90deg, #0ea573 0%, #2ebd8e 100%)`,
    transition: 'width 0.4s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: '8px',
    minWidth: '0px',
  },
  barValueInside: {
    fontSize: '11px',
    fontWeight: '700',
    color: 'white',
    whiteSpace: 'nowrap',
    textShadow: '0 1px 2px rgba(0,0,0,0.3)',
    lineHeight: 1,
  },
  barValueOutside: {
    fontSize: '11px',
    fontWeight: '700',
    color: tokens.colorNeutralForeground2,
    whiteSpace: 'nowrap',
    minWidth: '36px',
    lineHeight: 1,
  },
  gapCell: {
    textAlign: 'right' as const,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: tokens.spacingHorizontalXS,
  },
  gapDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  empty: {
    padding: tokens.spacingVerticalXL,
    textAlign: 'center' as const,
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase300,
  },
});

// A bar is "wide enough" for inside text when it fills > 18% of the track
const INSIDE_THRESHOLD = 0.18;

export function BreakdownChart({ rows, demandOnly, supplyOnly, maxValue: maxValueProp }: BreakdownChartProps) {
  const singleMode = demandOnly || supplyOnly;
  const styles = useStyles();

  if (rows.length === 0) {
    return <div className={styles.empty}>No data available</div>;
  }

  const maxValue =
    maxValueProp ??
    Math.max(...rows.flatMap((r) => [r.demandFte, r.supplyFte]), 1);

  const pctNum = (v: number) => Math.min(v / maxValue, 1);
  const pctStr = (v: number) => `${pctNum(v) * 100}%`;

  // Summary totals
  const totalDemand = rows.reduce((s, r) => s + r.demandFte, 0);
  const totalSupply = rows.reduce((s, r) => s + r.supplyFte, 0);
  const totalGap = totalSupply - totalDemand;

  const renderBar = (value: number, barClass: string) => {
    const wide = pctNum(value) > INSIDE_THRESHOLD;
    return (
      <div className={styles.barRow}>
        <div className={styles.barTrack}>
          <div className={barClass} style={{ width: pctStr(value) }}>
            {wide && value > 0 && (
              <span className={styles.barValueInside}>{value}%</span>
            )}
          </div>
        </div>
        {!wide && value > 0 && (
          <span className={styles.barValueOutside}>{value}%</span>
        )}
      </div>
    );
  };

  const renderGapCell = (gap: number) => {
    if (singleMode) {
      return null; // gap cell not shown in single mode; values are on the bars
    }
    const color = gap < 0 ? '#d13438' : gap > 0 ? '#0ea573' : tokens.colorNeutralForeground3;
    return (
      <span className={styles.gapCell}>
        <span className={styles.gapDot} style={{ backgroundColor: color }} />
        <Badge
          appearance="filled"
          color={gap < 0 ? 'danger' : gap > 0 ? 'success' : 'informative'}
          size="small"
        >
          {gap >= 0 ? '+' : ''}{gap}%
        </Badge>
      </span>
    );
  };

  return (
    <div className={styles.container}>
      {/* Legend */}
      <div className={styles.legend}>
        {!supplyOnly && (
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: '#4f6bed' }} />
            Demand
          </span>
        )}
        {!demandOnly && (
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: '#0ea573' }} />
            Supply
          </span>
        )}
        {!singleMode && (
          <span className={styles.legendItem}>
            <span className={styles.gapDot} style={{ backgroundColor: '#d13438', width: 10, height: 10 }} />
            Under-staffed
            <span className={styles.gapDot} style={{ backgroundColor: '#0ea573', width: 10, height: 10, marginLeft: 8 }} />
            Over-staffed
          </span>
        )}
      </div>

      {/* Data Rows */}
      {rows.map((row) => {
        const gap = row.supplyFte - row.demandFte;
        return (
          <div key={row.label} className={styles.row}>
            <span className={styles.label} title={row.label}>
              {row.label}
            </span>
            <div className={styles.barGroup}>
              {!supplyOnly && renderBar(row.demandFte, styles.demandBar)}
              {!demandOnly && renderBar(row.supplyFte, styles.supplyBar)}
            </div>
            {singleMode ? <span /> : renderGapCell(gap)}
          </div>
        );
      })}

      {/* Summary Total Row */}
      {rows.length > 1 && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryLabel}>Total</span>
          <div className={styles.barGroup}>
            {!supplyOnly && (
              <span style={{ fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightBold as any, color: '#4f6bed' }}>
                {totalDemand}% demand
              </span>
            )}
            {!demandOnly && (
              <span style={{ fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightBold as any, color: '#0ea573' }}>
                {totalSupply}% supply
              </span>
            )}
          </div>
          {singleMode ? <span /> : renderGapCell(totalGap)}
        </div>
      )}
    </div>
  );
}
