import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";
import { handleEnterKeyBlur } from "./inputUtils";

interface NameInputProps {
    label: string;
    id: string;
    value: string;
    onChange: (val: string) => void;
    onBlur?: () => void;
    error?: string;
    placeholder?: string;
    maxLength?: number;
    tooltip?: string;
}

export const NameInput: React.FC<NameInputProps> = ({ label, id, value, onChange, onBlur, error, placeholder, maxLength = 50, tooltip }) => {
    const [localValue, setLocalValue] = useState(value);
    const [internalError, setInternalError] = useState<string | undefined>();

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleBlur = (): void => {
        if (localValue !== value) {
            onChange(localValue);
        }
        setInternalError(localValue.length > maxLength ? `Max ${maxLength} characters` : undefined);
        onBlur?.();
    };

    const displayError = error || internalError;

    return (
        <StyledInput
            label={label}
            id={id}
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleEnterKeyBlur}
            error={displayError}
            placeholder={placeholder}
            tooltip={tooltip}
        />
    );
};
