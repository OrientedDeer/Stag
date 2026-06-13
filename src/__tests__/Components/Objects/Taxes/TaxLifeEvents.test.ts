/**
 * resolveTaxEventsForYear: applies scheduled state-residency / filing-status
 * changes that have fired by a given year (year- or milestone-triggered;
 * latest-firing wins per kind).
 */
import { describe, it, expect } from 'vitest';
import { TaxState, resolveTaxEventsForYear } from '../../../../components/Objects/Taxes/TaxContext';

const base = (events: TaxState['taxEvents']): TaxState => ({
    filingStatus: 'Single',
    stateResidency: 'California',
    deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null,
    year: 2025,
    taxEvents: events,
});

const noReaches = new Map<string, number>();

describe('resolveTaxEventsForYear', () => {
    it('returns the base unchanged when there are no events', () => {
        const s = base(undefined);
        expect(resolveTaxEventsForYear(s, 2030, noReaches)).toBe(s);
    });

    it('applies a year-triggered state move from its year on', () => {
        const s = base([{ id: 'e1', kind: 'stateResidency', value: 'Texas', year: 2034 }]);
        expect(resolveTaxEventsForYear(s, 2033, noReaches).stateResidency).toBe('California');
        expect(resolveTaxEventsForYear(s, 2034, noReaches).stateResidency).toBe('Texas');
        expect(resolveTaxEventsForYear(s, 2040, noReaches).stateResidency).toBe('Texas');
    });

    it('applies a filing-status change independently of state', () => {
        const s = base([
            { id: 'e1', kind: 'stateResidency', value: 'Texas', year: 2034 },
            { id: 'e2', kind: 'filingStatus', value: 'Married Filing Jointly', year: 2030 },
        ]);
        const at2032 = resolveTaxEventsForYear(s, 2032, noReaches);
        expect(at2032.filingStatus).toBe('Married Filing Jointly');
        expect(at2032.stateResidency).toBe('California'); // move not yet
    });

    it('resolves a milestone-triggered event by the milestone reach year', () => {
        const s = base([{ id: 'e1', kind: 'stateResidency', value: 'Florida', milestoneId: 'retire' }]);
        const reaches = new Map([['retire', 2042]]);
        expect(resolveTaxEventsForYear(s, 2041, reaches).stateResidency).toBe('California');
        expect(resolveTaxEventsForYear(s, 2042, reaches).stateResidency).toBe('Florida');
        // milestone not yet reached (absent from map) → no change
        expect(resolveTaxEventsForYear(s, 2050, noReaches).stateResidency).toBe('California');
    });

    it('lets the latest-firing event of a kind win', () => {
        const s = base([
            { id: 'e1', kind: 'stateResidency', value: 'Texas', year: 2034 },
            { id: 'e2', kind: 'stateResidency', value: 'Florida', year: 2040 },
        ]);
        expect(resolveTaxEventsForYear(s, 2035, noReaches).stateResidency).toBe('Texas');
        expect(resolveTaxEventsForYear(s, 2041, noReaches).stateResidency).toBe('Florida');
    });
});
