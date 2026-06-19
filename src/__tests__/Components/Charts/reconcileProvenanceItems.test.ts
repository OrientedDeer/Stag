import { describe, it, expect } from 'vitest';
import { reconcileProvenanceItems } from '../../../components/Charts/cashflowSankeyData';

/**
 * `reconcileProvenanceItems` collapses a node's constituent rows for the
 * drill-down panel: real rows pass through, tiny positives fold into one
 * "Other (+N smaller)" row, and non-finite values are dropped. It does NOT
 * fabricate a remainder to match an external total — the lists already sum to
 * the node by construction, and genuine drift is surfaced by the imbalance
 * detector, not here.
 */
describe('reconcileProvenanceItems', () => {
    const sum = (items: { value: number }[]) => items.reduce((s, i) => s + i.value, 0);

    it('passes real rows through unchanged, with no Other row', () => {
        const items = [
            { label: 'A', value: 60 },
            { label: 'B', value: 40 },
        ];
        const out = reconcileProvenanceItems(items);
        expect(out).toHaveLength(2);
        expect(out.some(i => i.isRemainder)).toBe(false);
        expect(sum(out)).toBeCloseTo(100, 6);
    });

    it('rolls sub-threshold positives into an "Other (+N smaller)" row', () => {
        // Each tiny item is below MIN_DISPLAY_THRESHOLD (0.005) individually but
        // they sum above it, so the combined remainder is worth one row.
        const items = [
            { label: 'Big', value: 100 },
            { label: 'Tiny1', value: 0.004 },
            { label: 'Tiny2', value: 0.004 },
        ];
        const out = reconcileProvenanceItems(items);
        expect(out).toHaveLength(2);
        const other = out.find(i => i.isRemainder)!;
        expect(other.label).toBe('Other (+2 smaller)');
        expect(other.value).toBeCloseTo(0.008, 6);
        // Rows still sum to the total of all input items.
        expect(sum(out)).toBeCloseTo(sum(items), 6);
    });

    it('drops a negligible set of tiny positives (rounds to $0) with no row', () => {
        const items = [
            { label: 'Big', value: 100 },
            { label: 'Dust', value: 0.001 },
        ];
        const out = reconcileProvenanceItems(items);
        expect(out).toHaveLength(1);
        expect(out.some(i => i.isRemainder)).toBe(false);
    });

    it('does NOT fabricate an Other row to reach some external total', () => {
        // Previously the helper took a nodeTotal and invented a shortfall row;
        // it no longer does. Two real rows in → exactly two rows out.
        const items = [
            { label: 'A', value: 70 },
            { label: 'B', value: 20 },
        ];
        const out = reconcileProvenanceItems(items);
        expect(out).toHaveLength(2);
        expect(out.some(i => i.isRemainder)).toBe(false);
        expect(sum(out)).toBeCloseTo(90, 6);
    });

    it('drops non-finite values (NaN / Infinity) instead of rendering them', () => {
        const items = [
            { label: 'Real', value: 50 },
            { label: 'Bad', value: NaN },
            { label: 'Worse', value: Infinity },
        ];
        const out = reconcileProvenanceItems(items);
        expect(out).toHaveLength(1);
        expect(out[0].label).toBe('Real');
        expect(out.every(i => Number.isFinite(i.value))).toBe(true);
    });

    it('lists a meaningful negative as its own row (not folded into Other)', () => {
        // A negative contributor is real, not rounding dust — it must show as a
        // row and must not inflate the "Other" remainder.
        const items = [
            { label: 'Positive', value: 100 },
            { label: 'Adjustment', value: -20 },
        ];
        const out = reconcileProvenanceItems(items);
        expect(out).toHaveLength(2);
        expect(out.some(i => i.isRemainder)).toBe(false);
        expect(out.find(i => i.label === 'Adjustment')!.value).toBe(-20);
    });

    it('does not let a tiny negative pollute the Other remainder', () => {
        const items = [
            { label: 'Big', value: 100 },
            { label: 'TinyPos1', value: 0.004 },
            { label: 'TinyPos2', value: 0.004 },
            { label: 'TinyNeg', value: -0.004 },
        ];
        const out = reconcileProvenanceItems(items);
        const other = out.find(i => i.isRemainder)!;
        // Only the positive tinies are summed; the negative dust is dropped.
        expect(other.label).toBe('Other (+2 smaller)');
        expect(other.value).toBeCloseTo(0.008, 6);
    });
});
