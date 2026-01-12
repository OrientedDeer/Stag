import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";

interface PercentageInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    onBlur?: () => void;
    error?: string;
    id?: string;
    isAboveInflation?: boolean;
    disabled?: boolean;
    max?: number; // Default 100
    tooltip?: string;
}

const format = (val: number) =>
    val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const PercentageInput: React.FC<PercentageInputProps> = ({ label, value, onChange, onBlur, error, id, isAboveInflation, disabled, max = 100, tooltip }) => {
    // Local state for the string representation (e.g., "12.50")
    const [displayValue, setDisplayValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [internalError, setInternalError] = useState<string | undefined>();

    // Built-in validation
    const validateValue = (val: number): string | undefined => {
        if (val < 0) return "Cannot be negative";
        if (val > max) return `Max ${max}%`;
        return undefined;
    };

    // Sync local state when the prop value changes (unless we are editing it)
    useEffect(() => {
        if (!isFocused) {
            setDisplayValue(format(value));
        }
    }, [value, isFocused]);

    const handleFocus = () => {
        setIsFocused(true);
        // On focus, strip formatting so user sees raw number (e.g. "12.5")
        setDisplayValue(value.toString());
    };

    const handleBlur = () => {
        setIsFocused(false);
        // Parse the current string back to a number
        const cleanVal = displayValue.replace(/[^0-9.]/g, "");

        let finalVal = value;
        if (cleanVal === "") {
            finalVal = 0;
            onChange(0);
            setDisplayValue(format(0));
        } else {
            const numVal = parseFloat(cleanVal);
            if (!isNaN(numVal)) {
                finalVal = numVal;
                onChange(numVal); // Send the number up to the parent
                setDisplayValue(format(numVal)); // Re-format local display
            } else {
                setDisplayValue(format(value)); // Revert if invalid
            }
        }

        // Validate and set internal error
        setInternalError(validateValue(finalVal));

        // Call parent's onBlur callback if provided
        onBlur?.();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        // Allow typing numbers and a single dot
        const val = e.target.value;
        // The value from the input might contain the '%' symbol if edited
        const cleanVal = val.replace(/%/g, '');
        setDisplayValue(cleanVal);
    }

    // Use external error if provided, otherwise use internal validation error
    const displayError = error || internalError;

    return (
        <StyledInput
            id={id}
            label={isAboveInflation ? `${label} (%) (above inflation)` : `${label} (%)`}
            type="text"
            value={isFocused ? displayValue : `${displayValue}%`}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            disabled={disabled}
            error={displayError}
            tooltip={tooltip}
        />
    );
};
