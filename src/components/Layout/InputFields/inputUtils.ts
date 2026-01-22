/**
 * Shared utilities for input components
 */

/**
 * Strips leading zeros from a string, preserving "0" and "0."
 */
export function stripLeadingZeros(val: string): string {
    return val.replace(/^0+(?=\d)/, '');
}

/**
 * Handles Enter key press by blurring the input
 */
export function handleEnterKeyBlur(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter') {
        e.currentTarget.blur();
    }
}

/**
 * Formats a number with 2 decimal places
 */
export function formatDecimal(val: number): string {
    return val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
