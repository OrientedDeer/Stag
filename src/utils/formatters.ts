/**
 * Format a Date (or ISO string) to YYYY-MM-DD for HTML date input fields,
 * using local time so date-only fields don't shift across timezones.
 */
export function formatDateForInput(date: Date | string | undefined): string {
    if (!date) return "";
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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
