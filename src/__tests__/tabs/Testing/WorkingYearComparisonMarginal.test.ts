/**
 * #184 regression: the Testing tab's working-year pre-tax-vs-Roth 401k comparison
 * priced today's federal marginal rate via getCombinedMarginalRate, which rates the
 * bracket against the RAW fedParams.standardDeduction. It was the last raw-deduction
 * consumer after c16621c/73d119f moved every other diagnostic surface onto
 * TaxService.getEffectiveDeduction (itemized/Auto #198, senior 65+ #191).
 *
 * A working-year ITEMIZER whose itemized total exceeds the standard deduction is
 * billed by the engine against that larger deduction, so a filer sitting just below
 * a bracket edge after itemizing was reported one bracket too high in this dev-surface
 * comparison. getWorkingYearComparisonMarginal rates the federal bracket off the
 * effective (itemized) deduction instead; the state bracket keeps the raw state
 * standard deduction exactly as getCombinedMarginalRate did.
 *
 * Parameters come from the repo's REAL TaxService data so the scenario stays valid
 * under inflation adjustment. The test cross-checks that the buggy raw-deduction
 * reading really lands in the wrong bracket (proving it would be red against the old
 * code) and asserts the corrected effective-deduction reading.
 */
import { describe, it, expect } from 'vitest';
import { getWorkingYearComparisonMarginal } from '../../../tabs/Testing/Testing';
import { type SimulationYear } from '../../../services/simulation/types';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { PassiveIncome } from '../../../components/Objects/Income/models';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';

function createTestAssumptions(birthYear: number): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, 65, 95),
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 7 },
        },
    };
}

function createTestTaxState(overrides: Partial<TaxState> = {}): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'FL',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2025,
        ...overrides,
    };
}

function createMockSimulationYear(
    year: number,
    incomes: SimulationYear['incomes'],
    itemizedDeductionTotal: number,
): SimulationYear {
    return {
        year,
        incomes,
        expenses: [],
        accounts: [],
        magi: undefined,
        itemizedDeductionTotal,
        cashflow: {
            totalIncome: 0,
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
            fed: 0, state: 0, fica: 0, preTax: 0, insurance: 0, postTax: 0,
            capitalGains: 0, withdrawalOrdinaryTax: 0, niit: 0,
        },
        logs: [],
    };
}

const jan1 = (y: number) => new Date(`${y}-01-01`);
const dec31 = (y: number) => new Date(`${y}-12-31`);

// Working-age filer (well under the 65 senior threshold), FL (no state tax) so the
// combined rate is the federal bracket alone. Born 1985 → age 45 in 2030.
const BIRTH_YEAR = 1985;
const AGE = 45;
const YEAR = BIRTH_YEAR + AGE; // 2030

describe('getWorkingYearComparisonMarginal — #184 rates the working-year federal bracket off the effective (itemized) deduction', () => {
    it('reports the 12% bracket for a working-year itemizer, not the raw-standard-deduction 22%', () => {
        const filingStatus = 'Single' as const;
        const assumptions = createTestAssumptions(BIRTH_YEAR);
        const taxState = createTestTaxState({ filingStatus, stateResidency: 'FL', deductionMethod: 'Itemized' });

        const fedParams = TaxService.getTaxParameters(YEAR, filingStatus, 'federal', undefined, assumptions);
        expect(fedParams).toBeTruthy();

        const rawStdDed = fedParams!.standardDeduction;
        // Itemized total exceeds the standard deduction by DELTA. A working-age filer
        // takes no senior add-on, so the effective (itemized) deduction is exactly the
        // itemized total.
        const DELTA = 12000;
        const itemizedTotal = rawStdDed + DELTA;
        const effDed = TaxService.getEffectiveDeduction(fedParams!, filingStatus, AGE, YEAR, 0, itemizedTotal, 'Itemized');
        expect(effDed).toBe(itemizedTotal);

        const boundary = fedParams!.brackets.find(b => b.rate === 0.22)!.threshold;

        // AFTER the effective (itemized) deduction, taxable income sits DELTA/2 BELOW
        // the 12/22 boundary (12%); after the RAW standard deduction it sits DELTA/2
        // ABOVE it (22%).
        const gross = Math.round(effDed + boundary - DELTA / 2);

        // Cross-check: the buggy raw-deduction reading really lands in the 22% bracket…
        const rawRate = TaxService.getMarginalTaxRate(Math.max(0, gross - rawStdDed), fedParams!).rate;
        expect(rawRate).toBe(0.22);
        // …and the corrected effective-deduction reading lands in 12%.
        const effRate = TaxService.getMarginalTaxRate(Math.max(0, gross - effDed), fedParams!).rate;
        expect(effRate).toBe(0.12);

        // Pure passive ordinary income = gross, no pre-tax deductions, no SS/state.
        const passive = new PassiveIncome('p1', 'Rental', gross, 'Annually', 'No', 'Other', jan1(YEAR), dec31(YEAR));
        const simYear = createMockSimulationYear(YEAR, [passive], itemizedTotal);

        const marginal = getWorkingYearComparisonMarginal(simYear, AGE, taxState, assumptions);

        // FL → no state component; the federal bracket is the corrected 12%, not 22%.
        expect(marginal.federal).toBe(0.12);
        expect(marginal.state).toBe(0);
        expect(marginal.combined).toBe(0.12);
    });

    it('is unchanged for a working-year filer on the standard deduction (effective == raw)', () => {
        const filingStatus = 'Single' as const;
        const assumptions = createTestAssumptions(BIRTH_YEAR);
        const taxState = createTestTaxState({ filingStatus, stateResidency: 'FL', deductionMethod: 'Standard' });

        const fedParams = TaxService.getTaxParameters(YEAR, filingStatus, 'federal', undefined, assumptions);
        const boundary = fedParams!.brackets.find(b => b.rate === 0.22)!.threshold;
        // Comfortably into the 22% bracket after the standard deduction.
        const gross = Math.round(fedParams!.standardDeduction + boundary + 20000);

        const passive = new PassiveIncome('p1', 'Rental', gross, 'Annually', 'No', 'Other', jan1(YEAR), dec31(YEAR));
        const simYear = createMockSimulationYear(YEAR, [passive], 0);

        const marginal = getWorkingYearComparisonMarginal(simYear, AGE, taxState, assumptions);
        expect(marginal.federal).toBe(0.22);
        expect(marginal.state).toBe(0);
    });
});
