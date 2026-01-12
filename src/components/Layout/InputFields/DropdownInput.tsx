import React from "react";
import { InputGroup } from "./StyleUI";

type Option = {
    value: string;
    label: string;
};

interface DropdownInputProps {
    label: string;
    value: string;
    onChange: (newValue: string) => void;
    options: (string | Option)[];
    error?: string;
    id?: string;
    tooltip?: string;
}

const isOptionObject = (option: string | Option): option is Option => {
    return typeof option === 'object' && option !== null && 'value' in option && 'label' in option;
}

export const DropdownInput: React.FC<DropdownInputProps> = ({ label, value, onChange, options, error, id: providedId, tooltip }) => {
    const id = providedId || label.toLowerCase().replace(/\s/g, '-');
    return (
        <InputGroup label={label} id={id} error={error} tooltip={tooltip}>
            <select
                id={id}
                className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            >
                {options.map(option => {
                    const optionValue = isOptionObject(option) ? option.value : option;
                    const optionLabel = isOptionObject(option) ? option.label : option;
                    return (
                        <option key={optionValue} value={optionValue} className="bg-gray-950">
                            {optionLabel}
                        </option>
                    );
                })}
            </select>
        </InputGroup>
    );
};
