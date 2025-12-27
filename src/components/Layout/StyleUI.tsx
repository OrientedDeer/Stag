import React from 'react';

interface InputGroupProps {
  label: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const InputGroup: React.FC<InputGroupProps> = ({ label, children, className = '', id }) => (
  <div className={`bg-gray-900 border border-gray-700 rounded-md px-3 py-2 flex flex-col justify-center focus-within:ring-1 focus-within:ring-green-300 transition-all ${className}`}>
    <label htmlFor={id} className="text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
      {label}
    </label>
    {children}
  </div>
);

interface DisplayGroupProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

export const DisplayGroup: React.FC<DisplayGroupProps> = ({ label, children, className = '' }) => (
  <div className={`bg-gray-900 border border-gray-700 rounded-md px-3 py-2 flex flex-col justify-center focus-within:ring-1 focus-within:ring-green-300 transition-all ${className}`}>
    <div className="text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
      {label}
    </div>
    {children}
  </div>
);

interface StyledInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  id?: string;
}

export const StyledInput: React.FC<StyledInputProps> = ({ label, id: providedId, className = '', ...props }) => {
  const id = providedId || label.toLowerCase().replace(/\s/g, '-');
  return (
    <InputGroup label={label} className={className} id={id}>
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
}

export const StyledSelect: React.FC<StyledSelectProps> = ({ label, options, id: providedId, ...props }) => {
  const id = providedId || label.toLowerCase().replace(/\s/g, '-');
  return (
    <InputGroup label={label} id={id}>
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
}

export const StyledDisplay: React.FC<StyledDisplayProps> = ({ label, value, blankValue }) => {
  return (
    <DisplayGroup label={label}>
      <div className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 flex items-center h-[21px]">
        {value || blankValue || '...'}
      </div>
    </DisplayGroup>
  );
};