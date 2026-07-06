/**
 * Working-year deficit tax corrections (#175). solveWorkingYear sized its single
 * withdrawal pass BEFORE three taxes the deficit itself triggers were known:
 *
 *   1. NIIT (3.8%) on realized gains was added to the year's tax AFTER withdrawals
 *      were sized, so it surfaced as phantom unfunded-deficit debt even with ample
 *      sellable balances. The fix iterates like the retirement path, growing the
 *      deficit by the surfaced taxes so withdrawals fund them.
 *   2. State tax on realized LTCG was charged nowhere — the planner grosses up
 *      brokerage LTCG at the FEDERAL rate only. The fix mirrors the retirement
 *      path's finalStateTax (LTCG folded into the state base).
 *   5. The SS torpedo — deficit-funding ordinary withdrawals push more Social
 *      Security into taxability — was taxed nowhere (taxResult is computed pre-
 *      withdrawal). The fix charges the incremental federal tax on the extra
 *      taxable SS.
 *
 * Each test recomputes the authoritative value from the plan's actual realized
 * amounts, so it doesn't depend on hand-predicted withdrawal splits.
 */
import { describe, it, expect } from 'vitest';

import { solveWorkingYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;

function baseAssumptions(birthYear: number): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, 67, 95),
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            acaAware: false,
            returnRates: { ror: 0 },
        },
        withdrawalStrategy: [],
    };
}

function wagesOnly(amount: number): WorkIncome {
    return new WorkIncome(
        'inc-1', 'Salary', amount, 'Annually', 'Yes',
        0, 0, 0, 0, '', null, 'FIXED',
        new Date(YEAR - 5, 0, 1), new Date(YEAR + 4, 11, 31),
    );
}

