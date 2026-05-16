import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { makeStyles } from '@fluentui/react-components';
import React, { useRef, useState } from 'react';
import { schemeCategory10, interpolateRainbow } from 'd3-scale-chromatic';
import type { GroupedBarChartDatum } from './GroupedBarChart';

const useStyles = makeStyles({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  legendEntities: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px 16px',
    paddingBottom: '8px',
  },
  legendEntityItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: 'var(--colorNeutralForeground2)',
  },
  legendEntitySwatch: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
  },
  legendEntityLabel: {
    maxWidth: '140px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  legendTypes: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px 20px',
    paddingTop: '8px',
    borderTop: '1px solid var(--colorNeutralStroke2)',
  },
  legendTypeItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    color: 'var(--colorNeutralForeground3)',
  },
  legendTypeSwatch: {
    width: '10px',
    height: '10px',
    borderRadius: '2px',
    flexShrink: 0,
  },
});

// Shared with GroupedBarChart
function lighten(color: string, percent: number): string {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;
  return (
    '#' +
    (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
  );
}

// 4 colour variants per entity: base (planned), +20% (actual), +40% (OoP), +60% (equipment)
const SUFFIXES = ['_planned', '_actual', '_oop', '_equipment'] as const;
const LIGHTEN_AMOUNTS = [0, 20, 40, 60] as const;

// Reference gray used for cost-type shade key in legend
const LEGEND_REF_COLOR = '#666666';

const dkkCompact = (v: number) =>
  new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
    maximumFractionDigits: 0,
    notation: 'compact',
  } as Intl.NumberFormatOptions).format(v);

const dkkFull = (v: number) =>
  new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: 'DKK',
    maximumFractionDigits: 0,
  }).format(v);

const CATEGORY_LABELS: Record<string, string> = {
  planned: 'Planned',
  actual: 'Actual',
  oop: 'OoP',
  equipment: 'Equipment',
};

const TOOLTIP_CATEGORIES = ['planned', 'actual', 'oop', 'equipment'];

interface TooltipEntry { dataKey: string; value: number; }
interface CostTooltipProps { active?: boolean; payload?: TooltipEntry[]; label?: string; }

