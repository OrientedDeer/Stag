import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McHeadlineTiles } from '../../../tabs/Future/tabs/McHeadlineTiles';
import type { MonteCarloSummary } from '../../../services/MonteCarloTypes';

/**
 * Headline tile row (#162 D1): when the summary carries the after-tax
 * terminal distribution, the tiles are AFTER-TAX (bad/median/good case);
 * when it predates that field (stale persisted summary), the legacy gross
 * tiles render instead. The certainty-equivalent tile was removed by owner
 * veto 2026-07-04 (the stat is still computed on the summary, just not
 * shown). All numbers invented.
 */

// Only the fields the tiles read — mirror the cast-fixture convention used
// by the other Future-tab tests.
const grossOnlySummary = {
    successRate: 92.5,
    successfulScenarios: 925,
    totalScenarios: 1000,
    averageFinalNetWorth: 2_345_678,
    percentiles: {
        p10: [{ year: 2060, netWorth: 400_000 }],
        p50: [{ year: 2060, netWorth: 1_500_000 }],
        p90: [{ year: 2060, netWorth: 3_200_000 }],
    },
} as unknown as MonteCarloSummary;

const afterTaxSummary = {
    ...grossOnlySummary,
    afterTaxPercentiles: { p10: 350_000, p50: 1_200_000, p90: 2_800_000 },
    certaintyEquivalents: { gamma2: 950_000, gamma4: 700_000, solventCount: 925, totalCount: 1000 },
} as unknown as MonteCarloSummary;

describe('McHeadlineTiles', () => {
    it('renders after-tax tiles + caption when the summary has after-tax data', () => {
        render(<McHeadlineTiles summary={afterTaxSummary} forceExact={false} />);

        // Caption explains what the row is.
        expect(screen.getByText(/After-tax terminal net worth/)).toBeInTheDocument();

        // The four headline tiles.
        expect(screen.getByText('Success Rate')).toBeInTheDocument();
        expect(screen.getByText('92.5%')).toBeInTheDocument();
        expect(screen.getByText('Bad Case')).toBeInTheDocument();
        expect(screen.getByText('$350.0K')).toBeInTheDocument(); // after-tax p10
        expect(screen.getByText('Median')).toBeInTheDocument();
        expect(screen.getByText('$1.20M')).toBeInTheDocument(); // after-tax p50
        expect(screen.getByText('Good Case')).toBeInTheDocument();
        expect(screen.getByText('$2.80M')).toBeInTheDocument(); // after-tax p90

        // The CE tile is gone (owner veto) even when the stat is present.
        expect(screen.queryByText('Certainty Equivalent')).not.toBeInTheDocument();
        expect(screen.queryByText('$950.0K')).not.toBeInTheDocument();

        // GROSS values must NOT be in the headline (they live on the fan chart).
        expect(screen.queryByText('$1.50M')).not.toBeInTheDocument();
        expect(screen.queryByText('Trimmed Avg')).not.toBeInTheDocument();
    });

    it('falls back to the legacy gross tiles on a stale summary without after-tax data', () => {
        render(<McHeadlineTiles summary={grossOnlySummary} forceExact={false} />);

        expect(screen.getByText('Success Rate')).toBeInTheDocument();
        expect(screen.getByText('10th Percentile')).toBeInTheDocument();
        expect(screen.getByText('$400.0K')).toBeInTheDocument(); // gross p10
        expect(screen.getByText('$1.50M')).toBeInTheDocument(); // gross p50
        expect(screen.getByText('90th Percentile')).toBeInTheDocument();
        expect(screen.getByText('$3.20M')).toBeInTheDocument(); // gross p90
        expect(screen.getByText('Trimmed Avg')).toBeInTheDocument();
        expect(screen.getByText('$2.35M')).toBeInTheDocument();

        // No after-tax framing in fallback mode.
        expect(screen.queryByText('Bad Case')).not.toBeInTheDocument();
        expect(screen.queryByText(/After-tax terminal net worth/)).not.toBeInTheDocument();
    });

    it('never truncates currency values (#162 D4 — mobile clipping)', () => {
        const { container: afterTax } = render(<McHeadlineTiles summary={afterTaxSummary} forceExact={false} />);
        expect(afterTax.querySelector('.truncate')).toBeNull();

        const { container: gross } = render(<McHeadlineTiles summary={grossOnlySummary} forceExact={false} />);
        expect(gross.querySelector('.truncate')).toBeNull();
    });
});
