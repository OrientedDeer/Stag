import React, { useState, useEffect } from "react";
import { StyledInput } from "./StyleUI";

interface CurrencyInputProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    id?: string;
}

const format = (val: number) => 
    val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const CurrencyInput: React.FC<CurrencyInputProps> = ({ label, value, onChange, id }) => {
    // Local state for the string representation (e.g., "$1,200.50")
    const [displayValue, setDisplayValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);

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
        const cleanVal = displayValue.replace(/[^0-9.]/g, "");

        if (cleanVal === "") {
            onChange(0);
            setDisplayValue(format(0));
            return;
        }
        
        const numVal = parseFloat(cleanVal);
        if (!isNaN(numVal)) {
            onChange(numVal); // Send the number up to the parent
            setDisplayValue(format(numVal)); // Re-format local display
        } else {
            setDisplayValue(format(value)); // Revert if invalid
        }
    };

    return (
        <StyledInput
            id={id}
            label={`${label} ($)`}
            type="text"
            value={isFocused ? displayValue : `$${displayValue}`}
            onChange={(e) => setDisplayValue(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
        />
    );
};