import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { tokens } from '@fluentui/react-components';
import React from 'react';
import { schemeCategory10, interpolateRainbow } from 'd3-scale-chromatic';

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

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 16, right: 32, left: 8, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" angle={-20} textAnchor="end" height={60} />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        {demandKeys.map((key) => {
          const project = key.replace(/_demand$/, '');
          return (
            <Bar
              key={key}
              dataKey={key}
              name={legendMap[key] || key}
              fill={projectColorMap[project]}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />
          );
        })}
        {supplyKeys.map((key) => {
          const project = key.replace(/_supply$/, '');
          return (
            <Bar
              key={key}
              dataKey={key}
              name={legendMap[key] || key}
              fill={lighten(projectColorMap[project], 40)}
              radius={[4, 4, 0, 0]}
              barSize={18}
            />
          );
        })}
      </BarChart>
    </ResponsiveContainer>
  );
};
