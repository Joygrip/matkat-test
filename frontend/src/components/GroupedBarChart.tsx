import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts';
import { tokens } from '@fluentui/react-components';
import React from 'react';

export interface GroupedBarChartDatum {
  label: string;
  [key: string]: string | number;
}

export interface GroupedBarChartProps {
  data: GroupedBarChartDatum[];
  demandKeys: string[]; // e.g. ['demand_Feb2026', 'demand_Mar2026']
  supplyKeys: string[]; // e.g. ['supply_Feb2026', 'supply_Mar2026']
  legendMap: Record<string, string>; // key to label
}

export const GroupedBarChart: React.FC<GroupedBarChartProps> = ({ data, demandKeys, supplyKeys, legendMap }) => {
  // Assign colors for each series
  const colors = [tokens.colorPaletteBlueBackground2, tokens.colorPaletteGreenBackground2, tokens.colorPaletteRedBackground2, tokens.colorPalettePurpleBackground2, tokens.colorPaletteOrangeBackground2];
  const allKeys = [...demandKeys, ...supplyKeys];

  return (
    <ResponsiveContainer width="100%" height={360}>
      <BarChart data={data} margin={{ top: 16, right: 32, left: 8, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="label" angle={-20} textAnchor="end" height={60} />
        <YAxis />
        <Tooltip />
        <Legend />
        {demandKeys.map((key, i) => (
          <Bar key={key} dataKey={key} name={legendMap[key] || key} fill={colors[i % colors.length]} stackId="demand" />
        ))}
        {supplyKeys.map((key, i) => (
          <Bar key={key} dataKey={key} name={legendMap[key] || key} fill={colors[(i + demandKeys.length) % colors.length]} stackId="supply" />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
};
