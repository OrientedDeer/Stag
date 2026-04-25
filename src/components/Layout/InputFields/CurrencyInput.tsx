import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";
import { formatWholeDollar, stripLeadingZeros, handleEnterKeyBlur } from "./inputUtils";

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
            setDisplayValue(formatWholeDollar(value));
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
            setDisplayValue(formatWholeDollar(0));
        } else {
            const numVal = Math.round(parseFloat(cleanVal));
            if (!isNaN(numVal)) {
                finalVal = numVal;
                onChange(numVal);
                setDisplayValue(formatWholeDollar(Math.abs(numVal)));
            } else {
                setDisplayValue(formatWholeDollar(value));
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