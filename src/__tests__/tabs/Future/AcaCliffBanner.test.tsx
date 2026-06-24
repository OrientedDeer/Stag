import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CashflowTab } from '../../../tabs/Future/tabs/CashflowTabs';
import {
    AssumptionsContext,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext, defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';
import type { SimulationYear } from '../../../services/simulation/types';

/**
 * Cashflow tab "Withdrawals exceed ACA cliff" banner (CashflowTabs.tsx).
 *
 * A pre-65 retiree whose NON-conversion MAGI already clears the ACA subsidy
 * cliff (400% FPL) should see a warning that subsidies are lost regardless of
 * Roth strategy. The cliff value the banner compares against MUST match the
 * one the engine enforces (getAcaCliffThreshold), or the banner stays silent
 * while the engine has already capped conversions at the real cliff.
 *
 * Regression: the banner hardcoded $125,000 (MFJ) / $62,500 (single) — the
 * stale pre-2024 constants the engine itself abandoned (see YearSolver.ts
 * acaFiling note). The real 2026 cliff is ~$87,000 (MFJ), so an MFJ retiree
 * with $90,000 of withdrawal income is OVER the cliff yet saw no banner.
 */

// The Sankey is lazy + chart-heavy and irrelevant to the banner. Stub it.
vi.mock('../../../components/Charts/CashflowSankey', () => ({
    CashflowSankey: () => <div data-testid="stub-sankey" />,
}));

// Birth year 1966 + retirement age 55 → age 60 in the 2026 sim year, which
// lands in the banner's pre-65 retired window [retirementAge, 65).
const PREVIEW_YEAR = 2026;
const assumptions = {
    ...defaultAssumptions,
    milestones: createBuiltinMilestones(1966, 55, 90),
};

function makeYear(totalIncome: number): SimulationYear {
    return {
        year: PREVIEW_YEAR,
        accounts: [],
        incomes: [],
        expenses: [],
        // No Roth conversion → nonConversionMAGI === totalIncome.
        rothConversion: undefined,
        // limitingFactor !== 'ACA_CLIFF' so the *first* banner (engine-driven)
        // stays out of the way and we isolate the second (withdrawal) banner.
        taxOptimizationTarget: undefined,
        strategyAdjustment: undefined,
        taxDetails: { fed: 0, state: 0, fica: 0 },
        cashflow: { totalIncome, livingExpenses: 0, withdrawalDetail: {} },
    } as unknown as SimulationYear;
}

function renderCashflow(totalIncome: number) {
    return render(
        <AssumptionsContext.Provider value={{ state: assumptions, dispatch: () => null }}>
            <TaxContext.Provider
                value={{
                    state: { ...defaultTaxState, filingStatus: 'Married Filing Jointly' },
                    dispatch: () => null,
                }}
            >
                <CashflowTab simulationData={[makeYear(totalIncome)]} />
            </TaxContext.Provider>
        </AssumptionsContext.Provider>
    );
}

describe('ACA cliff "withdrawals exceed cliff" banner', () => {
    it('fires for an MFJ retiree at $90k MAGI — over the real $87k cliff', () => {
        // $90,000 is below the stale hardcoded MFJ constant ($125k) but above
        // the real 2026 cliff ($87k). The fixed banner must fire.
        renderCashflow(90_000);
        expect(screen.getByText(/exceeds the ACA subsidy cliff/i)).toBeInTheDocument();
    });

    it('stays silent for an MFJ retiree comfortably under the cliff ($80k)', () => {
        renderCashflow(80_000);
        expect(screen.queryByText(/exceeds the ACA subsidy cliff/i)).not.toBeInTheDocument();
    });
});
