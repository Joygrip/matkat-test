import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import React from 'react';
import type { EmployeeStats } from '../api/finance';

const DEMAND_COLOR = '#1976d2';
const ACTUALS_COLOR = '#388e3c';

interface DemandVsActualsBarChartProps {
  data: EmployeeStats[];
  height?: number;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #ccc', padding: 12, borderRadius: 8, minWidth: 160 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((entry) => (
        <div key={entry.name} style={{ marginBottom: 2, color: entry.color }}>
          {entry.name}: {entry.value}%
        </div>
      ))}
    </div>
  );
};

export const DemandVsActualsBarChart: React.FC<DemandVsActualsBarChartProps> = ({ data, height = 320 }) => {
  const chartData = data.map((row) => ({
    name: row.employee_name,
    demand_fte: row.demand_fte,
    actuals_fte: row.actuals_fte,
  }));

  if (chartData.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} margin={{ top: 16, right: 32, left: 8, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="name" angle={-20} textAnchor="end" height={60} />
        <YAxis />
        <Tooltip content={<CustomTooltip />} />
        <Legend />
        <Bar dataKey="demand_fte" name="Demand" fill={DEMAND_COLOR} radius={[4, 4, 0, 0]} barSize={24} />
        <Bar dataKey="actuals_fte" name="Actuals" fill={ACTUALS_COLOR} radius={[4, 4, 0, 0]} barSize={24} />
      </BarChart>
    </ResponsiveContainer>
  );
};