const CustomTooltip = ({ active, payload, label }: CostTooltipProps) => {
  if (!active || !payload || !payload.length) return null;

  // Group by entity name (everything before the last underscore)
  const rows: Record<string, Record<string, number>> = {};
  payload.forEach((entry: TooltipEntry) => {
    const lastUnderscore = entry.dataKey.lastIndexOf('_');
    const entity = entry.dataKey.slice(0, lastUnderscore);
    const category = entry.dataKey.slice(lastUnderscore + 1);
    if (!rows[entity]) rows[entity] = {};
    rows[entity][category] = entry.value;
  });

  const grandTotal = Object.values(rows).reduce((sum, vals) => {
    return sum + (vals['actual'] ?? 0) + (vals['oop'] ?? 0) + (vals['equipment'] ?? 0);
  }, 0);

  return (
    <div style={{ background: '#fff', border: '1px solid #ccc', padding: 12, borderRadius: 8, minWidth: 220 }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {Object.entries(rows).map(([entity, vals]) => {
        const entityTotal = (vals['actual'] ?? 0) + (vals['oop'] ?? 0) + (vals['equipment'] ?? 0);
        return (
          <div key={entity} style={{ marginBottom: 8 }}>
            <div style={{ fontWeight: 500, marginBottom: 2, fontSize: 13 }}>{entity}</div>
            {['planned', 'actual', 'oop', 'equipment'].map((cat) =>
              vals[cat] !== undefined ? (
                <div key={cat} style={{ color: '#555', fontSize: 12 }}>
                  {CATEGORY_LABELS[cat]}: {dkkFull(vals[cat])}
                </div>
              ) : null
            )}
            <div style={{ color: '#222', fontSize: 12, fontWeight: 600, marginTop: 2, borderTop: '1px solid #eee', paddingTop: 2 }}>
              Total: {dkkFull(entityTotal)}
            </div>
          </div>
        );
      })}
      {Object.keys(rows).length > 1 && (
        <div style={{ borderTop: '1px solid #bbb', marginTop: 4, paddingTop: 6, fontWeight: 700, fontSize: 12 }}>
          Grand Total: {dkkFull(grandTotal)}
        </div>
      )}
    </div>
  );
};

export interface CostGroupedBarChartProps {
  data: GroupedBarChartDatum[];
  entityNames: string[];
  legendMap: Record<string, string>;
  onBarClick?: (entityName: string, label: string) => void;
  hiddenCategories?: ReadonlyArray<'planned' | 'actual' | 'oop' | 'equipment'>;
}

export const CostGroupedBarChart: React.FC<CostGroupedBarChartProps> = ({ data, entityNames, legendMap, onBarClick, hiddenCategories = [] }) => {
  const styles = useStyles();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | undefined>(undefined);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const TOOLTIP_WIDTH = 260;
    setTooltipPos(
      relX > rect.width / 2
        ? { x: 8, y: 20 }
        : { x: rect.width - TOOLTIP_WIDTH - 8, y: 20 }
    );
  };

  const colorMap: Record<string, string> = {};
  entityNames.forEach((name, i) => {
    colorMap[name] =
      i < 10
        ? (schemeCategory10 as string[])[i % 10]
        : interpolateRainbow(i / entityNames.length);
  });

  return (
    <div className={styles.wrapper}>
      <div ref={wrapperRef} onMouseMove={handleMouseMove} onMouseLeave={() => setTooltipPos(undefined)}>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={data} margin={{ top: 16, right: 32, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" angle={0} textAnchor="middle" height={40} tick={{ fontSize: 13 }} minTickGap={8} />
          <YAxis tickFormatter={dkkCompact} width={72} />
          <Tooltip content={<CustomTooltip />} position={tooltipPos} wrapperStyle={{ pointerEvents: 'none' }} />
          {entityNames.flatMap((entity) =>
            SUFFIXES.filter((suffix) => !hiddenCategories.includes(suffix.slice(1) as 'planned' | 'actual' | 'oop' | 'equipment')).map((suffix, idx, visibleSuffixes) => (
              <Bar
                key={`${entity}${suffix}`}
                dataKey={`${entity}${suffix}`}
                stackId={entity}
                name={legendMap[`${entity}${suffix}`] ?? `${entity} ${suffix.slice(1)}`}
                fill={lighten(colorMap[entity], LIGHTEN_AMOUNTS[SUFFIXES.indexOf(suffix)])}
                radius={idx === visibleSuffixes.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                barSize={24}
                style={{ cursor: onBarClick ? 'pointer' : 'default' }}
                onClick={(barData) => onBarClick?.(entity, String((barData as unknown as GroupedBarChartDatum).label))}
              />
            ))
          )}
        </BarChart>
      </ResponsiveContainer>
      </div>
      {/* Legend: Section A — entity color chips */}
      <div className={styles.legendEntities}>
        {entityNames.map((entity) => (
          <div key={entity} className={styles.legendEntityItem}>
            <span className={styles.legendEntitySwatch} style={{ backgroundColor: colorMap[entity] }} />
            <span className={styles.legendEntityLabel} title={entity}>{entity}</span>
          </div>
        ))}
      </div>
      {/* Legend: Section B — cost type shade key (only visible categories) */}
      <div className={styles.legendTypes}>
        {SUFFIXES.filter((suffix) => !hiddenCategories.includes(suffix.slice(1) as 'planned' | 'actual' | 'oop' | 'equipment')).map((suffix) => (
          <div key={suffix} className={styles.legendTypeItem}>
            <span
              className={styles.legendTypeSwatch}
              style={{ backgroundColor: lighten(LEGEND_REF_COLOR, LIGHTEN_AMOUNTS[SUFFIXES.indexOf(suffix)]) }}
            />
            <span>{CATEGORY_LABELS[suffix.slice(1)]}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
