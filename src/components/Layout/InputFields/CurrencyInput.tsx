import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";

interface CurrencyInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    onBlur?: () => void;
    error?: string;
    id?: string;
    tooltip?: string;
}

const format = (val: number) =>
    val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CurrencyInput: React.FC<CurrencyInputProps> = ({ label, value, onChange, onBlur, error, id, tooltip }) => {
    // Local state for the string representation (e.g., "$1,200.50")
    const [displayValue, setDisplayValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [internalError, setInternalError] = useState<string | undefined>();

    // Built-in validation
    const validateValue = (val: number): string | undefined => {
        if (val < 0) return "Cannot be negative";
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
        // On focus, strip formatting so user sees raw number (e.g. "1200.5")
        setDisplayValue(value.toString());
    };

    const handleBlur = () => {
        setIsFocused(false);
        // Parse the current string back to a number
        const cleanVal = displayValue.replace(/[^0-9.-]/g, "");

        let finalVal = value;
        if (cleanVal === "" || cleanVal === "-") {
            finalVal = 0;
            onChange(0);
            setDisplayValue(format(0));
        } else {
            const numVal = parseFloat(cleanVal);
            if (!isNaN(numVal)) {
                finalVal = numVal;
                onChange(numVal); // Send the number up to the parent
                setDisplayValue(format(Math.abs(numVal))); // Re-format local display (abs for display)
            } else {
                setDisplayValue(format(value)); // Revert if invalid
            }
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
            label={`${label} ($)`}
            type="text"
            value={isFocused ? displayValue : `$${displayValue}`}
            onChange={(e) => setDisplayValue(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            error={displayError}
            tooltip={tooltip}
        />
    );
};