import { describe, it, expect } from 'vitest';
import { reconcileProvenanceItems } from '../../../components/Charts/cashflowSankeyData';

/**
 * The drill-down panel must never list rows that visibly sum to less than the
 * node's headline total. `reconcileProvenanceItems` enforces that by rolling
 * sub-threshold contributors and any unitemized shortfall into a single
 * "Other" remainder row.
 */
describe('reconcileProvenanceItems', () => {
    const sum = (items: { value: number }[]) => items.reduce((s, i) => s + i.value, 0);

    it('passes through items that already reconcile, with no Other row', () => {
        const items = [
            { label: 'A', value: 60 },
            { label: 'B', value: 40 },
        ];
        const out = reconcileProvenanceItems(items, 100);
        expect(out).toHaveLength(2);
        expect(out.some(i => i.isRemainder)).toBe(false);
        expect(sum(out)).toBeCloseTo(100, 6);
    });

    it('rolls sub-threshold items into an "Other (+N smaller)" row', () => {
        // Each item is below MIN_DISPLAY_THRESHOLD (0.005) individually but they
        // sum above it, so the combined remainder is worth showing as one row.
        const items = [
            { label: 'Big', value: 100 },
            { label: 'Tiny1', value: 0.004 },
            { label: 'Tiny2', value: 0.004 },
        ];
        const out = reconcileProvenanceItems(items, 100.008);
        // The two tiny items collapse into one remainder row.
        expect(out).toHaveLength(2);
        const other = out.find(i => i.isRemainder)!;
        expect(other).toBeTruthy();
        expect(other.label).toBe('Other (+2 smaller)');
        // Rows reconcile to the node total.
        expect(sum(out)).toBeCloseTo(100.008, 6);
    });

    it('drops a negligible remainder (below the display threshold) entirely', () => {
        // Sub-threshold items summing to < MIN_DISPLAY_THRESHOLD would round to
        // $0 — adding an "Other" row there would just be noise.
        const items = [
            { label: 'Big', value: 100 },
            { label: 'Dust', value: 0.001 },
        ];
        const out = reconcileProvenanceItems(items, 100.001);
        expect(out).toHaveLength(1);
        expect(out.some(i => i.isRemainder)).toBe(false);
    });

    it('adds a shortfall remainder when listed rows fall short of the node total', () => {
        // The node total carries flows we do not itemize (e.g. residuals); the
        // gap should appear as an "Other" row so the rows still sum to the total.
        const items = [
            { label: 'A', value: 70 },
            { label: 'B', value: 20 },
        ];
        const out = reconcileProvenanceItems(items, 100);
        const other = out.find(i => i.isRemainder)!;
        expect(other).toBeTruthy();
        // No sub-threshold items, so the label is the bare "Other".
        expect(other.label).toBe('Other');
        expect(other.value).toBeCloseTo(10, 6);
        expect(sum(out)).toBeCloseTo(100, 6);
    });

    it('does not emit a negative remainder when items over-count the total', () => {
        // Listed rows already exceed the node total — never show a negative Other.
        const items = [
            { label: 'A', value: 70 },
            { label: 'B', value: 50 },
        ];
        const out = reconcileProvenanceItems(items, 100);
        expect(out.some(i => i.isRemainder)).toBe(false);
        expect(out).toHaveLength(2);
    });

    it('combines sub-threshold items and a shortfall into one remainder row', () => {
        const items = [
            { label: 'Big', value: 80 },
            { label: 'Tiny', value: 0.001 },
        ];
        // Total is 100: 80 itemized + 0.001 tiny + ~19.999 unitemized shortfall.
        const out = reconcileProvenanceItems(items, 100);
        const other = out.find(i => i.isRemainder)!;
        expect(other.label).toBe('Other (+1 smaller)');
        expect(other.value).toBeCloseTo(20, 4);
        expect(sum(out)).toBeCloseTo(100, 6);
    });
});
