/**
 * Regression tests for the PR #54 code-review fixes.
 *
 * Each test asserts on stable, public YearPlanTax fields so it compiles against
 * both the pre-fix and post-fix sources — that is what makes it a valid
 * red-before / green-after regression guard.
 *
 * Fix #1 — ESPP bargain-element ordinary tax was misrouted into the LTCG
 *   pass-through: it was subtracted from cash-in (via actualLTCGTax) and dropped
 *   from `withdrawalOrdinaryTax` / `tax.total`. A retirement year funded by an
 *   ESPP sale must report that ordinary tax in `tax.withdrawalOrdinaryTax`
 *   (which was 0 before the fix, since the ESPP draw was the only withdrawal).
 *
 * Fix #2 — solveWorkingYear hardcoded `niit: 0`, so capital gains realized to
 *   fund a deficit escaped the 3.8% NIIT. A high-income working year with a
 *   deficit-driven brokerage sale must report `tax.niit > 0` (was 0 before).
 */

import { describe, it, expect } from 'vitest';

import { solveRetirementYear, solveWorkingYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import { planWithdrawals, createAccountSnapshot } from '../../../services/simulation/WithdrawalPlanner';
import { ESPPAccount, InvestedAccount, SavedAccount, type ESPPLot } from '../../../components/Objects/Accounts/models';
import { WorkIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function singleTexas(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas', // no state income tax → isolates the federal effect
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

// =============================================================================
// Fix #1 — ESPP bargain-element ordinary tax routing
// =============================================================================

describe('PR #54 fix #1 — ESPP bargain-element ordinary tax routing', () => {
    function esppAccounts() {
        // Same lot shape as Scenario 9: both lots have a real bargain element.
        const lotA: ESPPLot = {
            id: 'lot-a', shares: 100, purchasePrice: 15,
            purchaseDate: new Date('2022-06-30'), grantDate: new Date('2021-01-01'),
            fmvAtPurchase: 20, fmvAtGrant: 20, totalCost: 1500, discountAmount: 5,
        };
        const lotB: ESPPLot = {
            id: 'lot-b', shares: 50, purchasePrice: 34,
            purchaseDate: new Date('2024-06-30'), grantDate: new Date('2024-01-01'),
            fmvAtPurchase: 40, fmvAtGrant: 40, totalCost: 1700, discountAmount: 6,
        };
        const espp = new ESPPAccount(
            'espp-1', 'Company ESPP', (100 * 200) + (50 * 400), [lotA, lotB],
            null, undefined, 'ACME', 200,
        );
        const traditional = new InvestedAccount('trad-1', 'Traditional IRA', 300000, 0, 10, 0.05, 'Traditional IRA');
        const savings = new SavedAccount('savings-1', 'Savings', 10000, 2.0);
        return [espp, traditional, savings];
    }

    function esppAssumptions(): AssumptionsState {
        return {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(1980, 40, 95), // age 45 in 2025, retired
            investments: {
                ...defaultAssumptions.investments,
                taxOptimizationEnabled: false,
                returnRates: { ror: 7 },
            },
            withdrawalStrategy: [],
        };
    }

    it('reports the ESPP ordinary tax in withdrawalOrdinaryTax instead of dropping it', () => {
        const input: YearSolverInput = {
            year: YEAR,
            currentAge: 45,
            isRetired: true,
            incomes: [],
            expenses: [new OtherExpense('living-1', 'Living', 35000, 'Annually', new Date('2020-01-01'))],
            totalLivingExpenses: 35000,
            rmdAmount: 0,
            accounts: esppAccounts(),
            // #154: Tax Opt off → the order is now honored LITERALLY (no penalty-aware
            // re-bucketing). Order savings ahead of the penalized Traditional so the small
            // post-ESPP remainder draws from savings, keeping any ordinary withdrawal tax
            // attributable solely to the ESPP bargain element (the old bucketing moved the
            // pre-59½ Traditional last implicitly; this makes that intent explicit).
            withdrawalOrder: [{ accountId: 'espp-1' }, { accountId: 'savings-1' }, { accountId: 'trad-1' }],
            taxState: singleTexas(),
            assumptions: esppAssumptions(),
            taxOptimizationEnabled: false,
            acaAware: false,
        };

        const plan = solveRetirementYear(input);

        // ESPP ($40k) + savings cover the $35k deficit — no Traditional draw — so any
        // ordinary withdrawal tax must be the ESPP bargain element.
        expect(plan.withdrawals.some(w => w.source === 'espp')).toBe(true);
        expect(plan.withdrawals.some(w => w.source.startsWith('traditional'))).toBe(false);

        // Pre-fix: 0 (ESPP ordinary tax swept into the LTCG pass-through).
        expect(plan.tax.withdrawalOrdinaryTax).toBeGreaterThan(0);
    });
});

// =============================================================================
// Fix #2 — NIIT on working-year capital gains
// =============================================================================

describe('PR #54 fix #2 — NIIT on working-year capital gains', () => {
    it('assesses the 3.8% NIIT on gains realized to fund a working-year deficit', () => {
        const work = new WorkIncome(
            'work-1', 'Job', 250000, 'Annually', 'Yes',
            0, 0, 0, 0, '', 'Traditional 401k', 'FIXED',
            new Date('2015-01-01'), undefined,
        );
        // Brokerage with ~90% unrealized gains (costBasis 20k of 200k) so a sale
        // realizes substantial LTCG; income is well above the $200k NIIT threshold.
        const brokerage = new InvestedAccount('brokerage-1', 'Brokerage', 200000, 0, 10, 0.07, 'Brokerage', true, 0.25, 20000);

        const input: YearSolverInput = {
            year: YEAR,
            currentAge: 45,
            isRetired: false,
            incomes: [work],
            expenses: [new OtherExpense('living-1', 'Living', 230000, 'Annually', new Date('2020-01-01'))],
            totalLivingExpenses: 230000,
            rmdAmount: 0,
            accounts: [brokerage],
            withdrawalOrder: [{ accountId: 'brokerage-1' }],
            taxState: singleTexas(),
            assumptions: {
                ...defaultAssumptions,
                milestones: createBuiltinMilestones(1980, 65, 95), // age 45, still working
                investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false },
                withdrawalStrategy: [],
            },
            taxOptimizationEnabled: false,
            acaAware: false,
        };

        const plan = solveWorkingYear(input);

        // Sanity: the year ran a deficit funded by a gain-bearing brokerage sale.
        expect(plan.withdrawals.some(w => w.source === 'brokerage')).toBe(true);
        expect(plan.tax.capitalGainsLT).toBeGreaterThan(0);

        // Pre-fix: niit was hardcoded to 0.
        expect(plan.tax.niit).toBeGreaterThan(0);
    });
});

// =============================================================================
// Fix #4 — per-account LTCG rate must stack on already-realized gains
// =============================================================================
// Unit test directly on the exported planWithdrawals (the bug washes out of the
// integration path because YearSolver iterates on total LTCG, but the per-account
// gross-up rate is wrong within a single pass).

describe('PR #54 fix #4 — LTCG rate stacks on cumulative realized gains', () => {
    it('taxes a later gain-bearing account at 15% once earlier gains fill the 0% bracket', () => {
        // Two fully-appreciated brokerage accounts (costBasis 0 → gainRatio ~1).
        // currentOrdinaryIncome = 0, so the first ~$48k of LTCG is in the 0%
        // bracket and the remainder is 15%.
        const broker1 = new InvestedAccount('b1', 'Brokerage 1', 60000, 0, 20, 0.05, 'Brokerage', true, 1.0, 0);
        const broker2 = new InvestedAccount('b2', 'Brokerage 2', 60000, 0, 20, 0.05, 'Brokerage', true, 1.0, 0);

        const snapshots = [createAccountSnapshot(broker1), createAccountSnapshot(broker2)];

        // $100k net needed: broker1 fully covers ~$60k (taxed at 0%, pushing
        // cumulative LTCG past the 0% ceiling), broker2 covers the remaining ~$40k.
        const result = planWithdrawals(
            100000,
            snapshots,
            50, // age — brokerage has no early-withdrawal penalty
            YEAR,
            singleTexas(),
            0, // currentOrdinaryIncome
            defaultAssumptions,
            'Spending deficit',
        );

        const draw1 = result.withdrawals.find(w => w.accountId === 'b1');
        const draw2 = result.withdrawals.find(w => w.accountId === 'b2');
        expect(draw1).toBeDefined();
        expect(draw2).toBeDefined();

        // broker1's gains sit in the 0% bracket → ~no tax (true before and after).
        expect(draw1!.tax).toBeLessThan(1);

        // broker2's gains stack above broker1's realized LTCG → 15% bracket.
        // Pre-fix the rate lookup ignored cumulativeLTCG and returned 0% → tax 0.
        expect(draw2!.tax).toBeGreaterThan(0);
    });
});
