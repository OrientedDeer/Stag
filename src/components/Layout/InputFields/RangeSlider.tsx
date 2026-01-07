import React, { useCallback } from 'react';

// --- Types ---
interface RangeSliderProps {
  label?: string;
  value: number | [number, number];
  onChange: (val: any) => void;
  min?: number;
  max?: number;
  step?: number;
  formatTooltip?: (val: number) => string;
  className?: string;
  hideHeader?: boolean;
}

// --- Styles ---
const TRACK_BG = "bg-gray-700";
const TRACK_FILL = "bg-emerald-600/80";

export const RangeSlider: React.FC<RangeSliderProps> = ({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  formatTooltip = (v) => `${v}`,
  className = "",
  hideHeader = false
}) => {
  const isDual = Array.isArray(value);

  const getPercent = useCallback(
    (val: number) => Math.round(((val - min) / (max - min)) * 100),
    [min, max]
  );

  const handleSingleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value));
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!Array.isArray(value)) return;
    const val = Math.min(Number(e.target.value), value[1] - step);
    onChange([val, value[1]]);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!Array.isArray(value)) return;
    const val = Math.max(Number(e.target.value), value[0] + step);
    onChange([value[0], val]);
  };

  const minPercent = isDual ? getPercent(value[0]) : 0;
  const maxPercent = isDual ? getPercent(value[1]) : getPercent(value as number);
  const widthPercent = maxPercent - minPercent;

  return (
    <div className={`flex flex-col gap-2 w-full ${className}`}>
      <style>{`
        /* Shared Thumb Styles */
        .range-thumb-style {
          pointer-events: auto;
          cursor: grab;
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background-color: #10b981; /* emerald-500 */
          border: 2px solid #1f2937; /* gray-800 */
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
          -webkit-appearance: none;
          appearance: none;
        }
        
        /* Webkit Target (Chrome/Safari/Edge) */
        .custom-range-input::-webkit-slider-thumb {
          pointer-events: auto;
          cursor: grab;
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background-color: #10b981;
          border: 2px solid #1f2937;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
          -webkit-appearance: none;
          
          /* Fixed vertical alignment, removed horizontal shift */
          margin-top: 0px; 
        }

        /* Mozilla Target (Firefox) */
        .custom-range-input::-moz-range-thumb {
          pointer-events: auto;
          cursor: grab;
          height: 16px;
          width: 16px;
          border-radius: 9999px;
          background-color: #10b981;
          border: 2px solid #1f2937;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
          border: none;
        }
      `}</style>

      {/* Label Row */}
      {!hideHeader && (
        <div className="flex justify-between items-baseline">
          {label && (
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
              {label}
            </label>
          )}
          <div className="font-mono text-sm text-emerald-400">
            {isDual 
              ? `${formatTooltip(value[0])} - ${formatTooltip(value[1])}`
              : formatTooltip(value as number)
            }
          </div>
        </div>
      )}

      {/* Slider Container */}
      <div className="relative w-full h-6 flex items-center select-none group isolate">
        
        {/* Visual Tracks Container (Inset by mx-1 to make bar "less wide") */}
        <div className="absolute w-full h-2 px-1 -z-10">
          <div className="relative w-full h-full">
            {/* 1. Background Track (Gray) */}
            <div className={`absolute w-full h-full rounded-full ${TRACK_BG}`} />

            {/* 2. Active Range Track (Colored) */}
            <div 
              className={`absolute h-full rounded-full ${TRACK_FILL}`}
              style={{ 
                left: `${minPercent}%`, 
                width: `${widthPercent}%` 
              }}
            />
          </div>
        </div>

        {/* 3. Inputs (Full width, not inset, to handle interaction correctly) */}
        {isDual ? (
          <>
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[0]}
              onChange={handleMinChange}
              className="custom-range-input absolute top-0 left-0 w-full h-full appearance-none bg-transparent pointer-events-none z-20"
            />
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value[1]}
              onChange={handleMaxChange}
              className="custom-range-input absolute top-0 left-0 w-full h-full appearance-none bg-transparent pointer-events-none z-20"
            />
          </>
        ) : (
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value as number}
            onChange={handleSingleChange}
            className="custom-range-input absolute top-0 left-0 w-full h-full appearance-none bg-transparent z-20 cursor-pointer"
          />
        )}
      </div>
    </div>
  );
};