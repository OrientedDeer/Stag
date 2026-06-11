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
import { processInflows, growAccounts } from '../../../services/simulation/AccountGrowth';
import { SimulationYear, WithdrawalState } from '../../../services/simulation/types';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { PassiveIncome, WorkIncome } from '../../../components/Objects/Income/models';
import { ESPPAccount } from '../../../components/Objects/Accounts/models';

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

// ---------------------------------------------------------------------------
// Shared helpers for the AccountGrowth (processInflows / growAccounts) tests.
// ---------------------------------------------------------------------------
function createWithdrawalState(overrides: Partial<WithdrawalState> = {}): WithdrawalState {
    return {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        withdrawalOrdinaryTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome: 0,
        traditionalWithdrawals: 0,
        longTermCapitalGains: 0,
        shortTermCapitalGains: 0,
        stateCapitalGainsTax: 0,
        ...overrides,
    };
}

function createGrowthAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 0 },
        },
    };
}

// ---------------------------------------------------------------------------
// PR #56 #3 — ESPP purchase must not mask a same-year sale in growAccounts.
//
// SimulationEngine records an ESPP SALE as a NEGATIVE userInflows entry, while
// processInflows previously added a POSITIVE userInflows entry for a same-year
// PURCHASE. growAccounts reads the NET userInflows as its sale signal, so when
// purchase >= sale the net was non-negative and the sale was silently dropped —
// the ESPP balance/shares never decreased.
// ---------------------------------------------------------------------------
describe('PR #56 #3 — same-year ESPP purchase does not mask a sale in growAccounts', () => {
    it('still removes sold shares when a larger purchase happens the same year', () => {
        const esppId = 'espp1';
        // Pre-existing ESPP holding: 100 shares @ $100 FMV = $10,000 balance.
        const existingLot = {
            id: 'existing-lot',
            grantDate: new Date(Date.UTC(2020, 0, 1)),
            purchaseDate: new Date(Date.UTC(2020, 5, 28)),
            fmvAtGrant: 100,
            fmvAtPurchase: 100,
            purchasePrice: 85,
            shares: 100,
            totalCost: 8500,
            discountAmount: 15,
        };
        const esppAccount = new ESPPAccount('espp1', 'Company ESPP', 10000, [existingLot]);

        // WorkIncome configured to buy ESPP this year (FIXED $/period contribution).
        const income = new WorkIncome(
            'job1', 'Test Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '',
            null, 'FIXED',
            new Date('2020-01-01'), undefined,
            0,
            'custom',
            'FIXED',          // esppContributionType
            8000,             // esppContributionAmount ($/period -> annual since Annually)
            15,               // esppDiscountPercent
            false,            // esppHasLookback
            6,                // esppOfferingPeriodMonths
            esppId,           // esppAccountId
            7,                // esppExpectedStockGrowth
        );

        const withdrawalState = createWithdrawalState();
        // Pre-seed a SALE of $5,000 (negative), SMALLER than the purchase about to
        // be recorded — this is what SimulationEngine writes for an ESPP withdrawal.
        withdrawalState.userInflows[esppId] = -5000;

        const assumptions = createGrowthAssumptions();
        const logs: string[] = [];

        // Drive the REAL purchase path: this adds a POSITIVE purchase to userInflows.
        const inflowResult = processInflows(
            [income], [esppAccount], assumptions, 2025, withdrawalState,
            0, undefined, 0, 40, logs
        );

        const result = growAccounts(
            [esppAccount], [], withdrawalState,
            {}, inflowResult.esppLots, 0, undefined,
            assumptions, 2025, 0, logs
        );

        const updated = result.find(a => a.id === esppId) as ESPPAccount;

        // The pre-existing lot started with 100 shares. A $5,000 sale at $100/share
        // FMV must remove 50 shares from it, regardless of the same-year purchase.
        const existingLotAfter = updated.lots.find(l => l.id === 'existing-lot');
        expect(existingLotAfter).toBeDefined();
        expect(existingLotAfter!.shares).toBeCloseTo(50, 4);
    });
});
