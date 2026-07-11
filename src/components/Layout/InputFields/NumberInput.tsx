import React, { useState } from "react";
import { StyledInput } from "./StyleUI";
import { stripLeadingZeros, handleEnterKeyBlur } from "./inputUtils";

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

function validateRange(val: number, min?: number, max?: number): string | undefined {
    if (min !== undefined && val < min) return `Min ${min}`;
    if (max !== undefined && val > max) return `Max ${max}`;
    return undefined;
}

export const NumberInput: React.FC<NumberInputProps> = ({ label, value, onChange, onBlur, error, id, disabled, min, max, tooltip }) => {
    const [localValue, setLocalValue] = useState(value.toString());
    const [internalError, setInternalError] = useState<string | undefined>();
    const [prevValue, setPrevValue] = useState(value);

    // Resync the local editing buffer when the `value` prop changes from the
    // outside (not from our own onChange). Comparing to the previous prop
    // during render is React's recommended alternative to a syncing effect.
    // The parseFloat guard preserves an in-progress edit (e.g. "1." while the
    // committed value is already 1).
    if (value !== prevValue) {
        setPrevValue(value);
        if (parseFloat(localValue) !== value) {
            setLocalValue(value.toString());
        }
    }

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
        const strVal = stripLeadingZeros(e.target.value);
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

    const handleBlur = (): void => {
        const numVal = parseFloat(localValue);
        let finalVal = value;
        if (!isNaN(numVal)) {
            finalVal = numVal;
            if (numVal !== value) onChange(numVal);
            setLocalValue(numVal.toString());
        } else {
            setLocalValue(value.toString());
        }

        setInternalError(validateRange(finalVal, min, max));
        onBlur?.();
    };

    const displayError = error || internalError;

    return (
        <StyledInput
            id={id}
            label={label}
            type="text"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleEnterKeyBlur}
            disabled={disabled}
            error={displayError}
            tooltip={tooltip}
        />
    );
};
