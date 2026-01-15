import React, { useState, useEffect } from "react";
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
    // Use local state to avoid triggering parent updates on every keystroke
    // This prevents chart animation glitches when editing names
    const [localValue, setLocalValue] = useState(value);
    const [internalError, setInternalError] = useState<string | undefined>();

    // Sync local state when prop value changes externally
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    // Built-in validation
    const validateValue = (val: string): string | undefined => {
        if (val.length > maxLength) return `Max ${maxLength} characters`;
        return undefined;
    };

    const handleBlur = () => {
        // Only update parent on blur to prevent animation glitches
        if (localValue !== value) {
            onChange(localValue);
        }
        setInternalError(validateValue(localValue));
        onBlur?.();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    // Use external error if provided, otherwise use internal validation error
    const displayError = error || internalError;

    return (
        <StyledInput
            label={label}
            id={id}
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            error={displayError}
            placeholder={placeholder}
            tooltip={tooltip}
        />
    );
};
