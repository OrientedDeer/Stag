import { describe, it, expect } from 'vitest';
import {
  parseDate,
  parseDateRequired,
  extractBaseFields,
  hasClassName,
} from '../../../components/Objects/modelUtils';

describe('modelUtils', () => {
  describe('parseDate', () => {
    it('should parse ISO date string "2024-06-15"', () => {
      const result = parseDate('2024-06-15');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getFullYear()).toBe(2024);
      // Note: Date parsing of ISO strings creates UTC dates
      // For local date comparison, use getUTC methods
      expect(result?.getUTCMonth()).toBe(5); // June = 5 (0-indexed)
      expect(result?.getUTCDate()).toBe(15);
    });

    it('should parse ISO datetime string with timezone', () => {
      const result = parseDate('2024-06-15T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result?.getUTCFullYear()).toBe(2024);
      expect(result?.getUTCMonth()).toBe(5); // June
      expect(result?.getUTCDate()).toBe(15);
      expect(result?.getUTCHours()).toBe(10);
      expect(result?.getUTCMinutes()).toBe(30);
    });

    it('should return same Date object when input is Date', () => {
      const input = new Date(2024, 5, 15); // June 15, 2024 local time
      const result = parseDate(input);
      expect(result).toBe(input); // Same reference
      expect(result?.getFullYear()).toBe(2024);
      expect(result?.getMonth()).toBe(5);
      expect(result?.getDate()).toBe(15);
    });

    it('should parse timestamp number', () => {
      // June 15, 2024 00:00:00 UTC in milliseconds
      const timestamp = new Date('2024-06-15T00:00:00Z').getTime();
      const result = parseDate(timestamp);
      expect(result).toBeInstanceOf(Date);
      expect(result?.getUTCFullYear()).toBe(2024);
      expect(result?.getUTCMonth()).toBe(5);
      expect(result?.getUTCDate()).toBe(15);
    });

    it('should return undefined for null (no fallback)', () => {
      const result = parseDate(null);
      expect(result).toBeUndefined();
    });

    it('should return fallback when value is null', () => {
      const fallback = new Date(2024, 0, 1);
      const result = parseDate(null, fallback);
      expect(result).toBe(fallback);
    });

    it('should return undefined for undefined (no fallback)', () => {
      const result = parseDate(undefined);
      expect(result).toBeUndefined();
    });

    it('should return fallback when value is undefined', () => {
      const fallback = new Date(2024, 0, 1);
      const result = parseDate(undefined, fallback);
      expect(result).toBe(fallback);
    });

    it('should return Invalid Date for invalid string', () => {
      const result = parseDate('not-a-date');
      expect(result).toBeInstanceOf(Date);
      expect(Number.isNaN(result?.getTime())).toBe(true); // Invalid Date
    });

    it('should return fallback for non-parseable object types', () => {
      const fallback = new Date(2024, 0, 1);
      const result = parseDate({ invalid: true }, fallback);
      expect(result).toBe(fallback);
    });
  });

  describe('parseDateRequired', () => {
    it('should parse valid ISO date string', () => {
      const result = parseDateRequired('2024-06-15');
      expect(result).toBeInstanceOf(Date);
      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(5); // June
      expect(result.getUTCDate()).toBe(15);
    });

    it('should return current time for null', () => {
      const before = Date.now();
      const result = parseDateRequired(null);
      const after = Date.now();

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('should return current time for undefined', () => {
      const before = Date.now();
      const result = parseDateRequired(undefined);
      const after = Date.now();

      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBeGreaterThanOrEqual(before);
      expect(result.getTime()).toBeLessThanOrEqual(after);
    });

    it('should return valid Date object when given Date', () => {
      const input = new Date(2024, 5, 15);
      const result = parseDateRequired(input);
      expect(result).toBe(input);
      expect(result.getFullYear()).toBe(2024);
    });

    it('should never return undefined', () => {
      const result = parseDateRequired(null);
      expect(result).not.toBeUndefined();
      expect(result).toBeInstanceOf(Date);
    });
  });

  describe('extractBaseFields', () => {
    it('should extract all fields when present', () => {
      const data = { id: 'abc123', name: 'Test Account', amount: 5000 };
      const result = extractBaseFields(data);

      expect(result.id).toBe('abc123');
      expect(result.name).toBe('Test Account');
      expect(result.amount).toBe(5000);
    });

    it('should use defaults for missing name and amount', () => {
      const data = { id: 'abc123' };
      const result = extractBaseFields(data);

      expect(result.id).toBe('abc123');
      expect(result.name).toBe('Unnamed');
      expect(result.amount).toBe(0);
    });

    it('should use custom default name when provided', () => {
      const data = { id: 'acc1' };
      const result = extractBaseFields(data, 'Default Account');

      expect(result.id).toBe('acc1');
      expect(result.name).toBe('Default Account');
      expect(result.amount).toBe(0);
    });

    it('should generate empty string for missing id', () => {
      const data = {};
      const result = extractBaseFields(data, 'Default Account');

      expect(result.id).toBe('');
      expect(result.name).toBe('Default Account');
      expect(result.amount).toBe(0);
    });

    it('should parse string amount to number', () => {
      const data = { id: 'acc1', name: 'Test', amount: '5000' };
      const result = extractBaseFields(data);

      expect(result.amount).toBe(5000);
      expect(typeof result.amount).toBe('number');
    });

    it('should handle null/undefined amount as 0', () => {
      const data1 = { id: 'acc1', name: 'Test', amount: null };
      const data2 = { id: 'acc2', name: 'Test', amount: undefined };

      expect(extractBaseFields(data1 as Record<string, unknown>).amount).toBe(0);
      expect(extractBaseFields(data2).amount).toBe(0);
    });

    it('should convert non-string id to string', () => {
      const data = { id: 12345, name: 'Test', amount: 100 };
      const result = extractBaseFields(data as Record<string, unknown>);

      expect(result.id).toBe('12345');
      expect(typeof result.id).toBe('string');
    });

    it('should convert non-string name to string', () => {
      const data = { id: 'acc1', name: 123, amount: 100 };
      const result = extractBaseFields(data as Record<string, unknown>);

      expect(result.name).toBe('123');
      expect(typeof result.name).toBe('string');
    });
  });

  describe('hasClassName', () => {
    it('should return true for object with className string property', () => {
      const data = { className: 'WorkIncome', id: 'w1', amount: 1000 };
      expect(hasClassName(data)).toBe(true);
    });

    it('should return false for null', () => {
      expect(hasClassName(null)).toBe(false);
    });

    it('should return false for undefined', () => {
      expect(hasClassName(undefined)).toBe(false);
    });

    it('should return false for non-object (string)', () => {
      expect(hasClassName('WorkIncome')).toBe(false);
    });

    it('should return false for non-object (number)', () => {
      expect(hasClassName(123)).toBe(false);
    });

    it('should return false for object without className', () => {
      const data = { id: 'w1', amount: 1000 };
      expect(hasClassName(data)).toBe(false);
    });

    it('should return false for object with non-string className', () => {
      const data = { className: 123, id: 'w1' };
      expect(hasClassName(data)).toBe(false);
    });

    it('should return false for array', () => {
      expect(hasClassName(['WorkIncome'])).toBe(false);
    });
  });
});
