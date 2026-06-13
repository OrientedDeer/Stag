import { describe, it, expect } from 'vitest';
import { jsonDateReplacer, formatDateForInput } from '../../utils/formatters';
import { parseDate } from '../../components/Objects/modelUtils';

// Regression for #73: file + cloud backups serialized Date values with the
// default JSON.stringify (UTC toISOString), which shifts a date-only field a day
// earlier for UTC+ users because parseDate reads the date portion locally on
// import. jsonDateReplacer must emit local YYYY-MM-DD so the round-trip is an
// identity in every timezone.
describe('jsonDateReplacer (issue #73 backup date round-trip)', () => {
    it('serializes a Date as local YYYY-MM-DD, not a UTC ISO timestamp', () => {
        const d = new Date(2024, 5, 15); // local June 15
        const json = JSON.stringify({ startDate: d }, jsonDateReplacer);
        expect(json).toBe('{"startDate":"2024-06-15"}');
        expect(json).not.toContain('T'); // no ISO time component
    });

    it('leaves non-Date values untouched', () => {
        const json = JSON.stringify(
            { name: 'Roof', amount: 12000, intervalYears: 10, account: null },
            jsonDateReplacer,
        );
        expect(JSON.parse(json)).toEqual({
            name: 'Roof', amount: 12000, intervalYears: 10, account: null,
        });
    });

    it('round-trips a calendar date with no shift (stringify -> parse -> parseDate)', () => {
        // Dates that straddle midnight UTC are the ones that previously broke.
        for (const d of [new Date(2024, 0, 1), new Date(2030, 11, 31), new Date(2024, 5, 15)]) {
            const restored = parseDate(JSON.parse(JSON.stringify({ d }, jsonDateReplacer)).d);
            expect(restored?.getFullYear()).toBe(d.getFullYear());
            expect(restored?.getMonth()).toBe(d.getMonth());
            expect(restored?.getDate()).toBe(d.getDate());
        }
    });

    it('handles Dates nested inside arrays and objects', () => {
        const payload = {
            expenses: [{ id: 'g1', endDate: new Date(2028, 2, 9) }],
            assumptions: { milestones: [{ date: new Date(2026, 7, 1) }] },
        };
        const parsed = JSON.parse(JSON.stringify(payload, jsonDateReplacer));
        expect(parsed.expenses[0].endDate).toBe('2028-03-09');
        expect(parsed.assumptions.milestones[0].date).toBe(formatDateForInput(new Date(2026, 7, 1)));
    });
});
