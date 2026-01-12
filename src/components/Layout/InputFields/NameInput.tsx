import React, { useState } from "react";
import { StyledInput } from "./StyleUI";

interface NameInputProps {
    label: string;
    id: string;
    value: string;
    onChange: (val: string) => void;
    onBlur?: () => void;
    error?: string;
    placeholder?: string;
    maxLength?: number; // Default 50
    tooltip?: string;
}

export const NameInput: React.FC<NameInputProps> = ({ label, id, value, onChange, onBlur, error, placeholder, maxLength = 50, tooltip }) => {
    const [internalError, setInternalError] = useState<string | undefined>();

    // Built-in validation
    const validateValue = (val: string): string | undefined => {
        if (val.length > maxLength) return `Max ${maxLength} characters`;
        return undefined;
    };

    const handleBlur = () => {
        setInternalError(validateValue(value));
        onBlur?.();
    };

    // Use external error if provided, otherwise use internal validation error
    const displayError = error || internalError;

    return (
        <StyledInput
            label={label}
            id={id}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={handleBlur}
            error={displayError}
            placeholder={placeholder}
            tooltip={tooltip}
        />
    );
};
