// Single source of truth for annual-cadence UI constants, shared by the create
// path (AddExpenseModal) and the edit path (ExpenseCard). Editing a label or the
// month order here keeps both in sync — previously these were duplicated and
// could silently desync create vs edit (#85).

export type AnnualMode = 'lump' | 'sinkingFund';

// Canonical ordered list of annual-budget modes + their readable labels.
// AddExpenseModal's DropdownInput consumes this {value,label}[] directly.
export const ANNUAL_MODE_OPTIONS: { value: AnnualMode; label: string }[] = [
    { value: 'lump', label: 'Pay in due month' },
    { value: 'sinkingFund', label: 'Save monthly' },
];

// Label lookup by mode, derived from ANNUAL_MODE_OPTIONS so it can never drift.
// ExpenseCard's StyledSelect works in label strings, so it reads from this map.
export const ANNUAL_MODE_LABELS = Object.fromEntries(
    ANNUAL_MODE_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<AnnualMode, string>;

// Canonical ordered month options. dueMonth is stored 1-12, so value is the
// 1-based month number as a string. AddExpenseModal's DropdownInput consumes
// this {value,label}[] directly.
export const MONTH_OPTIONS: { value: string; label: string }[] = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
].map((label, i) => ({ value: String(i + 1), label }));

// Ordered month names, derived from MONTH_OPTIONS so they can never drift.
// ExpenseCard's StyledSelect works in name strings (indexed by dueMonth - 1).
export const MONTH_NAMES = MONTH_OPTIONS.map(({ label }) => label);
