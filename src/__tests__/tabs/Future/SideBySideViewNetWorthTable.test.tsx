/**
 * #197 — the "Net Worth by Year" table in SideBySideView rendered
 * `netWorthByYear.slice(0, 10)` plus `netWorthByYear.slice(-5)` unconditionally,
 * gating only the "... N more years ..." separator on `length > 15`. For a
 * comparison spanning 15 or fewer union years the two slices OVERLAP, so the
 * user reads the same year(s) twice with no separator between them:
 *   - ~14 years: slice(0,10)=years 1..10, slice(-5)=years 10..14 → year 10 twice.
 *   - ≤10 years: the entire last-5 block is a verbatim duplicate.
 *
 * These tests render the table with realistically-shaped `netWorthByYear` rows
 * (the exact YearComparison shape `compareScenarios` emits) and assert every
 * year appears EXACTLY once for the ≤15-year cases, while the >15-year case
 * still shows first-10 + separator + last-5.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import { SideBySideView } from '../../../tabs/Future/tabs/SideBySideView';
import type {
    ScenarioComparison,
    YearComparison,
    MilestonesSummary,
    LoadedScenario,
} from '../../../services/ScenarioTypes';

const NOW = new Date().getFullYear();

/** Build a netWorthByYear array using the SAME per-row derivation the real
 *  producer (compareScenarios) uses: delta = comparison - baseline when both
 *  present, deltaPercent = delta / |baseline| * 100. */
function makeNetWorthByYear(count: number): YearComparison[] {
    return Array.from({ length: count }, (_, i) => {
        const year = NOW + i;
        const baseline = 1_000_000 + i * 50_000;
        const comparison = 1_100_000 + i * 55_000;
        const delta = comparison - baseline;
        const deltaPercent = baseline !== 0 ? (delta / Math.abs(baseline)) * 100 : 0;
        return { year, baseline, comparison, delta, deltaPercent };
    });
}

function makeMilestones(finalYear: number, years: number): MilestonesSummary {
    return {
        fiYear: NOW + 5,
        fiAge: 45,
        retirementYear: NOW + 10,
        retirementAge: 55,
        legacyValue: 2_000_000,
        peakNetWorth: 2_500_000,
        peakYear: finalYear,
        yearsOfData: years,
        finalYear,
    };
}

function makeLoadedScenario(id: string, name: string, years: number): LoadedScenario {
    return {
        metadata: {
            id,
            name,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        simulation: [], // not read by the table
        milestones: makeMilestones(NOW + years - 1, years),
    };
}

function makeComparison(netWorthByYear: YearComparison[]): ScenarioComparison {
    const years = netWorthByYear.length;
    return {
        baseline: makeLoadedScenario('base', 'Baseline Plan', years),
        comparison: makeLoadedScenario('comp', 'Comparison Plan', years),
        differences: {
            fiYearDelta: 0,
            legacyValueDelta: 100_000,
            legacyValueDeltaPercent: 5,
            peakNetWorthDelta: 100_000,
            retirementReadinessDelta: 0,
            netWorthByYear,
        },
    };
}

/** Collect the year value from every YearRow (a <tr> whose first <td> is a bare
 *  year number). The "... N more years ..." separator row has a single colSpan
 *  cell and is skipped. */
function renderedYears(container: HTMLElement): number[] {
    const rows = Array.from(container.querySelectorAll('tbody tr'));
    const years: number[] = [];
    for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length < 2) continue; // separator row (colSpan)
        const text = cells[0].textContent?.trim() ?? '';
        if (/^\d+$/.test(text)) years.push(Number(text));
    }
    return years;
}

function duplicates(years: number[]): number[] {
    const seen = new Set<number>();
    const dups = new Set<number>();
    for (const y of years) {
        if (seen.has(y)) dups.add(y);
        seen.add(y);
    }
    return [...dups];
}

describe('#197 SideBySideView Net Worth by Year table — no duplicate rows', () => {
    it('renders each year exactly once for a 14-year comparison (no slice overlap)', () => {
        const netWorthByYear = makeNetWorthByYear(14);
        const { container } = render(<SideBySideView comparison={makeComparison(netWorthByYear)} />);

        const years = renderedYears(container);
        expect(duplicates(years)).toEqual([]);
        expect(years).toEqual(netWorthByYear.map(y => y.year));
    });

    it('renders each year exactly once for a 10-year comparison (last-5 not duplicated)', () => {
        const netWorthByYear = makeNetWorthByYear(10);
        const { container } = render(<SideBySideView comparison={makeComparison(netWorthByYear)} />);

        const years = renderedYears(container);
        expect(duplicates(years)).toEqual([]);
        expect(years).toEqual(netWorthByYear.map(y => y.year));
    });

    it('renders every year once for exactly 15 years (boundary, no separator)', () => {
        const netWorthByYear = makeNetWorthByYear(15);
        const { container } = render(<SideBySideView comparison={makeComparison(netWorthByYear)} />);

        const years = renderedYears(container);
        expect(duplicates(years)).toEqual([]);
        expect(years).toEqual(netWorthByYear.map(y => y.year));
    });

    it('shows first-10 + separator + last-5 (no overlap) for a 20-year comparison', () => {
        const netWorthByYear = makeNetWorthByYear(20);
        const { container } = render(<SideBySideView comparison={makeComparison(netWorthByYear)} />);

        const years = renderedYears(container);
        expect(duplicates(years)).toEqual([]);
        const expected = [
            ...netWorthByYear.slice(0, 10).map(y => y.year),
            ...netWorthByYear.slice(-5).map(y => y.year),
        ];
        expect(years).toEqual(expected);

        // The truncation separator is present with the correct hidden-year count.
        expect(container.textContent).toContain(`... ${20 - 15} more years ...`);
    });
});
