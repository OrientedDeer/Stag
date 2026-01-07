import React from 'react';
import { ResponsiveStream } from '@nivo/stream';

// --- Types ---
export interface DebtStreamData {
  year: number;
  [key: string]: any; // Dynamic keys for asset names
}

interface DebtStreamChartProps {
  data: DebtStreamData[];
  keys: string[]; // The list of asset names to display
  colors?: Record<string, string>; // Optional mapping of Asset Name -> Color Code
}

// --- Helper: Format Currency ---
const formatCurrency = (value: number) => 
  new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);

// --- Component ---
export const DebtStreamChart: React.FC<DebtStreamChartProps> = ({ 
  data, 
  keys,
  colors 
}) => {

  // Dark Theme for Nivo to match Overview/Cashflow style
  const theme = {
    axis: {
      ticks: {
        text: {
          fill: '#9ca3af', // gray-400
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: '#374151', // gray-700
        strokeWidth: 1,
        strokeDasharray: '4 4',
      },
    },
    tooltip: {
      container: {
        background: '#111827', // gray-900
        color: '#f3f4f6', // gray-100
        fontSize: '12px',
        borderRadius: '6px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        border: '1px solid #374151',
      },
    },
  };

  // 1. Smart Tooltip Logic
  const CustomTooltip = ({ index }: any) => {
    const yearData = data[index];
    if (!yearData) return null;

    const total = keys.reduce((sum, key) => sum + (Number(yearData[key]) || 0), 0);

    const sortedKeys = [...keys].sort((a, b) => {
      const valA = Number(yearData[a]) || 0;
      const valB = Number(yearData[b]) || 0;
      return valB - valA;
    });

    return (
      // 'min-w-max' on the container + Table layout forces expansion
      <div className="bg-gray-900/95 backdrop-blur-sm p-3 border border-gray-700 shadow-xl rounded-lg text-sm z-50 min-w-max">
        
        {/* Header */}
        <div className="mb-2 pb-2 border-b border-gray-700 flex justify-between items-baseline gap-8">
          <span className="font-bold text-gray-200">{yearData.year}</span>
          <span className="font-mono font-semibold text-white">{formatCurrency(total)}</span>
        </div>

        {/* Scrollable Area */}
        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <tbody>
              {sortedKeys.map((key) => {
                const value = Number(yearData[key]) || 0;
                if (value <= 0) return null;

                const color = colors ? colors[key] : '#cbd5e1';

                return (
                  <tr key={key}>
                    {/* Column 1: Dot + Name (No Wrap) */}
                    <td className="py-1 pr-6 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-gray-300 font-medium">{key}</span>
                      </div>
                    </td>

                    {/* Column 2: Value (Aligned Right) */}
                    <td className="py-1 text-right font-mono text-gray-100 whitespace-nowrap">
                      {formatCurrency(value)}
                    </td>

                    {/* Column 3: Percent (Aligned Right) */}
                    <td className="py-1 pl-4 text-right text-xs text-gray-500 whitespace-nowrap">
                      {total > 0 ? `${Math.round((value / total) * 100)}%` : '0%'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="w-full h-full flex flex-col">
      {/* Chart Area */}
      <div className="flex-1 min-h-0 relative text-white">
        <ResponsiveStream
          data={data}
          keys={keys}
          theme={theme}
          margin={{ top: 20, right: 30, bottom: 50, left: 70 }}
          valueFormat={formatCurrency}
          
          offsetType='none'
          
          // Visuals
          colors={({ id }) => (colors && colors[String(id)]) ? colors[String(id)] : '#cbd5e1'}
          fillOpacity={0.85}
          borderWidth={1}
          borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
          
          // Smoothness - 'catmullRom' looks organic for "Wealth"
          curve="step" 
          
          // Axes
          axisTop={null}
          axisRight={null}
          axisBottom={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            // Map the index back to the Year from data
            format: (index) => data[index] ? data[index].year : '',
            tickValues: 5 // Limit ticks to avoid clutter
          }}
          axisLeft={{
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            format: (value) => formatCurrency(value as number),
            tickValues: 5, 
          }}

          // Interactivity
          enableGridX={false}
          enableGridY={true}
          animate={true}
          
          // The Custom Tooltip
          tooltip={CustomTooltip}
          
          // Patterns/Gradients (Optional: adds texture)
          defs={[
            {
              id: 'gradient',
              type: 'linearGradient',
              colors: [
                { offset: 0, color: 'inherit', opacity: 0.9 },
                { offset: 100, color: 'inherit', opacity: 0.4 },
              ],
            },
          ]}
          fill={[{ match: '*', id: 'gradient' }]}
        />
      </div>

      {/* Footer / Legend Note */}
      <div className="mt-2 text-xs text-center text-gray-500">
        Hover over any year to see the full breakdown of all loans.
      </div>
    </div>
  );
};
