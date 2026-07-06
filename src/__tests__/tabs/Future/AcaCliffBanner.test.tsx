import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CashflowTab } from '../../../tabs/Future/tabs/CashflowTabs';
import {
    AssumptionsContext,
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
    getBirthYear,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxContext, TaxState, defaultTaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { runSimulation } from '../../../components/Objects/Assumptions/useSimulation';
import type { SimulationYear } from '../../../services/simulation/types';

/**
 * Cashflow tab "Withdrawals exceed ACA cliff" banner (CashflowTabs.tsx).
 *
 * A pre-65 retiree whose NON-conversion MAGI already clears the ACA subsidy
 * cliff (400% FPL) should see a warning that subsidies are lost regardless of
 * Roth strategy. The banner must measure against `yearData.magi` — the AGI-like
 * figure the engine populates, which INCLUDES the Traditional/RMD withdrawals
 * that fund a retiree's spending — not `cashflow.totalIncome`, which excludes
 * withdrawals entirely.
 *
 * Regression: the banner read `cashflow.totalIncome - conversionAmount`. For a
 * retiree living purely off portfolio withdrawals that figure is ~$0, so the
 * banner stayed silent for the exact scenario it describes even as the engine
 * routed six figures of withdrawal-driven MAGI over the cliff.
 *
 * These cases run the REAL engine and render the REAL retirement-year output
 * (age 60, first full retirement year), so the fixture is exactly the shape the
 * engine produces (magi ≫ cashflow.totalIncome), not a hand-fabricated stand-in.
 */

// The Sankey is lazy + chart-heavy and irrelevant to the banner. Stub it.
vi.mock('../../../components/Charts/CashflowSankey', () => ({
    CashflowSankey: () => <div data-testid="stub-sankey" />,
}));

const CY = new Date().getFullYear();
const BIRTH_YEAR = CY - 58;      // age 58 now → retires at 60 two years into the sim
const RETIREMENT_AGE = 60;

const assumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, 90),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 0 },        // deterministic
        autoRothConversions: false,     // no ACA_CLIFF optimizer path — isolate this banner
    },
    withdrawalStrategy: [
        { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-trad' },
    ],
};

const taxState: TaxState = {
    ...defaultTaxState,
    filingStatus: 'Married Filing Jointly',
    stateResidency: 'TX',
};

// A retiree funded entirely by a large Traditional IRA: after work income ends at
// 60, the engine withdraws from the IRA to cover the living expense, which drives
// MAGI (but NOT cashflow.totalIncome) up. `annualSpend` sets how far over/under the
// ~$87k MFJ cliff that withdrawal-driven MAGI lands.
function retirementYear(annualSpend: number): SimulationYear {
    const trad = new InvestedAccount(
        'acc-trad', 'Traditional IRA',
        2_000_000, 0, 10, 0.05, 'Traditional IRA', true, 1.0, 2_000_000,
    );
    const work = new WorkIncome(
        'inc-w', 'Job', 80_000, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(`${CY}-01-01`), new Date(`${BIRTH_YEAR + RETIREMENT_AGE - 1}-12-31`),
    );
    const living = new FoodExpense('exp', 'Living', annualSpend, 'Annually', new Date(`${CY}-01-01`));
    const sim = runSimulation(10, [trad], [work], [living], assumptions, taxState);
    // First full retirement year (age 60) — inside the banner's [retirementAge, 65) window.
    const year = sim.find(y => y.year - getBirthYear(assumptions.milestones) === RETIREMENT_AGE);
    if (!year) throw new Error('no retirement year found');
    return year;
}

function renderCashflow(yearData: SimulationYear) {
    return render(
        <AssumptionsContext.Provider value={{ state: assumptions, dispatch: () => null }}>
            <TaxContext.Provider value={{ state: taxState, dispatch: () => null }}>
                <CashflowTab simulationData={[yearData]} />
            </TaxContext.Provider>
        </AssumptionsContext.Provider>
    );
}

describe('ACA cliff "withdrawals exceed cliff" banner', () => {
    it('fires for a retiree whose withdrawal-driven MAGI clears the cliff', () => {
        const year = retirementYear(120_000);
        // Engine-real shape the fix depends on: MAGI (Traditional withdrawal included)
        // is well over the ~$87k MFJ cliff, while cashflow.totalIncome (no withdrawals)
        // is ~$0. The old code read totalIncome and stayed silent.
        expect(year.magi ?? 0).toBeGreaterThan(100_000);
        expect(year.cashflow.totalIncome).toBeLessThan(50_000);

        renderCashflow(year);
        expect(screen.getByText(/exceeds the ACA subsidy cliff/i)).toBeInTheDocument();
    });

    it('stays silent for a retiree whose modest spend keeps MAGI under the cliff', () => {
        const year = retirementYear(40_000);
        expect(year.magi ?? 0).toBeLessThan(80_000);

        renderCashflow(year);
        expect(screen.queryByText(/exceeds the ACA subsidy cliff/i)).not.toBeInTheDocument();
    });
});
