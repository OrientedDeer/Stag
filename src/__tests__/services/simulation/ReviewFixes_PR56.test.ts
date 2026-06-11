/**
 * Review-fix regression tests for PR #56.
 *
 * Scope 3, finding #1: buildDPYearContexts double-subtracted the baseline RMD
 * amount from the plan-independent ordinary-income base. The stored
 * `SimulationYear.incomes` already EXCLUDES RMD-sourced PassiveIncome (the
 * engine filters it out of `returnedIncomes`), so `getGrossIncome(incomes)` is
 * already RMD-free. Subtracting `rmdDetails.totalRMD` on top of that removed RMD
 * a second time, wrongly zeroing out pension/wage/passive ordinary income in
 * post-RMD years whenever the RMD exceeded that ordinary income.
 *
 * The fix: nonSSOrdinaryIncomeExclRMD = max(0, grossIncome − ssBenefits).
 */
import { describe, it, expect } from 'vitest';
import { buildDPYearContexts } from '../../../services/simulation/RothConversionDP';
import { SimulationYear } from '../../../services/simulation/types';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { PassiveIncome } from '../../../components/Objects/Income/models';

// Born 1955 → RMD start age 73. In 2030 this person is 75 (well into RMD age).
const BIRTH_YEAR = 1955;
const RETIREMENT_YEAR = 2030;
const PENSION_AMOUNT = 40_000; // non-SS ordinary income (a pension, NOT RMD)
const RMD_AMOUNT = 60_000;     // RMD > pension, so the buggy subtraction floors to 0

function createAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        // Born 1955, retire at 65 (2020), end at 95.
        milestones: createBuiltinMilestones(BIRTH_YEAR, 65, 95),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
        },
    };
}

function createTaxState(): TaxState {
    return {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: RETIREMENT_YEAR,
    };
}

/**
 * Minimal baseline year mirroring reality: the stored `incomes` array contains
 * the user's $40k pension (a non-RMD PassiveIncome) but NOT the RMD income —
 * the engine strips RMD-sourced PassiveIncome from the returned year. The RMD
 * lives only in `rmdDetails.totalRMD`.
 */
function createPostRMDBaselineYear(): SimulationYear {
    // Pension: $40k/yr, started long ago so it's fully active in every test year.
    const pension = new PassiveIncome(
        'pension-1',
        'Pension',
        PENSION_AMOUNT,
        'Annually',
        'No',
        'Other',
        new Date('2000-01-01'),
    );

    return {
        year: RETIREMENT_YEAR,
        incomes: [pension], // NOTE: deliberately excludes RMD income (mirrors engine)
        expenses: [],
        accounts: [],
        cashflow: {
            totalIncome: PENSION_AMOUNT,
            totalExpense: 0,
            livingExpenses: 0,
            discretionary: 0,
            investedUser: 0,
            investedMatch: 0,
            totalInvested: 0,
            bucketAllocations: 0,
            bucketDetail: {},
            withdrawals: 0,
            withdrawalDetail: {},
        },
        taxDetails: {
            fed: 0,
            state: 0,
            fica: 0,
            preTax: 0,
            insurance: 0,
            postTax: 0,
            capitalGains: 0,
            withdrawalOrdinaryTax: 0,
            niit: 0,
            longTermCapitalGains: 0,
        },
        logs: [],
        rmdDetails: {
            totalRMD: RMD_AMOUNT,
            totalWithdrawn: RMD_AMOUNT,
            accountBreakdown: [],
            shortfall: 0,
            penalty: 0,
        },
    };
}

describe('PR #56 #1 — buildDPYearContexts does not double-subtract RMD', () => {
    it('uses the real non-SS ordinary income (pension) as the base, not 0', () => {
        const baseline = [createPostRMDBaselineYear()];

        const contexts = buildDPYearContexts(
            baseline,
            createAssumptions(),
            createTaxState(),
            RETIREMENT_YEAR,
            0, // startingBrokerageBalance
        );

        const ctx = contexts.find(c => c.year === RETIREMENT_YEAR);
        expect(ctx).toBeDefined();

        // The stored incomes hold only the $40k pension (RMD is excluded), so the
        // plan-independent ordinary-income base must equal that $40k — NOT 0,
        // which is what the double-subtraction produced (40k − 0 − 60k → floored).
        expect(ctx!.nonSSOrdinaryIncomeExclRMD).toBeCloseTo(PENSION_AMOUNT, 2);
    });
});
