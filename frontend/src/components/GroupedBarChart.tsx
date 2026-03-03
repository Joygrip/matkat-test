import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { makeStyles } from '@fluentui/react-components';
import React from 'react';
import { schemeCategory10, interpolateRainbow } from 'd3-scale-chromatic';

const useStyles = makeStyles({
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  legend: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
    gap: '8px 16px',
    paddingTop: '8px',
    borderTop: '1px solid var(--colorNeutralStroke2)',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: 'var(--colorNeutralForeground2)',
  },
  legendSwatch: {
    width: '12px',
    height: '12px',
    borderRadius: '3px',
    flexShrink: 0,
  },
});

export interface GroupedBarChartDatum {
  label: string;
  [key: string]: string | number;
}

export interface GroupedBarChartProps {
  data: GroupedBarChartDatum[];
  demandKeys: string[];
  supplyKeys: string[];
  legendMap: Record<string, string>;
  colorMap?: Record<string, string>; // project name to color
}

// Helper: generate lighter color
function lighten(color: string, percent: number) {
  const num = parseInt(color.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = ((num >> 8) & 0x00ff) + amt;
  const B = (num & 0x0000ff) + amt;
  return (
    '#' + (
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
  );
}

// Custom tooltip for grouped bars
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  // Group by project
  const rows: Record<string, { demand?: number; supply?: number }> = {};
  payload.forEach((entry: any) => {
    const [project, type] = entry.dataKey.split('_');
    if (!rows[project]) rows[project] = {};
    rows[project][type] = entry.value;
  });
  return (
    <div style={{ background: '#fff', border: '1px solid #ccc', padding: 12, borderRadius: 8, minWidth: 180 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {Object.entries(rows).map(([project, vals]) => (
        <div key={project} style={{ marginBottom: 4 }}>
          <span style={{ fontWeight: 500 }}>{project}</span>
          <span style={{ marginLeft: 8, color: '#1976d2' }}>Demand: {vals.demand ?? 0}</span>
          <span style={{ marginLeft: 8, color: '#388e3c' }}>Supply: {vals.supply ?? 0}</span>
        </div>
      ))}
    </div>
  );
};

export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({ data, demandKeys, supplyKeys, legendMap, colorMap }) => {
  const styles = useStyles();
  // Dynamic color palette using d3-scale-chromatic
  const projectNames = Array.from(new Set([
    ...demandKeys.map(k => k.replace(/_demand$/, '')),
    ...supplyKeys.map(k => k.replace(/_supply$/, '')),
  ]));
  let projectColorMap: Record<string, string> = {};
  if (colorMap) {
    projectColorMap = colorMap;
  } else {
    // Use d3.schemeCategory10 for up to 10, then interpolateRainbow for more
    projectNames.forEach((name, i) => {
      if (i < 10) {
        projectColorMap[name] = (schemeCategory10 as string[])[i % 10];
      } else {
        projectColorMap[name] = interpolateRainbow(i / projectNames.length);
      }
    });
  }

  // Build legend items: demand then supply for each project
  const legendItems = projectNames.flatMap((project) => [
    { key: `${project}_demand`, label: legendMap[`${project}_demand`] || `${project} Demand`, color: projectColorMap[project] },
    { key: `${project}_supply`, label: legendMap[`${project}_supply`] || `${project} Supply`, color: lighten(projectColorMap[project], 40) },
  ]);

  return (
    <div className={styles.wrapper}>
      <ResponsiveContainer width="100%" height={360}>
        <BarChart data={data} margin={{ top: 16, right: 32, left: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" angle={-20} textAnchor="end" height={60} />
          <YAxis />
          <Tooltip content={<CustomTooltip />} />
          {projectNames.map((project) => [
            <Bar
              key={`${project}_demand`}
              dataKey={`${project}_demand`}
              name={legendMap[`${project}_demand`] || `${project} Demand`}
              fill={projectColorMap[project]}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />,
            <Bar
              key={`${project}_supply`}
              dataKey={`${project}_supply`}
              name={legendMap[`${project}_supply`] || `${project} Supply`}
              fill={lighten(projectColorMap[project], 40)}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />,
          ])}
        </BarChart>
      </ResponsiveContainer>
      <div className={styles.legend}>
        {legendItems.map((item) => (
          <div key={item.key} className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ backgroundColor: item.color }} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
