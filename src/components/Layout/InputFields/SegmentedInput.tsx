import React from 'react';
import { Tooltip } from './Tooltip';

interface SegmentedOption {
  value: string;
  label: string;
}

interface SegmentedInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SegmentedOption[];
  tooltip?: string;
}

export const SegmentedInput: React.FC<SegmentedInputProps> = ({
  label,
  value,
  onChange,
  options,
  tooltip
}) => {
  return (
    <div className="space-y-1.5">
      <label className="text-sm text-gray-400 font-medium uppercase tracking-wide flex items-center gap-1.5">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </label>
      <div className="flex bg-gray-800 p-1 rounded-lg border border-gray-700">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`flex-1 py-1.5 text-xs rounded-md transition-all ${
              value === option.value
                ? 'bg-green-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
};
