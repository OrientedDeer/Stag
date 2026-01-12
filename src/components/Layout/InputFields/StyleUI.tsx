import React from 'react';
import { Tooltip } from './Tooltip';

interface InputGroupProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
  error?: string;
  tooltip?: string;
}

export const InputGroup: React.FC<InputGroupProps> = ({ label, children, className = '', id, error, tooltip }) => (
  <div className="flex flex-col">
    <div className={`bg-gray-900 border rounded-md px-3 py-2 flex flex-col justify-center focus-within:ring-1 transition-all ${error ? 'border-red-500 focus-within:ring-red-400' : 'border-gray-700 focus-within:ring-green-300'} ${className}`}>
      <label htmlFor={id} className="text-xs sm:text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide leading-tight flex items-center gap-1.5" title={label}>
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </label>
      {children}
    </div>
    {error && <span className="text-red-400 text-xs mt-1">{error}</span>}
  </div>
);

interface DisplayGroupProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  tooltip?: string;
}

export const DisplayGroup: React.FC<DisplayGroupProps> = ({ label, children, className = '', tooltip }) => (
  <div className={`bg-gray-900 border border-gray-700 rounded-md px-3 py-2 flex flex-col justify-center focus-within:ring-1 focus-within:ring-green-300 transition-all ${className}`}>
    <div className="text-xs sm:text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide leading-tight flex items-center gap-1.5">
      {label}
      {tooltip && <Tooltip text={tooltip} />}
    </div>
    {children}
  </div>
);

interface StyledInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id?: string;
  error?: string;
  tooltip?: string;
}

export const StyledInput: React.FC<StyledInputProps> = ({ label, id: providedId, className = '', error, tooltip, ...props }) => {
  const id = providedId || label.toLowerCase().replace(/\s/g, '-');
  return (
    <InputGroup label={label} className={className} id={id} error={error} tooltip={tooltip}>
      <input
        id={id}
        className="bg-transparent border-none outline-none text-white text-md font-semibold placeholder-gray-600 w-full p-0 m-0 disabled:opacity-50"
        {...props}
      />
    </InputGroup>
  );
};

interface StyledSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: string[];
  id?: string;
  tooltip?: string;
}

export const StyledSelect: React.FC<StyledSelectProps> = ({ label, options, id: providedId, tooltip, ...props }) => {
  const id = providedId || label.toLowerCase().replace(/\s/g, '-');
  return (
    <InputGroup label={label} id={id} tooltip={tooltip}>
      <select
        id={id}
        className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
        {...props}
      >
        {options.map((opt) => (
          <option key={opt} value={opt} className="bg-gray-950 text-white">
            {opt}
          </option>
        ))}
      </select>
    </InputGroup>
  );
};

interface StyledDisplayProps {
  label: string;
  value: string | undefined;
  blankValue?: string;
  tooltip?: string;
}

export const StyledDisplay: React.FC<StyledDisplayProps> = ({ label, value, blankValue, tooltip }) => {
  return (
    <DisplayGroup label={label} tooltip={tooltip}>
      <div className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 flex items-center h-[21px]">
        {value || blankValue || '...'}
      </div>
    </DisplayGroup>
  );
};