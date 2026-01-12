import React from 'react';
import { Tooltip } from './Tooltip';

interface ToggleInputProps {
  label: string;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  id?: string;
  tooltip?: string;
}

export const ToggleInput: React.FC<ToggleInputProps> = ({ label, enabled, setEnabled, id, tooltip }) => {
  const toggle = () => setEnabled(!enabled);

  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="text-sm text-gray-400 font-medium uppercase tracking-wide flex items-center gap-1.5">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </label>
      <button
        id={id}
        onClick={toggle}
        className={`relative inline-flex items-center h-6 rounded-full w-11 transition-colors duration-300 focus:outline-none ${
          enabled ? 'bg-green-600' : 'bg-gray-700'
        }`}
      >
        <span
          className={`inline-block w-4 h-4 transform bg-white rounded-full transition-transform duration-300 ${
            enabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
};
