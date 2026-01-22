/**
 * Format a Date object to YYYY-MM-DD for HTML date input fields
 */
export function formatDateForInput(date: Date | undefined): string {
    if (!date) return "";
    try {
        return date.toISOString().split('T')[0];
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
