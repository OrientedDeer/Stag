import React, { useCallback, useId, useState } from 'react';

// --- Types ---
interface RangeSliderProps {
  label?: string;
  value: number | [number, number];
  /** Fires on release (mouseup / touchend / keyup / blur). */
  onChange: (val: any) => void;
  /**
   * Optional: fires on every drag tick with the in-flight value. Useful when
   * a parent wants to update cheap UI (numbers, labels) live but defer
   * expensive work (charts) to onChange.
   */
  onLiveChange?: (val: any) => void;
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
  onLiveChange,
  min = 0,
  max = 100,
  step = 1,
  formatTooltip = (v) => `${v}`,
  className = "",
  hideHeader = false
}) => {
  const inputId = useId(); // Generates a unique ID for accessibility

  // Buffer the in-flight drag value locally. We only call props.onChange on
  // release — driving parent state on every mousemove kicks off a full
  // downstream chart re-render per tick (~80ms on the charts tab), turning
  // a smooth drag into 4-6 frames of jank per move.
  const [pending, setPending] = useState<number | [number, number] | null>(null);
  const displayValue: number | [number, number] = pending ?? value;
  const isDual = Array.isArray(displayValue);

  const commit = useCallback(() => {
    if (pending === null) return;
    const next = pending;
    setPending(null);
    onChange(next);
  }, [pending, onChange]);

  const getPercent = useCallback(
    (val: number) => Math.round(((val - min) / (max - min)) * 100),
    [min, max]
  );

  const handleSingleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = Number(e.target.value);
    setPending(next);
    onLiveChange?.(next);
  };

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!Array.isArray(displayValue)) return;
    const val = Math.min(Number(e.target.value), displayValue[1] - step);
    const next: [number, number] = [val, displayValue[1]];
    setPending(next);
    onLiveChange?.(next);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!Array.isArray(displayValue)) return;
    const val = Math.max(Number(e.target.value), displayValue[0] + step);
    const next: [number, number] = [displayValue[0], val];
    setPending(next);
    onLiveChange?.(next);
  };

  const minPercent = isDual ? getPercent(displayValue[0]) : 0;
  const maxPercent = isDual ? getPercent(displayValue[1]) : getPercent(displayValue as number);
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
      {/* Instead of removing the header completely, we apply 'sr-only' if hideHeader is true. */}
      {/* This keeps the label in the DOM for accessibility tools to find. */}
      <div className={`flex justify-between items-baseline ${hideHeader ? 'sr-only' : ''}`}>
        {label && (
          <label 
            htmlFor={inputId} 
            className="text-xs font-semibold text-gray-400 uppercase tracking-wider"
          >
            {label}
          </label>
        )}
        <div className="font-mono text-sm text-emerald-400">
          {isDual
            ? `${formatTooltip((displayValue as [number, number])[0])} - ${formatTooltip((displayValue as [number, number])[1])}`
            : formatTooltip(displayValue as number)
          }
        </div>
      </div>

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
              id={inputId} // Associate first handle with label
              type="range"
              min={min}
              max={max}
              step={step}
              value={(displayValue as [number, number])[0]}
              onChange={handleMinChange}
              onMouseUp={commit}
              onTouchEnd={commit}
              onKeyUp={commit}
              onBlur={commit}
              className="custom-range-input absolute top-0 left-0 w-full h-full appearance-none bg-transparent pointer-events-none z-20"
              aria-label={`${label} minimum`} // Explicit label for dual slider handles
            />
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={(displayValue as [number, number])[1]}
              onChange={handleMaxChange}
              onMouseUp={commit}
              onTouchEnd={commit}
              onKeyUp={commit}
              onBlur={commit}
              className="custom-range-input absolute top-0 left-0 w-full h-full appearance-none bg-transparent pointer-events-none z-20"
              aria-label={`${label} maximum`} // Explicit label for dual slider handles
            />
          </>
        ) : (
          <input
            id={inputId} // Associate single handle with label
            type="range"
            min={min}
            max={max}
            step={step}
            value={displayValue as number}
            onChange={handleSingleChange}
            onMouseUp={commit}
            onTouchEnd={commit}
            onKeyUp={commit}
            onBlur={commit}
            className="custom-range-input absolute top-0 left-0 w-full h-full appearance-none bg-transparent z-20 cursor-pointer"
          />
        )}
      </div>
    </div>
  );
};