import React, { useRef, useState, useEffect, useMemo, useContext } from 'react';
import { ResponsiveStream } from '@nivo/stream';
import { AssumptionsContext } from '../Objects/Assumptions/AssumptionsContext';
import { formatCompactCurrency } from '../../tabs/Future/tabs/FutureUtils';
import { useChartTheme } from './useChartTheme';

const MIN_CHART_WIDTH = 300;

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

// --- Component ---
export const DebtStreamChart: React.FC<DebtStreamChartProps> = ({
  data,
  keys,
  colors
}) => {
  const { theme: themeKey, resolve } = useChartTheme();
  // Use data as-is; the parent component (DebtTab) controls the range via slider
  const trimmedData = data;


  const { state: assumptions } = useContext(AssumptionsContext);
  const forceExact = assumptions.display?.useCompactCurrency === false;
  const formatCurrency = (value: number) => formatCompactCurrency(value, { forceExact });

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);

  // Responsive width detection using ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const isMobile = (containerWidth ?? 800) < 640;
  const isNarrow = containerWidth !== null && containerWidth < MIN_CHART_WIDTH;
  const isMeasured = containerWidth !== null;

  // Calculate x-axis tick values (indices) to prevent label overlap
  const xTickValues = useMemo(() => {
    if (trimmedData.length === 0) return undefined;

    const range = trimmedData.length;
    const mobile = (containerWidth ?? 800) < 640;

    let step = 1;
    if (mobile) {
      if (range > 30) step = 5;
      else if (range > 15) step = 3;
      else if (range > 8) step = 2;
    } else {
      if (range > 40) step = 5;
      else if (range > 20) step = 2;
    }

    // Return indices at regular intervals
    return trimmedData
      .map((_, i) => i)
      .filter((i) => i === 0 || i === trimmedData.length - 1 || i % step === 0);
  }, [trimmedData, containerWidth]);

  // Dark Theme for Nivo to match Overview/Cashflow style
  const theme = {
    axis: {
      ticks: {
        text: {
          fill: 'var(--c-content-muted)', // gray-400
          fontSize: 11,
        },
      },
    },
    grid: {
      line: {
        stroke: 'var(--c-border-default)', // gray-700
        strokeWidth: 1,
        strokeDasharray: '4 4',
      },
    },
    tooltip: {
      container: {
        background: 'var(--c-surface-raised)', // gray-900
        color: 'var(--c-content-bright)', // gray-100
        fontSize: '12px',
        borderRadius: '6px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        border: '1px solid var(--c-border-default)',
        zIndex: 9999,
      },
    },
  };

  // 1. Smart Tooltip Logic
  const CustomTooltip = ({ index }: any) => {
    const yearData = trimmedData[index];
    if (!yearData) return null;

    const total = keys.reduce((sum, key) => sum + (Number(yearData[key]) || 0), 0);

    const sortedKeys = [...keys].sort((a, b) => {
      const valA = Number(yearData[a]) || 0;
      const valB = Number(yearData[b]) || 0;
      return valB - valA;
    });

    return (
      // 'min-w-max' on the container + Table layout forces expansion
      <div className="bg-surface-raised/95 backdrop-blur-sm p-3 border border-border-default shadow-xl rounded-lg text-sm z-50 min-w-max">
        
        {/* Header */}
        <div className="mb-2 pb-2 border-b border-border-default flex justify-between items-baseline gap-8">
          <span className="font-bold text-content-emphasis">{yearData.year}</span>
          <span className="font-mono font-semibold text-white">{formatCurrency(total)}</span>
        </div>

        {/* Scrollable Area */}
        <div className="max-h-75 overflow-y-auto custom-scrollbar">
          <table className="w-full border-collapse">
            <tbody>
              {sortedKeys.map((key) => {
                const value = Number(yearData[key]) || 0;
                if (value <= 0) return null;

                const color = colors ? colors[key] : 'var(--c-content-default)';

                return (
                  <tr key={key}>
                    {/* Column 1: Dot + Name (No Wrap) */}
                    <td className="py-1 pr-6 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                          <span className="text-content-default font-medium">{key}</span>
                      </div>
                    </td>

                    {/* Column 2: Value (Aligned Right) */}
                    <td className="py-1 text-right font-mono text-content-bright whitespace-nowrap">
                      {formatCurrency(value)}
                    </td>

                    {/* Column 3: Percent (Aligned Right) */}
                    <td className="py-1 pl-4 text-right text-xs text-content-muted whitespace-nowrap">
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

  // Show loading state until measured
  if (!isMeasured) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <p className="text-content-muted text-sm">Loading chart...</p>
      </div>
    );
  }

  // Show message when container is too narrow for the chart
  if (isNarrow) {
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center border-2 border-dashed border-border-default rounded-xl">
        <p className="text-content-muted text-sm text-center px-4">Expand window to view chart</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex flex-col">
      {/* Chart Area */}
      <div className="flex-1 min-h-0 relative text-white">
        <ResponsiveStream
          key={themeKey}
          data={trimmedData}
          keys={keys}
          theme={theme}
          margin={isMobile ? { top: 10, right: 10, bottom: 40, left: 50 } : { top: 20, right: 30, bottom: 50, left: 70 }}
          valueFormat={formatCurrency}

          offsetType='none'

          // Visuals
          colors={({ id }) => resolve((colors && colors[String(id)]) ? colors[String(id)] : 'var(--c-content-default)')}
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
            format: (index) => trimmedData[index]?.year ?? '',
            tickValues: xTickValues,
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
        />
      </div>

      {/* Footer / Legend Note */}
      <div className="mt-2 text-xs text-center text-content-muted">
        Hover over any year to see the full breakdown of all loans.
      </div>
    </div>
  );
};
