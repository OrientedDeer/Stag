/**
 * Format a Date object to YYYY-MM-DD for HTML date input fields
 */
export function formatDateForInput(date: Date | undefined): string {
    if (!date) return "";
    try {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    } catch {
        return "";
    }
}

/**
 * Get abbreviated frequency suffix for display
 */
export function getFrequencyAbbrev(frequency: string): string {
    switch (frequency) {
        case 'Daily': return 'day';
        case 'Weekly': return 'wk';
        case 'Bi-Weekly': return 'bw';
        case 'Semi-Monthly': return 'sm';
        case 'Monthly': return 'mo';
        case 'Annually': return 'yr';
        default: return '';
    }
}