// =============================================================================
// #175/1 — NIIT must be FUNDED (no phantom unfunded deficit)
// =============================================================================
describe('solveWorkingYear: NIIT is funded, not booked as phantom deficit (#175/1)', () => {
    function buildInput(): YearSolverInput {
        const birthYear = YEAR - 60; // past 59.5 → no early-withdrawal penalty
        // Wages above the $200k Single NIIT threshold so realized gains are fully
        // NIIT-taxed.
        const wages = wagesOnly(250_000);
        // Large brokerage with a high gain ratio — the deficit-funding sale realizes
        // LTCG (→ NIIT) and there is ample balance left over, so any unfunded deficit
        // is phantom.
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 2_000_000, 0, 10, 0.0, 'Brokerage', true, 0.5, 1_000_000);

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 60,
            isRetired: false,
            incomes: [wages],
            expenses: [new OtherExpense('living-1', 'Living', 420_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 420_000,
            rmdAmount: 0,
            accounts: [brokerage],
            withdrawalOrder: [{ accountId: 'brokerage-1' }],
            taxState,
            assumptions: baseAssumptions(birthYear),
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('funds the NIIT with an extra withdrawal instead of fabricating deficit debt', () => {
        const plan = solveWorkingYear(buildInput());

        // NIIT actually fires (guard) and the brokerage has ample balance.
        expect(plan.tax.niit).toBeGreaterThan(50);

        // The old single-pass code left unfundedDeficit ≈ niitTax; the fix funds it.
        expect(plan.unfundedDeficit).toBeLessThan(10);
    });
});

// =============================================================================
// #175/2 — state tax on realized LTCG
// =============================================================================
describe('solveWorkingYear: state tax charged on realized LTCG (#175/2)', () => {
    const WAGES = 80_000;

    function buildInput(): YearSolverInput {
        const birthYear = YEAR - 63; // past 59.5, no SS in this scenario
        const wages = wagesOnly(WAGES);
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 1_000_000, 0, 10, 0.0, 'Brokerage', true, 0.5, 500_000);

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 63,
            isRetired: false,
            incomes: [wages],
            expenses: [new OtherExpense('living-1', 'Living', 140_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 140_000,
            rmdAmount: 0,
            accounts: [brokerage],
            withdrawalOrder: [{ accountId: 'brokerage-1' }],
            taxState,
            assumptions: baseAssumptions(birthYear),
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('adds the DC state tax on realized long-term gains the planner (federal-only) omits', () => {
        const input = buildInput();
        const plan = solveWorkingYear(input);

        const stateParams = TaxService.getTaxParameters(YEAR, input.taxState.filingStatus, 'state', input.taxState.stateResidency, input.assumptions);
        expect(stateParams).toBeDefined();
        const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, YEAR, input.currentAge, true);

        const realizedLTCG = plan.withdrawals.reduce((s, w) => s + (w.capitalGains?.longTerm ?? 0), 0);
        expect(realizedLTCG).toBeGreaterThan(0);

        // No SS, no conversion, no 401k deductions → the state ordinary base is the wages.
        const stateNoLTCG = TaxService.calculateTax(WAGES, preTaxDeductions, stateParams!);
        const stateWithLTCG = TaxService.calculateTax(WAGES + realizedLTCG, preTaxDeductions, stateParams!);

        // The straddle bites: LTCG genuinely raises the DC bill.
        expect(stateWithLTCG - stateNoLTCG).toBeGreaterThan(100);

        // The solver levies the LTCG-inclusive state tax (old code charged stateNoLTCG).
        expect(plan.tax.state).toBeCloseTo(stateWithLTCG, 1);
        expect(plan.tax.state).not.toBeCloseTo(stateNoLTCG, 1);
    });
});

// =============================================================================
// #175/5 — SS torpedo: federal tax on the extra taxable SS the withdrawal creates
// =============================================================================
describe('solveWorkingYear: SS torpedo on deficit-funding Traditional withdrawals (#175/5)', () => {
    const WAGES = 15_000;
    const SS = 40_000;

    function buildInput(): YearSolverInput {
        const birthYear = YEAR - 63; // collecting SS while still working, past 59.5
        const wages = wagesOnly(WAGES);
        const ss = new CurrentSocialSecurityIncome('ss-1', 'Social Security', SS, 'Annually', new Date(YEAR - 1, 0, 1));
        // Traditional only → deficit funded by ordinary income (no gains), isolating
        // the SS torpedo. Texas → no state tax in the way.
        const traditional = new InvestedAccount('trad-1', 'Traditional IRA', 300_000, 0, 10, 0.0, 'Traditional IRA');

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 63,
            isRetired: false,
            incomes: [wages, ss],
            expenses: [new OtherExpense('living-1', 'Living', 95_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 95_000,
            rmdAmount: 0,
            accounts: [traditional],
            withdrawalOrder: [{ accountId: 'trad-1' }],
            taxState,
            assumptions: baseAssumptions(birthYear),
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('charges the incremental federal tax on the extra taxable SS the withdrawal triggers', () => {
        const input = buildInput();
        const plan = solveWorkingYear(input);

        const fedParams = TaxService.getTaxParameters(YEAR, input.taxState.filingStatus, 'federal', undefined, input.assumptions);
        expect(fedParams).toBeDefined();
        const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, YEAR, input.currentAge, true);

        // No SS, no conversion, no 401k deductions → baseExSS is the wages.
        const baseExSS = WAGES;

        const withdrawalOrdinaryIncome = plan.withdrawals.reduce(
            (s, w) => s + ((w.source === 'traditional_401k' || w.source === 'traditional_ira')
                ? w.gross
                : (w.ordinaryIncome ?? 0)),
            0);
        expect(withdrawalOrdinaryIncome).toBeGreaterThan(0);

        // Base federal tax (pre-withdrawal SS taxability) — what the old code charged.
        const base = TaxService.calculateTotalFederalTax(
            baseExSS, SS, 0, 0, preTaxDeductions, input.taxState.filingStatus, fedParams!);
        const baseFederalTax = base.totalTax;

        // The withdrawal pushed more SS into taxability (the torpedo).
        const torpedoTaxableSS = TaxService.getTaxableSocialSecurityBenefits(
            SS, baseExSS + withdrawalOrdinaryIncome, 0, input.taxState.filingStatus);
        expect(torpedoTaxableSS).toBeGreaterThan(base.taxableSS + 1);

        const fedOrdinaryTaxAt = (ordinary: number): number =>
            TaxService.calculateTotalFederalTax(
                Math.max(0, ordinary), 0, 0, 0, preTaxDeductions, input.taxState.filingStatus, fedParams!,
            ).ordinaryTax;
        const torpedo = fedOrdinaryTaxAt(baseExSS + torpedoTaxableSS) - fedOrdinaryTaxAt(baseExSS + base.taxableSS);
        expect(torpedo).toBeGreaterThan(50);

        // The solver's reported federal tax includes the torpedo (old code charged
        // only baseFederalTax).
        expect(plan.tax.federal).toBeCloseTo(baseFederalTax + torpedo, 0);
        expect(plan.tax.federal).not.toBeCloseTo(baseFederalTax, 0);
    });
});

// =============================================================================
// #175/4 — the planner's LTCG bracket sees the TAXABLE portion of SS, not 100%
// =============================================================================
describe('solveWorkingYear: LTCG bracket positioned at taxable SS, not 100% SS (#175/4)', () => {
    const WAGES = 10_000;
    const SS = 60_000;

    function buildInput(): YearSolverInput {
        const birthYear = YEAR - 63; // collecting SS while working, past 59.5
        const wages = wagesOnly(WAGES);
        const ss = new CurrentSocialSecurityIncome('ss-1', 'Social Security', SS, 'Annually', new Date(YEAR - 1, 0, 1));
        // Brokerage with a high gain ratio so the deficit-funding sale realizes LTCG.
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 1_000_000, 0, 10, 0.0, 'Brokerage', true, 0.9, 100_000);

        const taxState: TaxState = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: null, ficaOverride: null, stateOverride: null, year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 63,
            isRetired: false,
            incomes: [wages, ss],
            expenses: [new OtherExpense('living-1', 'Living', 95_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 95_000,
            rmdAmount: 0,
            accounts: [brokerage],
            withdrawalOrder: [{ accountId: 'brokerage-1' }],
            taxState,
            assumptions: baseAssumptions(birthYear),
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('taxes realized LTCG at 0% (taxable-SS position) where 100%-SS would force 15%', () => {
        const plan = solveWorkingYear(buildInput());

        const realizedLTCG = plan.withdrawals.reduce((s, w) => s + (w.capitalGains?.longTerm ?? 0), 0);
        expect(realizedLTCG).toBeGreaterThan(20_000);

        // The planner picks the LTCG rate from the ORDINARY-income position. Positioned
        // at base ordinary ($10k wages) + the TAXABLE portion of SS, that position stays
        // in the 0% LTCG bracket → no capital-gains tax. Under the old 100%-of-SS
        // position ($10k + $60k = $70k), the same gain is charged 15% (~$4.5k).
        expect(plan.tax.capitalGainsLT).toBeLessThan(1);
    });
});
