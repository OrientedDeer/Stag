import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";
import { formatDecimal, stripLeadingZeros, handleEnterKeyBlur } from "./inputUtils";

interface CurrencyInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    onBlur?: () => void;
    error?: string;
    id?: string;
    tooltip?: string;
    disabled?: boolean;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({ label, value, onChange, onBlur, error, id, tooltip, disabled = false }) => {
    const [displayValue, setDisplayValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [internalError, setInternalError] = useState<string | undefined>();

    useEffect(() => {
        if (!isFocused) {
            setDisplayValue(formatDecimal(value));
        }
    }, [value, isFocused]);

    const handleFocus = (): void => {
        setIsFocused(true);
        setDisplayValue(value.toString());
    };

    const handleBlur = (): void => {
        setIsFocused(false);
        const cleanVal = displayValue.replace(/[^0-9.-]/g, "");

        let finalVal = value;
        if (cleanVal === "" || cleanVal === "-") {
            finalVal = 0;
            onChange(0);
            setDisplayValue(formatDecimal(0));
        } else {
            const numVal = parseFloat(cleanVal);
            if (!isNaN(numVal)) {
                finalVal = numVal;
                onChange(numVal);
                setDisplayValue(formatDecimal(Math.abs(numVal)));
            } else {
                setDisplayValue(formatDecimal(value));
            }
        }

        setInternalError(finalVal < 0 ? "Cannot be negative" : undefined);
        onBlur?.();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        setDisplayValue(stripLeadingZeros(e.target.value));
    };

    const displayError = error || internalError;

    // Only add ($) suffix if there's a label, otherwise the $ in the value is enough
    const displayLabel = label ? `${label} ($)` : '';

    return (
        <StyledInput
            id={id}
            label={displayLabel}
            type="text"
            value={isFocused ? displayValue : `$${displayValue}`}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleEnterKeyBlur}
            error={displayError}
            tooltip={tooltip}
            disabled={disabled}
        />
    );
};