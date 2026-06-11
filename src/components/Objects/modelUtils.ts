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
