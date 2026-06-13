import type { GoalType } from './models';

// Single source of truth for long-term goal "kind" UI constants, shared by the
// create path (AddExpenseModal) and the edit path (ExpenseCard). Editing a label
// or the default here keeps both in sync — previously these were duplicated and
// could silently desync create vs edit (#82).

// Canonical ordered list of goal kinds + their readable labels. AddExpenseModal's
// DropdownInput consumes this {value,label}[] directly.
export const GOAL_TYPE_OPTIONS: { value: GoalType; label: string }[] = [
    { value: 'recurring', label: 'Recurring every N years' },
    { value: 'targetDate', label: 'Save by date' },
];

// Label lookup by goal kind, derived from GOAL_TYPE_OPTIONS so it can never drift.
// ExpenseCard's StyledSelect works in label strings, so it reads from this map.
export const GOAL_TYPE_LABELS = Object.fromEntries(
    GOAL_TYPE_OPTIONS.map(({ value, label }) => [value, label]),
) as Record<GoalType, string>;

// Recurrence (years) seeded for a new/just-switched 'recurring' goal that has no
// interval yet. Mirrors the create form's initial intervalYears.
export const DEFAULT_GOAL_INTERVAL_YEARS = 10;
