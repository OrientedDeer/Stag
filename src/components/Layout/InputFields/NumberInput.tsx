import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";

interface NumberInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    onBlur?: () => void;
    error?: string;
    id?: string;
    disabled?: boolean;
    min?: number;
    max?: number;
    tooltip?: string;
}

export const NumberInput: React.FC<NumberInputProps> = ({ label, value, onChange, onBlur, error, id, disabled, min, max, tooltip }) => {
    const [localValue, setLocalValue] = useState(value.toString());
    const [internalError, setInternalError] = useState<string | undefined>();

    // Built-in validation
    const validateValue = (val: number): string | undefined => {
        if (min !== undefined && val < min) return `Min ${min}`;
        if (max !== undefined && val > max) return `Max ${max}`;
        return undefined;
    };

    useEffect(() => {
        // If prop from parent changes, update local state.
        // This handles cases where the value is changed externally.
        // We check against parseFloat to allow for partial inputs like "5."
        if (parseFloat(localValue) !== value) {
            setLocalValue(value.toString());
        }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let strVal = e.target.value;
        // Strip leading zeros except for "0" or "0."
        strVal = strVal.replace(/^0+(?=\d)/, '');
        setLocalValue(strVal);

        if (strVal === "" || strVal === "-") {
            onChange(0);
            return;
        }

        const numVal = parseFloat(strVal);
        if (!isNaN(numVal)) {
            onChange(numVal);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.currentTarget.blur();
        }
    };

    const handleBlur = () => {
        // On blur, if the input is not a valid number, or it's something like "5.",
        // format it to a clean number string. Revert to last good `value` if invalid.
        const numVal = parseFloat(localValue);
        let finalVal = value;
        if (!isNaN(numVal)) {
            finalVal = numVal;
            if (numVal !== value) onChange(numVal);
            setLocalValue(numVal.toString());
        } else {
            setLocalValue(value.toString());
        }

        // Validate and set internal error
        setInternalError(validateValue(finalVal));

        // Call parent's onBlur callback if provided
        onBlur?.();
    };

    // Use external error if provided, otherwise use internal validation error
    const displayError = error || internalError;

    return (
        <StyledInput
            id={id}
            label={label}
            type="text"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            error={displayError}
            tooltip={tooltip}
        />
    );
};
