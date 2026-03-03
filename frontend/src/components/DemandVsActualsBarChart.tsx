import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import React from 'react';

export interface DemandVsActualsDatum {
  label: string;
  demand: number;
  actuals: number;
}

export interface DemandVsActualsBarChartProps {
  data: DemandVsActualsDatum[];
}

const DEMAND_COLOR = '#4f6bed';
const ACTUALS_COLOR = '#0ea573';

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #ccc', padding: 12, borderRadius: 8, minWidth: 160 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ marginBottom: 4, color: entry.color }}>
          {entry.name}: {entry.value}%
        </div>
      ))}
    </div>
  );
};

export const DemandVsActualsBarChart: React.FC<DemandVsActualsBarChartProps> = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 16, right: 32, left: 8, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" angle={-20} textAnchor="end" height={60} />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar dataKey="demand" name="Demand" fill={DEMAND_COLOR} radius={[4, 4, 0, 0]} barSize={24} />
        <Bar dataKey="actuals" name="Actuals" fill={ACTUALS_COLOR} radius={[4, 4, 0, 0]} barSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
};
