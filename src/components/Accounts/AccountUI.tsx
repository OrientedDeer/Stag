import React from 'react';

interface InputGroupProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

const InputGroup: React.FC<InputGroupProps> = ({ label, children, className = '' }) => (
  <div className={`bg-gray-900 border border-gray-700 rounded-md px-3 py-2 flex flex-col justify-center focus-within:ring-1 focus-within:ring-green-300 transition-all ${className}`}>
    <label className="text-xs text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
      {label}
    </label>
    {children}
  </div>
);

interface StyledInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export const StyledInput: React.FC<StyledInputProps> = ({ label, className = '', ...props }) => {
  return (
    <InputGroup label={label} className={className}>
      <input
        className="bg-transparent border-none outline-none text-white text-sm font-semibold placeholder-gray-600 w-full p-0 m-0"
        {...props}
      />
    </InputGroup>
  );
};

interface StyledSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: string[];
}

export const StyledSelect: React.FC<StyledSelectProps> = ({ label, options, ...props }) => {
  return (
    <InputGroup label={label}>
      <select
        className="bg-transparent border-none outline-none text-white text-sm font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
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