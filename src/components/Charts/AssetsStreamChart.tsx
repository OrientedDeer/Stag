import React, { useState, useMemo } from 'react';
import { ResponsiveStream } from '@nivo/stream';
import { RangeSlider } from '../Layout/InputFields/RangeSlider'; // Adjust path if needed

// --- Types ---
export interface AssetStreamData {
  year: number;
  [key: string]: any; 
}

interface AssetsStreamChartProps {
  data: AssetStreamData[];
  keys: string[]; 
  colors?: Record<string, string>; 
}

const formatCurrency = (value: number) => 
  new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);

export const AssetsStreamChart: React.FC<AssetsStreamChartProps> = ({ 
  data, 
  keys,
  colors 
}) => {
  const [mode, setMode] = useState<'value' | 'percent'>('value');

  // --- RANGE SLIDER LOGIC ---
  const minYear = data.length > 0 ? data[0].year : 2025;
  const maxYear = data.length > 0 ? data[data.length - 1].year : 2060;
  const [range, setRange] = useState<[number, number]>([minYear, Math.min(maxYear, minYear + 32)]);

  const filteredData = useMemo(() => {
    return data.filter(d => d.year >= range[0] && d.year <= range[1]);
  }, [data, range]);

  const theme = {
    axis: { ticks: { text: { fill: '#9ca3af', fontSize: 11 } } },
    grid: { line: { stroke: '#374151', strokeWidth: 1, strokeDasharray: '4 4' } },
    tooltip: {
      container: {
        background: '#111827',
        color: '#f3f4f6',
        fontSize: '12px',
        borderRadius: '6px',
        border: '1px solid #374151',
      },
    },
  };

  const CustomTooltip = ({ index }: any) => {
    const yearData = filteredData[index]; // Use filtered data
    if (!yearData) return null;
    const total = keys.reduce((sum, key) => sum + (Number(yearData[key]) || 0), 0);
    const sortedKeys = [...keys].sort((a, b) => (Number(yearData[b]) || 0) - (Number(yearData[a]) || 0));

    return (
      <div className="bg-gray-900/95 backdrop-blur-sm p-3 border border-gray-700 shadow-xl rounded-lg text-sm z-50 min-w-max">
        <div className="mb-2 pb-2 border-b border-gray-700 flex justify-between items-baseline gap-8">
          <span className="font-bold text-gray-200">{yearData.year}</span>
          <span className="font-mono font-semibold text-white">{formatCurrency(total)}</span>
        </div>
        <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <tbody>
              {sortedKeys.map((key) => {
                const value = Number(yearData[key]) || 0;
                if (value === 0) return null;
                const color = colors ? colors[key] : '#cbd5e1';
                return (
                  <tr key={key}>
                    <td className="py-1 pr-6 whitespace-nowrap flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                        <span className="text-gray-300 font-medium">{key}</span>
                    </td>
                    <td className="py-1 text-right font-mono text-gray-100 whitespace-nowrap">{formatCurrency(value)}</td>
                    <td className="py-1 pl-4 text-right text-xs text-gray-500 whitespace-nowrap">{Math.round((value / total) * 100)}%</td>
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
      {/* Header & Controls */}
      <div className="flex flex-row justify-between items-end mb-4 gap-8">
        <div className="flex-1">
            <RangeSlider 
                label="Timeline"
                value={range}
                min={minYear}
                max={maxYear}
                onChange={setRange}
            />
        </div>
        <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700 h-fit">
          <button onClick={() => setMode('value')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'value' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}>Value ($)</button>
          <button onClick={() => setMode('percent')} className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${mode === 'percent' ? 'bg-gray-600 text-white' : 'text-gray-400'}`}>Allocation (%)</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        <ResponsiveStream
          data={filteredData}
          keys={keys}
          theme={theme}
          margin={{ top: 20, right: 30, bottom: 50, left: 90 }}
          valueFormat={formatCurrency}
          offsetType={mode === 'value' ? 'none' : 'expand'}
          colors={({ id }) => (colors && colors[String(id)]) ? colors[String(id)] : '#cbd5e1'}
          fillOpacity={0.85}
          borderWidth={1}
          borderColor={{ from: 'color', modifiers: [['darker', 0.2]] }}
          curve="catmullRom" 
          axisBottom={{
            tickSize: 5,
            tickPadding: 5,
            format: (idx) => filteredData[idx]?.year || '',
            tickValues: 5
          }}
          axisLeft={mode === 'percent' 
            ? { tickValues: [0, .25, .5, .75, 1], format: '>-.0%' }
            : { tickValues: 10, format: (v) => formatCurrency(Number(v)).replace('.00', '') }
          }
          enableGridX={false}
          enableGridY={true}
          animate={true}
          tooltip={CustomTooltip}
        />
      </div>
    </div>
  );
};