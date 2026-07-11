/**
 * Review-fix regression tests for PR #59 (YearSolver findings).
 *
 * Finding #2 — `estimatedESPPOrdinaryIncome` was missing from the deficit
 *   loop's convergence check. The loop could exit on the very iteration the
 *   ESPP bargain-element estimate jumped (ltcgDelta and tradDelta both ~0),
 *   so the final SS taxability / federal tax were computed from a stale ESPP
 *   estimate while the withdrawals embodied the new one. Trigger: SS benefits
 *   funded alongside an ESPP sale whose lots carry a large bargain element but
 *   ~zero capital gain (price == fmvAtPurchase) — LTCG stays 0 (delta < 1)
 *   while ordinary income jumps by tens of thousands.
 *
 * Finding #3 — `estimateMAGI` (ACA-cliff binary search inside planConversion)
 *   computed state tax on `allOrdinaryIncome` (which embeds the taxable SS
 *   portion), while the authoritative solver loop excludes SS from the state
 *   base (`allOrdinaryIncome - currentSSTaxable`; all modeled states exempt
 *   SS). In SS-exempting states with state income tax the overstated state
 *   tax inflated the estimated deficit → estimated LTCG → predicted MAGI,
 *   making the ACA-cliff search cut the Roth conversion harder than needed.
 */

import { describe, it, expect } from 'vitest';

import { solveRetirementYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import {
    ESPPAccount,
    InvestedAccount,
    SavedAccount,
    type ESPPLot,
} from '../../../components/Objects/Accounts/models';
import { SocialSecurityIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import {
    getTaxParameters,
    getTaxableSocialSecurityBenefits,
    calculateTotalFederalTax,
} from '../../../components/Objects/Taxes/TaxService';

const YEAR = 2025;

// =============================================================================
// Finding #2 — ESPP ordinary income must participate in convergence
// =============================================================================

describe('PR #59 #2 — ESPP ordinary income participates in the convergence check', () => {
    const SS_BENEFITS = 40_000;

    function buildInput(): YearSolverInput {
        // One disqualifying lot whose current price equals fmvAtPurchase:
        // every dollar of gross sale carries a ~50% ordinary bargain element
        // and ZERO capital gain. That keeps ltcgDelta at 0 on iteration 0
        // while the ESPP ordinary-income estimate jumps from 0 to ~$30k.
        const lot: ESPPLot = {
            id: 'lot-1',
            shares: 2000,
            purchasePrice: 50,
            purchaseDate: new Date(2025, 2, 1),  // < 1yr before mid-2025 sale → disqualifying
            grantDate: new Date(2024, 8, 1),
            fmvAtPurchase: 100,
            fmvAtGrant: 100,
            totalCost: 100_000,
            discountAmount: 50,
        };
        const espp = new ESPPAccount(
            'espp-1', 'Company ESPP', 200_000, [lot], null, undefined, 'ACME', 100,
        );
        const savings = new SavedAccount('savings-1', 'Savings', 5_000, 2.0);

        // Already-claimed SS: $40k/yr, started in 2024 (claimed early at 62).
        const ss = new SocialSecurityIncome(
            'ss-1', 'Social Security', SS_BENEFITS, 'Annually', 62, undefined,
            new Date(2024, 0, 1),
        );

        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            // Age 63 in 2025 (retired, pre-65): keeps the filer OUT of the #191
            // senior-deduction range so this test isolates its own finding — the
            // ESPP convergence bug is age-independent, and at 65+ the effective
            // standard deduction now (correctly) zeroes this scenario's federal
            // tax, which would blunt the "materially positive" oracle below.
            milestones: createBuiltinMilestones(1962, 60, 95),
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
            investments: {
                ...defaultAssumptions.investments,
            rothConversionStrategy: 'rate-match', // pin: rate-match under test (default flipped to dp-precomputed, #89)
                taxOptimizationEnabled: false,
                returnRates: { ror: 7 },
            },
            withdrawalStrategy: [],
        };

        const taxState: TaxState = {
            filingStatus: 'Single',
            stateResidency: 'Texas', // no state tax → isolates the federal SS-taxability effect
            deductionMethod: 'Standard',
            fedOverride: null,
            ficaOverride: null,
            stateOverride: null,
            year: YEAR,
        };

        return {
            year: YEAR,
            currentAge: 63,
            isRetired: true,
            incomes: [ss],
            expenses: [new OtherExpense('living-1', 'Living', 100_000, 'Annually', new Date(2020, 0, 1))],
            totalLivingExpenses: 100_000,
            rmdAmount: 0,
            accounts: [espp, savings],
            withdrawalOrder: [{ accountId: 'espp-1' }, { accountId: 'savings-1' }],
            taxState,
            assumptions,
            taxOptimizationEnabled: false,
            acaAware: false,
        };
    }

    it('final federal tax is self-consistent with the SS taxability implied by the final withdrawals', () => {
        const input = buildInput();
        const plan = solveRetirementYear(input);

        expect(plan.converged).toBe(true);

        // Sanity: the deficit was funded by an ESPP sale with a large bargain
        // element, no capital gains, and no Traditional draw — the exact shape
        // where only the ESPP estimate moves between iterations.
        const esppDraws = plan.withdrawals.filter(w => w.source === 'espp');
        expect(esppDraws.length).toBeGreaterThan(0);
        expect(plan.withdrawals.some(w => w.source.startsWith('traditional'))).toBe(false);

        const esppOrdinaryIncome = plan.withdrawals.reduce((sum, w) => sum + (w.ordinaryIncome ?? 0), 0);
        const realizedLTCG = plan.withdrawals.reduce(
            (sum, w) => sum + (w.capitalGains ? w.capitalGains.longTerm : 0), 0);
        expect(esppOrdinaryIncome).toBeGreaterThan(20_000);
        expect(realizedLTCG).toBeLessThan(1);

        // Self-consistency: recompute SS taxability from the FINAL plan's own
        // ordinary-income drivers (here: only the ESPP bargain element) and the
        // federal tax that follows from it. The reported federal tax must match.
        // Pre-fix the loop exited on iteration 0 (ltcgDelta = tradDelta = 0)
        // with SS taxable still based on a $0 ESPP estimate → federal tax $0.
        const fedParams = getTaxParameters(YEAR, 'Single', 'federal', undefined, input.assumptions)!;
        const ssTaxable = getTaxableSocialSecurityBenefits(
            SS_BENEFITS,
            esppOrdinaryIncome + realizedLTCG, // non-SS combined income: no base income, no conversion, no Trad draw
            0,
            'Single',
        );
        const expectedFederal = calculateTotalFederalTax(
            ssTaxable, // taxable SS pre-baked, SS=0 below (mirrors the solver's contract)
            0,
            0,
            realizedLTCG,
            0, // no pre-tax deductions (no work income)
            'Single',
            fedParams,
        ).ordinaryTax;

        // The combined income is high enough that taxable SS exceeds the
        // standard deduction — federal tax is materially positive.
        expect(expectedFederal).toBeGreaterThan(100);
        expect(Math.abs(plan.tax.federal - expectedFederal)).toBeLessThan(10);
    });
});

// =============================================================================
// Finding #3 — estimateMAGI state tax must exclude the SS-taxable portion
// =============================================================================

describe('PR #59 #3 — ACA-cliff estimateMAGI excludes SS from the state tax base', () => {
    function buildInput(): YearSolverInput {
        // MFJ in DC (state income tax, SS exempt). Pension keeps SS heavily
        // taxable at conversion=0, so the buggy state base embeds ~$16k of
        // taxable SS. Brokerage (95% gains) funds the deficit, so the state-tax
        // overstatement flows straight into estimated LTCG → predicted MAGI.
        const pension = new PassiveIncome(
            'pension-1', 'Pension', 36_000, 'Annually', 'No', 'Other', new Date(2020, 0, 1),
        );
        const ss = new SocialSecurityIncome(
            'ss-1', 'Social Security', 40_000, 'Annually', 62, undefined, new Date(2024, 0, 1),
        );

        const traditional = new InvestedAccount(
            'trad-1', 'Traditional IRA', 2_000_000, 0, 10, 0.05, 'Traditional IRA');
        const roth = new InvestedAccount(
            'roth-1', 'Roth IRA', 50_000, 0, 10, 0.05, 'Roth IRA');
        const brokerage = new InvestedAccount(
            'brokerage-1', 'Brokerage', 400_000, 0, 10, 0.05, 'Brokerage', true, 0.25, 20_000);
        const savings = new SavedAccount('savings-1', 'Savings', 5_000, 2.0);

        const assumptions: AssumptionsState = {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(1962, 60, 95), // age 63 in 2025, retired
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
            investments: {
                ...defaultAssumptions.investments,
            rothConversionStrategy: 'rate-match', // pin: rate-match under test (default flipped to dp-precomputed, #89)
                taxOptimizationEnabled: true,
                acaAware: true,
                returnRates: { ror: 7 },
            },
            withdrawalStrategy: [],
        };

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
            isRetired: true,
            incomes: [pension, ss],
            expenses: [new OtherExpense('living-1', 'Living', 82_300, 'Annually', new Date(2020, 0, 1))],
            totalLivingExpenses: 82_300,
            rmdAmount: 0,
            accounts: [traditional, roth, brokerage, savings],
            withdrawalOrder: [
                { accountId: 'brokerage-1' },
                { accountId: 'savings-1' },
                { accountId: 'roth-1' },
                { accountId: 'trad-1' },
            ],
            taxState,
            assumptions,
            taxOptimizationEnabled: true,
            acaAware: true,
        };
    }

    it('does not over-reduce the conversion via SS-inflated state tax', () => {
        const input = buildInput();
        const plan = solveRetirementYear(input);

        // Sanity: the ACA cliff is the binding constraint on this conversion
        // (bracket space at the 12% ceiling is ~$76k, far above the cliff room).
        const constraint = plan.taxOptimizationTarget?.constraintDetails;
        expect(plan.taxOptimizationTarget?.limitingFactor).toBe('ACA_CLIFF');
        expect(constraint?.acaCliffTriggered).toBe(true);

        // The MAGI the cliff search predicts for the conversion it settles on
        // must be UNDER the cliff. Pre-fix, the SS-taxable portion (~$16k at
        // conversion=0) was wrongly included in the DC state-tax base; the
        // overstated state tax inflated the estimated deficit → estimated LTCG
        // → predicted MAGI to ~$85.0k > the $84.6k cliff, even at $0 conversion.
        expect(constraint?.currentMAGI).toBeDefined();
        expect(constraint!.currentMAGI!).toBeLessThanOrEqual(constraint!.acaCliffThreshold!);

        // With state tax computed the way the solver actually levies it (SS
        // excluded), MAGI at $0 conversion is ~$84.2k — under the cliff — so the
        // search can fit a real conversion into the remaining headroom.
        // Pre-fix it returned $0 (conversion: null, all headroom forfeited).
        expect(plan.conversion).not.toBeNull();
        expect(plan.conversion!.amount).toBeGreaterThan(100);
    });
});
