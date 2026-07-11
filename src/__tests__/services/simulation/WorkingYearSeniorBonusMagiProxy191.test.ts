/**
 * #191 — solveWorkingYear's OBBBA senior-bonus MAGI proxy must net pre-tax
 * deferrals in the taxable-Social-Security term, not just in the ordinary term.
 *
 * The working-year MAGI proxy (feeding getEffectiveDeduction, which sizes the
 * OBBBA 65+ senior bonus and phases it out above $150k MFJ / $75k Single MAGI)
 * built its two halves on INCONSISTENT bases:
 *
 *   ordinary term : max(0, nonSSordinary − preTaxDeductions)   ← netted
 *   taxable-SS term: getTaxableSocialSecurityBenefits(SS, nonSSordinary, …) ← NOT netted
 *
 * The engine's authoritative federal tax (calculateTotalFederalTax) and the
 * year-0 Taxes-tab orchestrator (federalTax.ts, via
 * getTaxableSocialSecurityFromComponents) BOTH net pre-tax deductions before the
 * SS-taxability formula. So for a deferral-heavy 65+ still-working filer whose
 * true MAGI sits just under the phaseout, the un-netted SS term overstated MAGI
 * by up to 85¢ per deferred dollar, pushed the proxy over the phaseout, and
 * trimmed the senior bonus — the projected year then billed MORE federal tax than
 * the year-0 orchestrator computes for the identical situation. That reopens the
 * year-0-vs-projection senior-deduction asymmetry #191 was shipped to close.
 *
 * The scenario: a 66-year-old still-working MFJ filer claiming SS, with ~$46k of
 * pre-tax payroll deferrals (401k + HSA + pre-tax insurance). True (correctly
 * netted) MAGI is ~$142k — under the $150k phaseout, so the FULL bonus applies —
 * but the un-netted proxy computes ~$168k, trimming the bonus.
 *
 * The test recomputes both the correct (netted) and buggy (un-netted) federal tax
 * independently from the fixture's own figures and asserts the solver bills the
 * correct one.
 */
import { describe, it, expect } from 'vitest';

import { solveWorkingYear, type YearSolverInput } from '../../../services/simulation/YearSolver';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';
import { getEffectiveDeduction } from '../../../components/Objects/Taxes/taxService/federalTax';

import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { WorkIncome, CurrentSocialSecurityIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2025;
const FILING: TaxState['filingStatus'] = 'Married Filing Jointly';

// A 66-year-old (retire milestone at 67, so still working) claiming SS.
const BIRTH_YEAR = YEAR - 66;

// Gross ordinary wages (enters the tax base gross; the deferrals below are the
// separate pre-tax deduction, mirroring the engine's own split).
const WAGES = 112_000;
// Combined household SS for a high-earning couple both claiming.
const SS = 120_000;
// Pre-tax deferrals: 401k (w/ catch-up) + HSA (family + 55+) + pre-tax premiums.
const PRETAX_401K = 30_500;
const HSA = 9_300;
const INSURANCE = 6_200; // pre-tax health/dental/vision premiums
// getPreTaxExemptions sums 401k + insurance + HSA → $46,000.

function assumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 67, 95),
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

