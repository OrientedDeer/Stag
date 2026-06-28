/**
 * Shared utilities for domain model reconstitution and type handling.
 *
 * These utilities consolidate common patterns across Account, Income, and Expense models
 * to reduce duplication and improve maintainability.
 */

/**
 * Parses a date value from various input formats.
 * Handles strings, Date objects, timestamps, null, and undefined.
 *
 * @param value - The value to parse (string, Date, number, null, or undefined)
 * @param fallback - Optional fallback value if input is null/undefined
 * @returns A Date object, or undefined if no valid date could be created
 */
export function parseDate(value: unknown, fallback?: Date): Date | undefined {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === 'string') {
    // Parse YYYY-MM-DD strings as local time to avoid UTC timezone shift
    const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    }
    // For full ISO strings (e.g. from JSON serialization), extract the date portion as local time
    const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})T/);
    if (isoDate) {
      return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    }
    return new Date(value);
  }

  if (typeof value === 'number') {
    return new Date(value);
  }

  return fallback;
}

/**
 * Parses a required date value, using Date.now() as default if not provided.
 *
 * @param value - The value to parse
 * @returns A Date object (never undefined)
 */
export function parseDateRequired(value: unknown): Date {
  return parseDate(value, new Date()) as Date;
}

/**
 * Common base fields shared across all domain models.
 * Used to extract and normalize data during reconstitution.
 */
export interface BaseModelFields {
  id: string;
  name: string;
  amount: number;
}

/**
 * Extracts common base fields from raw JSON data.
 * Provides sensible defaults for missing or invalid values.
 *
 * @param data - Raw JSON data from localStorage or import
 * @param defaultName - Default name if not provided
 * @returns Normalized base fields
 */
export function extractBaseFields(data: Record<string, unknown>, defaultName: string = "Unnamed"): BaseModelFields {
  return {
    id: String(data.id ?? ''),
    name: String(data.name ?? defaultName),
    amount: Number(data.amount) || 0,
  };
}

/**
 * An active date window shared by Income and Expense models.
 * `startDate`/`endDate` are date-only values built at LOCAL midnight
 * (the parseDate convention) — always read them with local getters.
 */
export interface ActiveDateWindow {
  startDate?: Date | null;
  endDate?: Date | null;
}

/**
 * Returns the fraction of `year` (in twelfths) that the window is active.
 * A missing startDate is treated as "now"; a missing endDate as open-ended.
 */
export function getActiveWindowMultiplier(window: ActiveDateWindow, year: number): number {
  const startDate = window.startDate ? new Date(window.startDate) : new Date();
  // Date-only values come from parseDate, which returns LOCAL-midnight dates (the
  // repo-wide convention). Read with local getFullYear()/getMonth() so a date
  // entered as Y-M-D round-trips to the same Y-M-D in any timezone.
  const startYear = startDate.getFullYear();

  const safeEndDate = window.endDate ? new Date(window.endDate) : null;
  const endYear = safeEndDate ? safeEndDate.getFullYear() : null;

  if (startYear > year) return 0;
  if (endYear !== null && endYear < year) return 0;

  const startMonthIndex = (startYear < year) ? 0 : startDate.getMonth();

  const endMonthIndex = (safeEndDate && endYear === year)
    ? safeEndDate.getMonth()
    : 11;

  const monthsActive = endMonthIndex - startMonthIndex + 1;

  return Math.max(0, monthsActive) / 12;
}

/**
 * Whether the window overlaps the current calendar month.
 * A missing startDate is treated as "now"; a missing endDate as open-ended.
 */
export function isWindowActiveInCurrentMonth(window: ActiveDateWindow): boolean {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth(); // 0-indexed

  const startDate = window.startDate != null ? window.startDate : new Date();
  // Stored date-only values are LOCAL-midnight (parseDate convention); read them
  // with local accessors. `today` above is a true instant and also read locally,
  // so both sides feed the local new Date(y, m, 1) month-boundary comparisons on
  // a consistent basis.
  const startYear = startDate.getFullYear();
  const startMonth = startDate.getMonth();

  const currentMonthStart = new Date(currentYear, currentMonth, 1);
  const effectiveStart = new Date(startYear, startMonth, 1);

  if (effectiveStart > currentMonthStart) {
    return false;
  }

  if (window.endDate) {
    const endDate = new Date(window.endDate);
    const endYear = endDate.getFullYear();
    const endMonth = endDate.getMonth();

    // Last day of the end month — the window is active through month end.
    const effectiveEnd = new Date(endYear, endMonth + 1, 0);

    if (effectiveEnd < currentMonthStart) {
      return false;
    }
  }
  return true;
}

/**
 * True when this window has definitively ENDED — it carries a fixed `endDate` whose
 * month is strictly before the current month. A missing `endDate` (open-ended, or
 * ended only by a milestone we can't resolve here) is treated as NOT ended, so this
 * stays conservative. Mirrors the local-midnight, month-boundary convention of
 * {@link isWindowActiveInCurrentMonth}.
 */
export function hasWindowEnded(window: ActiveDateWindow): boolean {
  if (window.endDate == null) return false;
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const endDate = new Date(window.endDate);
  // Last day of the end month — the window is active through month end.
  const effectiveEnd = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0);
  return effectiveEnd < currentMonthStart;
}

/**
 * Type guard to check if a value is a non-null object with a className property.
 * Used to validate data before reconstitution.
 */
export function hasClassName(data: unknown): data is { className: string } & Record<string, unknown> {
  return (
    typeof data === 'object' &&
    data !== null &&
    'className' in data &&
    typeof (data as Record<string, unknown>).className === 'string'
  );
}
