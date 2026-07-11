/**
 * Working-year tax edge cases in solveWorkingYear (YearSolver.ts).
 *
 * Two independent bugs, one test each:
 *
 *   ISSUE 1 — Working-year STATE tax taxes 100% of Social Security.
 *     solveWorkingYear passes the SS-inclusive `taxableOrdinaryBase` to the state
 *     tax calc. DC (and every modeled state) exempts SS from the state income tax;
 *     the retirement path correctly passes `base - socialSecurityBenefits`. So a
 *     working year that also collects SS overstates the state base by the full SS
 *     benefit. Reachable when one spouse claims at 62 while the other still works.
 *
 *   ISSUE 2 — NIIT MAGI omits the deficit-funding Traditional withdrawal.
 *     The NIIT recompute uses the pre-deficit ordinary income, so the Traditional
 *     withdrawal that funds the year's deficit never enters the NIIT MAGI base.
 *     When base MAGI sits just below the NIIT threshold but the Trad withdrawal
 *     pushes true MAGI above it, NIIT is understated. IRMAA and SS-taxability both
 *     already add the Trad withdrawal to their MAGI — NIIT should too.
 *
 * Each test recomputes the authoritative value independently from the plan's
 * actual realized amounts, so it does not depend on hand-predicted withdrawal
 * splits.
 */

import { describe, it, expect } from 'vitest';

import { solveWorkingYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

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

// =============================================================================
// ISSUE 1 — Working-year STATE tax must exempt Social Security
// =============================================================================

describe('solveWorkingYear: state tax exempts Social Security (Issue 1)', () => {
    function buildInput(): YearSolverInput {
        // Age 63: working (before the age-67 RETIRE milestone) but collecting SS.
        const birthYear = YEAR - 63;

        const wages = new WorkIncome(
            'inc-1', 'Salary', 120_000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(YEAR - 5, 0, 1), new Date(YEAR + 4, 11, 31),
        );
        const ss = new CurrentSocialSecurityIncome(
            'ss-1', 'Social Security', 30_000, 'Annually', new Date(YEAR - 1, 0, 1),
        );

        // Comfortable income vs. expenses → no withdrawals; isolates the state-tax base.
        const savings = new InvestedAccount('sav-1', 'Savings', 50_000, 0, 0, 0.0, 'Brokerage');

        const taxState: TaxState = {
            filingStatus: 'Married Filing Jointly',
            stateResidency: 'DC',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 63,
            isRetired: false,
            incomes: [wages, ss],
            expenses: [new OtherExpense('living-1', 'Living', 60_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 60_000,
            rmdAmount: 0,
            accounts: [savings],
            withdrawalOrder: [{ accountId: 'sav-1' }],
            taxState,
            assumptions: baseAssumptions(birthYear),
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('does NOT tax Social Security in the working-year state tax', () => {
        const input = buildInput();
        const plan = solveWorkingYear(input);

        const fedParams = TaxService.getTaxParameters(YEAR, input.taxState.filingStatus, 'federal', undefined, input.assumptions);
        const stateParams = TaxService.getTaxParameters(YEAR, input.taxState.filingStatus, 'state', input.taxState.stateResidency, input.assumptions);
        expect(fedParams).toBeDefined();
        expect(stateParams).toBeDefined();

        // Wages $120k (ordinary) + SS $30k. No withdrawals (income covers expenses).
        const ordinaryBaseInclSS = 120_000 + 30_000;
        const ss = 30_000;
        const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, YEAR, input.currentAge, true);

        // The two candidate state bases: with SS in the base (buggy) vs. SS-free (correct).
        const stateTaxWithSS = TaxService.calculateTax(ordinaryBaseInclSS, preTaxDeductions, stateParams!);
        const stateTaxNoSS = TaxService.calculateTax(ordinaryBaseInclSS - ss, preTaxDeductions, stateParams!);

        // Sanity: the SS benefit actually moves the DC state bill (so the test bites).
        expect(stateTaxWithSS - stateTaxNoSS).toBeGreaterThan(500);

        // The solver must levy the SS-free state tax (mirrors the retirement path).
        expect(plan.tax.state).toBeCloseTo(stateTaxNoSS, 2);
        expect(plan.tax.state).not.toBeCloseTo(stateTaxWithSS, 2);
    });
});

// =============================================================================
// ISSUE 2 — NIIT MAGI must include the deficit-funding Traditional withdrawal
// =============================================================================

describe('solveWorkingYear: NIIT MAGI includes the deficit-funding Traditional withdrawal (Issue 2)', () => {
    function buildInput(): YearSolverInput {
        // Age 60: still working (before the age-67 RETIRE milestone) but past 59.5,
        // so the Traditional withdrawal carries no early-withdrawal penalty and is
        // tapped before the brokerage.
        const birthYear = YEAR - 60;

        // Wages below the $200k Single NIIT threshold; with realized LTCG alone the
        // base MAGI sits near the threshold, but the Traditional withdrawal that
        // also funds the deficit pushes true MAGI well over it.
        const wages = new WorkIncome(
            'inc-1', 'Salary', 150_000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(YEAR - 5, 0, 1), new Date(YEAR + 4, 11, 31),
        );

        // Small Traditional account (fully drains → $50k ordinary income), withdrawn
        // FIRST; the brokerage then funds the rest, realizing LTCG.
        const traditional = new InvestedAccount(
            'trad-1', 'Traditional IRA', 50_000, 0, 10, 0.0, 'Traditional IRA');
        // Brokerage with a high gain ratio so the deficit-funding sale realizes LTCG.
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 400_000, 0, 10, 0.0, 'Brokerage', true, 0.2, 40_000);

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'Texas', // no state tax → isolates the federal NIIT effect
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 60,
            isRetired: false,
            incomes: [wages],
            expenses: [new OtherExpense('living-1', 'Living', 200_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 200_000,
            rmdAmount: 0,
            accounts: [traditional, brokerage],
            withdrawalOrder: [{ accountId: 'trad-1' }, { accountId: 'brokerage-1' }],
            taxState,
            assumptions: baseAssumptions(birthYear),
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('charges NIIT on the MAGI that includes the Traditional withdrawal', () => {
        const input = buildInput();
        const plan = solveWorkingYear(input);

        const fedParams = TaxService.getTaxParameters(YEAR, input.taxState.filingStatus, 'federal', undefined, input.assumptions);
        expect(fedParams).toBeDefined();
        const preTaxDeductions = TaxService.getPreTaxExemptions(input.incomes, YEAR, input.currentAge, true);

        const nonSSBase = 150_000; // wages; no SS in this scenario

        // Realized amounts from the plan's actual withdrawals.
        const realizedLTCG = plan.withdrawals.reduce((s, w) => s + (w.capitalGains?.longTerm ?? 0), 0);
        const realizedSTCG = plan.withdrawals.reduce((s, w) => s + (w.capitalGains?.shortTerm ?? 0), 0);
        // Ordinary income realized by the deficit-funding withdrawals — mirrors the
        // solver's own `withdrawalOrdinaryIncome` (Traditional gross + ESPP element).
        const withdrawalOrdinaryIncome = plan.withdrawals.reduce(
            (s, w) => s + ((w.source === 'traditional_401k' || w.source === 'traditional_ira')
                ? w.gross
                : (w.ordinaryIncome ?? 0)),
            0);

        // Guards: the scenario actually exercises the threshold straddle.
        expect(realizedLTCG).toBeGreaterThan(0);
        expect(withdrawalOrdinaryIncome).toBeGreaterThan(0);

        // Buggy NIIT (current code): MAGI omits the Traditional withdrawal.
        const buggyNIIT = TaxService.calculateTotalFederalTax(
            nonSSBase, 0, realizedSTCG, realizedLTCG,
            preTaxDeductions, input.taxState.filingStatus, fedParams!,
        ).niitTax;

        // Correct NIIT: MAGI includes the Traditional withdrawal ordinary income.
        const correctNIIT = TaxService.calculateTotalFederalTax(
            nonSSBase + withdrawalOrdinaryIncome, 0, realizedSTCG, realizedLTCG,
            preTaxDeductions, input.taxState.filingStatus, fedParams!,
        ).niitTax;

        // The straddle must be real: including the Trad withdrawal raises NIIT.
        expect(correctNIIT).toBeGreaterThan(buggyNIIT + 1);

        // The solver must charge the correct (Trad-inclusive) NIIT.
        expect(plan.tax.niit).toBeCloseTo(correctNIIT, 2);
        expect(plan.tax.niit).not.toBeCloseTo(buggyNIIT, 2);
    });
});

// =============================================================================
// #154 — the working-year deficit honors the LITERAL withdrawal order (Tax Opt
// off), exactly like the retirement drawdown. With Tax Opt ON the optimizer owns
// the order and keeps its penalty-aware bucketing.
// =============================================================================
describe('solveWorkingYear: literal withdrawal order on the deficit path (#154)', () => {
    // Age 50 — a pre-59½ working year with a spending deficit, and a manual order
    // that lists the early-withdrawal-PENALIZED Traditional FIRST, ahead of the
    // non-penalized brokerage. Fabricated figures.
    function buildInput(taxOptimizationEnabled: boolean): YearSolverInput {
        const birthYear = YEAR - 50;
        const wages = new WorkIncome(
            'inc-1', 'Salary', 30_000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED',
            new Date(YEAR - 5, 0, 1), new Date(YEAR + 9, 11, 31),
        );
        // Traditional ($50k) drains fully under literal order; pre-59½ so it carries
        // the 10% early-withdrawal penalty when tapped.
        const traditional = new InvestedAccount(
            'trad-1', 'Traditional IRA', 50_000, 0, 10, 0.0, 'Traditional IRA');
        // Large brokerage (non-penalized) — covers the whole deficit on its own when
        // the bucketing taps it first.
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 500_000, 0, 10, 0.0, 'Brokerage', true, 0.2, 50_000);

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'Texas',
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: YEAR,
        };

        const assumptions = baseAssumptions(birthYear);
        return {
            year: YEAR,
            currentAge: 50,
            isRetired: false,
            incomes: [wages],
            expenses: [new OtherExpense('living-1', 'Living', 130_000, 'Annually', new Date(YEAR - 5, 0, 1))],
            totalLivingExpenses: 130_000,
            rmdAmount: 0,
            accounts: [traditional, brokerage],
            // Penalized Traditional listed FIRST, non-penalized brokerage second.
            withdrawalOrder: [{ accountId: 'trad-1' }, { accountId: 'brokerage-1' }],
            taxState,
            assumptions: { ...assumptions, investments: { ...assumptions.investments, taxOptimizationEnabled } },
            taxOptimizationEnabled,
            acaAware: false,
        };
    }

    const isTraditional = (s: string) => s === 'traditional_ira' || s === 'traditional_401k';

    it('Tax Opt OFF taps the listed Traditional FIRST (literal order) and incurs the early-withdrawal penalty', () => {
        const plan = solveWorkingYear(buildInput(false));

        expect(plan.withdrawals.length).toBeGreaterThan(0);
        // Literal order: the user's first-listed (penalized) Traditional is tapped first.
        expect(isTraditional(plan.withdrawals[0].source)).toBe(true);
        // The brokerage funds the remainder, so it appears AFTER the Traditional.
        const tradIdx = plan.withdrawals.findIndex(w => isTraditional(w.source));
        const brokIdx = plan.withdrawals.findIndex(w => w.source === 'brokerage');
        expect(brokIdx).toBeGreaterThan(tradIdx);
        // Tapping the pre-59½ Traditional incurs the 10% penalty the bucketing avoids.
        expect(plan.tax.penalties).toBeGreaterThan(0);
    });

    it('Tax Opt ON keeps penalty-aware bucketing: non-penalized brokerage first, Traditional deferred, no penalty', () => {
        const plan = solveWorkingYear(buildInput(true));

        expect(plan.withdrawals.length).toBeGreaterThan(0);
        // Bucketing taps the non-penalized brokerage first; it covers the whole deficit,
        // so the penalized Traditional is never touched.
        expect(plan.withdrawals[0].source).toBe('brokerage');
        expect(plan.withdrawals.some(w => isTraditional(w.source))).toBe(false);
        expect(plan.tax.penalties).toBe(0);
    });
});
