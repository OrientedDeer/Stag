import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McConversionCard } from '../../../tabs/Future/tabs/McConversionCard';
import type { MonteCarloSummary } from '../../../services/MonteCarloTypes';

/**
 * Merged "Roth conversion behavior" card (#162 D3): verdict-first when the
 * baseline comparison ran; empty state owns the ToggleInput; stale state
 * points at Run Simulation. All numbers invented.
 */

const baselineComparison = {
    baselineSuccessRate: 90,
    deltaSuccessRate: 4.2,
    activeFailures: 3,
    baselineFailures: 10,
    medianDepletionYearActive: null,
    medianDepletionYearBaseline: null,
    fractionBehindBaseline: 0.1,
    afterTaxDelta: { p10: 40_000, p50: 120_000, p90: 300_000 },
    baselineAfterTax: { p10: 500_000, p50: 1_000_000, p90: 2_000_000 },
};

const conversionStats = {
    totalConverted: { p10: 100_000, p50: 250_000, p90: 400_000 },
    fractionOfPathsConverting: 0.8,
    medianConvertedAfterDownYear: 60_000,
    medianConvertedAfterOtherYears: 50_000,
    sampleYearsAfterDown: 40,
    sampleYearsAfterOther: 200,
};

const fullSummary = {
    successRate: 94.2,
    baselineComparison,
    conversionStats,
} as unknown as MonteCarloSummary;

const noComparisonSummary = {
    successRate: 94.2,
    conversionStats,
} as unknown as MonteCarloSummary;

describe('McConversionCard', () => {
    it('leads with the verdict sentence when the baseline comparison ran', () => {
        render(
            <McConversionCard
                summary={fullSummary}
                compareToBaseline={true}
                onToggleCompare={() => undefined}
                forceExact={false}
            />
        );

        // Verdict first: gain + success delta + baseline framing in ONE sentence.
        expect(screen.getByText(/The conversion plan gained \+\$120\.0K median after-tax per path and \+4\.2 pts success \(94\.2% vs 90\.0%\)/)).toBeInTheDocument();

        // Detail rows below.
        expect(screen.getByText(/Failed paths:/)).toBeInTheDocument();
        expect(screen.getByText(/Paths ending behind the baseline:/)).toBeInTheDocument();

        // Converted-per-path audit below the divider.
        expect(screen.getByText(/Total converted per path:/)).toBeInTheDocument();
        expect(screen.getByText(/Paths converting anything:/)).toBeInTheDocument();
        expect(screen.getByText(/buys the dip/)).toBeInTheDocument();
    });

    it('shows the empty state with the ToggleInput when the toggle is off and no data exists', () => {
        const onToggle = vi.fn();
        render(
            <McConversionCard
                summary={null}
                compareToBaseline={false}
                onToggleCompare={onToggle}
                forceExact={false}
            />
        );

        expect(screen.getByText(/roughly doubles run time/)).toBeInTheDocument();
        expect(screen.getByText('Baseline Comparison')).toBeInTheDocument();
        expect(screen.queryByText(/The conversion plan/)).not.toBeInTheDocument();

        // The ToggleInput is live — clicking it persists the config change.
        const toggleButton = document.getElementById('mc-compare-baseline');
        expect(toggleButton).not.toBeNull();
        fireEvent.click(toggleButton!);
        expect(onToggle).toHaveBeenCalledWith(true);
    });

    it('asks for a re-run when the toggle is on but the summary predates it', () => {
        render(
            <McConversionCard
                summary={noComparisonSummary}
                compareToBaseline={true}
                onToggleCompare={() => undefined}
                forceExact={false}
            />
        );

        expect(screen.getByText(/click Run Simulation/)).toBeInTheDocument();
        expect(screen.queryByText(/The conversion plan gained/)).not.toBeInTheDocument();

        // The audit block still renders — paths did convert on the last run.
        expect(screen.getByText(/Total converted per path:/)).toBeInTheDocument();
    });
});
