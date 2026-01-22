import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";
import { formatDecimal, stripLeadingZeros, handleEnterKeyBlur } from "./inputUtils";

interface PercentageInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    onBlur?: () => void;
    error?: string;
    id?: string;
    isAboveInflation?: boolean;
    disabled?: boolean;
    max?: number;
    tooltip?: string;
}

function validatePercentage(val: number, max: number): string | undefined {
    if (val < 0) return "Cannot be negative";
    if (val > max) return `Max ${max}%`;
    return undefined;
}

export const PercentageInput: React.FC<PercentageInputProps> = ({ label, value, onChange, onBlur, error, id, isAboveInflation, disabled, max = 100, tooltip }) => {
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
        const cleanVal = displayValue.replace(/[^0-9.]/g, "");

        let finalVal = value;
        if (cleanVal === "") {
            finalVal = 0;
            onChange(0);
            setDisplayValue(formatDecimal(0));
        } else {
            const numVal = parseFloat(cleanVal);
            if (!isNaN(numVal)) {
                finalVal = numVal;
                onChange(numVal);
                setDisplayValue(formatDecimal(numVal));
            } else {
                setDisplayValue(formatDecimal(value));
            }
        }

        setInternalError(validatePercentage(finalVal, max));
        onBlur?.();
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const val = e.target.value.replace(/%/g, '');
        setDisplayValue(stripLeadingZeros(val));
    };

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
            onKeyDown={handleEnterKeyBlur}
            disabled={disabled}
            error={displayError}
            tooltip={tooltip}
        />
    );
};
