import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";

interface NumberInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    id?: string;
    disabled?: boolean;
}

export const NumberInput: React.FC<NumberInputProps> = ({ label, value, onChange, id, disabled }) => {
    const [localValue, setLocalValue] = useState(value.toString());

    useEffect(() => {
        // If prop from parent changes, update local state.
        // This handles cases where the value is changed externally.
        // We check against parseFloat to allow for partial inputs like "5."
        if (parseFloat(localValue) !== value) {
            setLocalValue(value.toString());
        }
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const strVal = e.target.value;
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

    const handleBlur = () => {
        // On blur, if the input is not a valid number, or it's something like "5.",
        // format it to a clean number string. Revert to last good `value` if invalid.
        const numVal = parseFloat(localValue);
        if (!isNaN(numVal)) {
            if (numVal !== value) onChange(numVal);
            setLocalValue(numVal.toString());
        } else {
            setLocalValue(value.toString());
        }
    };

    return (
        <StyledInput
            id={id}
            label={label}
            type="text"
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            disabled={disabled}
        />
    );
};
