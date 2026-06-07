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
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm text-content-muted font-medium uppercase tracking-wide flex items-center gap-1.5 whitespace-nowrap truncate sm:whitespace-normal sm:overflow-visible">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </label>
      <button
        id={id}
        onClick={toggle}
        className={`relative inline-flex items-center h-6 rounded-full w-11 shrink-0 transition-colors duration-300 focus:outline-none ${
          enabled ? 'bg-positive-solid' : 'bg-surface-input'
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