function buildInput(): YearSolverInput {
    const wages = new WorkIncome(
        'inc-1', 'Salary', WAGES, 'Annually', 'Yes',
        PRETAX_401K,  // preTax401k
        INSURANCE,    // insurance (pre-tax)
        0,            // roth401k
        0,            // employerMatch
        '',           // matchAccountId
        null,         // taxType
        'FIXED',      // contributionGrowthStrategy
        new Date(YEAR - 5, 0, 1),
        new Date(YEAR + 4, 11, 31),
        HSA,          // hsaContribution
    );
    const ss = new CurrentSocialSecurityIncome(
        'ss-1', 'Social Security', SS, 'Annually', new Date(YEAR - 1, 0, 1),
    );

    // Income vastly exceeds expenses → no deficit, no withdrawals, no conversion.
    // taxableOrdinaryBase = wages + SS exactly, so the federal tax is a pure
    // function of (wages, SS, preTaxDeductions, effective deduction).
    const savings = new InvestedAccount('sav-1', 'Savings', 50_000, 0, 0, 0.0, 'Brokerage');

    const taxState: TaxState = {
        filingStatus: FILING,
        stateResidency: 'Texas', // no state tax — isolate the federal senior-bonus effect
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };

    return {
        year: YEAR,
        currentAge: 66,
        isRetired: false,
        incomes: [wages, ss],
        expenses: [new OtherExpense('living-1', 'Living', 60_000, 'Annually', new Date(YEAR - 5, 0, 1))],
        totalLivingExpenses: 60_000,
        rmdAmount: 0,
        accounts: [savings],
        withdrawalOrder: [{ accountId: 'sav-1' }],
        taxState,
        assumptions: assumptions(),
        taxOptimizationEnabled: false,
        acaAware: false,
    };
}

describe('solveWorkingYear: OBBBA senior-bonus MAGI proxy nets pre-tax deferrals (#191)', () => {
    it('bills the full senior bonus (netted MAGI under the phaseout), not the trimmed one', () => {
        const input = buildInput();
        const plan = solveWorkingYear(input);

        const raw = TaxService.getTaxParameters(YEAR, FILING, 'federal', undefined, input.assumptions);
        expect(raw).toBeDefined();

        // The solver's own pre-tax figure (401k + insurance + HSA), read with the
        // same useStoredValue=true convention solveWorkingYear uses.
        const preTax = TaxService.getPreTaxExemptions(input.incomes, YEAR, input.currentAge, true);
        expect(preTax).toBeCloseTo(PRETAX_401K + INSURANCE + HSA, 2); // 46,000

        const nonSSBase = WAGES; // taxableOrdinaryBase − SS, no withdrawals/reinvest

        // --- CORRECT proxy: taxable-SS term netted (year-0 orchestrator convention) ---
        const taxableSSCorrect = TaxService.getTaxableSocialSecurityFromComponents(
            nonSSBase, 0, 0, preTax, SS, FILING,
        );
        const correctMAGI = Math.max(0, nonSSBase - preTax + taxableSSCorrect);
        const effCorrect = getEffectiveDeduction(raw!, FILING, 66, YEAR, correctMAGI, 0, 'Standard');
        const taxCorrect = TaxService.calculateTotalFederalTax(
            nonSSBase, SS, 0, 0, preTax, FILING, { ...raw!, standardDeduction: effCorrect },
        ).totalTax;

        // --- BUGGY proxy: taxable-SS term on the UN-netted base ---
        const taxableSSBuggy = TaxService.getTaxableSocialSecurityBenefits(SS, nonSSBase, 0, FILING);
        const buggyMAGI = Math.max(0, nonSSBase - preTax) + taxableSSBuggy;
        const effBuggy = getEffectiveDeduction(raw!, FILING, 66, YEAR, buggyMAGI, 0, 'Standard');
        const taxBuggy = TaxService.calculateTotalFederalTax(
            nonSSBase, SS, 0, 0, preTax, FILING, { ...raw!, standardDeduction: effBuggy },
        ).totalTax;

        // Guards: the scenario actually straddles the phaseout the way the bug needs.
        expect(correctMAGI).toBeLessThan(150_000);   // true MAGI is under the MFJ phaseout
        expect(buggyMAGI).toBeGreaterThan(150_000);  // un-netted proxy crosses it
        expect(effCorrect).toBeGreaterThan(effBuggy); // the bug trims the senior bonus
        expect(taxBuggy - taxCorrect).toBeGreaterThan(50); // worth real dollars

        // The solver must bill the correctly-netted senior deduction — matching what
        // the year-0 orchestrator computes for the identical situation.
        expect(plan.tax.federal).toBeCloseTo(taxCorrect, 0);
        expect(plan.tax.federal).not.toBeCloseTo(taxBuggy, 0);
    });
});
