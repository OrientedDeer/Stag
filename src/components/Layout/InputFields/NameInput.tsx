import React from "react";
import { StyledInput } from "./StyleUI";

interface NameInputProps {
    label: string;
    id: string;
    value: string;
    onChange: (val: string) => void;
    placeholder?: string;
}

export const NameInput: React.FC<NameInputProps> = ({ label, id, value, onChange, placeholder }) => {
    return (
        <StyledInput
            label={label}
            id={id}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
        />
    );
};
