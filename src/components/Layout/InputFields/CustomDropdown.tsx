import React, { useEffect, useId, useRef, useState } from 'react';
import { Listbox, Portal } from '@headlessui/react';
import { InputGroup } from './StyleUI';

type Option = { value: string; label: string } | string;

interface CustomDropdownProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: Option[];
    error?: string;
    id?: string;
    tooltip?: string;
}

const ChevronIcon = ({ open }: { open: boolean }) => (
    <svg
        className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
    >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
);

const CustomDropdownInner: React.FC<CustomDropdownProps> = ({
    label,
    value,
    onChange,
    options,
    error,
    id,
    tooltip
}) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number; width: number } | null>(null);

    const normalizedOptions = options.map(opt =>
        typeof opt === 'string' ? { value: opt, label: opt } : opt
    );

    // Auto-select first option if value is empty or not in options list
    useEffect(() => {
        if (normalizedOptions.length === 0) return;

        const optionValues = normalizedOptions.map(opt => opt.value);
        const valueIsEmpty = value === '' || value === undefined || value === null;
        const valueNotInOptions = !optionValues.includes(value);

        if (valueIsEmpty || valueNotInOptions) {
            onChange(optionValues[0]);
        }
    }, [normalizedOptions, value, onChange]);

    const selectedOption = normalizedOptions.find(opt => opt.value === value);

    // Generate a stable id for accessibility
    const reactId = useId();
    const buttonId = id || label.toLowerCase().replace(/\s+/g, '-') || reactId;

    // Update dropdown position when opening
    const updatePosition = () => {
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom + window.scrollY + 4,
                left: rect.left + window.scrollX,
                width: rect.width
            });
        }
    };

    return (
        <InputGroup label={label} id={buttonId} error={error} tooltip={tooltip}>
            <Listbox value={value} onChange={onChange}>
                {({ open }) => (
                    <div className="relative">
                        <Listbox.Button
                            ref={buttonRef}
                            id={buttonId}
                            onClick={updatePosition}
                            className="w-full text-left flex items-center justify-between bg-transparent text-white text-md font-semibold cursor-pointer"
                        >
                            <span>{selectedOption?.label || value}</span>
                            <ChevronIcon open={open} />
                        </Listbox.Button>
                        {dropdownPosition && (
                            <Portal>
                                <Listbox.Options
                                    className="fixed z-[9999] bg-gray-900 border border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto focus:outline-none"
                                    style={{
                                        top: dropdownPosition.top,
                                        left: dropdownPosition.left,
                                        width: dropdownPosition.width || 'auto',
                                        minWidth: '120px'
                                    }}
                                >
                                {normalizedOptions.map(opt => (
                                    <Listbox.Option
                                        key={opt.value}
                                        value={opt.value}
                                        className={({ active, selected }) =>
                                            `px-3 py-2 cursor-pointer ${active ? 'bg-gray-800' : ''} ${selected ? 'text-green-400' : 'text-white'}`
                                        }
                                    >
                                        {opt.label}
                                    </Listbox.Option>
                                ))}
                                </Listbox.Options>
                            </Portal>
                        )}
                    </div>
                )}
            </Listbox>
        </InputGroup>
    );
};

export const CustomDropdown = React.memo(CustomDropdownInner);
