import React, { useState } from "react";
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
    // While focused, `displayValue` is the raw editing buffer. While not
    // focused, the shown value is derived directly from the `value` prop
    // during render (see the `value=` prop below), so no effect is needed to
    // keep them in sync.
    const [displayValue, setDisplayValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const [internalError, setInternalError] = useState<string | undefined>();

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
            value={isFocused ? displayValue : `${formatDecimal(value)}%`}
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
