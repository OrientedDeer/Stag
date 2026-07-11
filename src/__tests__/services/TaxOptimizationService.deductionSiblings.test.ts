/**
 * #184 regression tests for the two sibling diagnostics that priced the federal
 * bracket against the RAW fedParams.standardDeduction — the same bug c16621c fixed
 * in getOrdinaryMarginalRate / findSwitchoverYear, deliberately left red on these
 * paths for this follow-up:
 *
 *   1. getProjectedRMDMarginalRate's internal combinedMarginalAt — the RMD-era
 *      weighted marginal that the tax-adjusted-net-worth haircut consumes. RMD-era
 *      years are always senior-eligible (age >= 73), so rating the bracket against
 *      the raw standard deduction reported 22% where the engine bills 12%.
 *
 *   2. findRothConversionWindows — sizes the conversion room and reports the current
 *      marginal against the raw standard deduction, so a senior-age window that the
 *      engine actually bills at 12% read as 22% (== MIN_CONVERSION_TARGET_RATE), which
 *      SUPPRESSED the opportunity entirely (rate < target is false at the edge).
 *
 * Both must instead subtract TaxService.getEffectiveDeduction (senior 65+ add-ons
 * #191, itemized/Auto #198) — the SAME base the engine bills — mirroring
 * getOrdinaryMarginalRate. Parameters come from the repo's REAL TaxService data so
 * the scenarios stay valid under inflation adjustment. Each test cross-checks that
 * the buggy raw-deduction reading really lands in the wrong bracket (proving the test
 * would be red against the old code) and asserts the corrected reading.
 */
import { describe, it, expect } from 'vitest';
import {
    getProjectedRMDMarginalRate,
    findRothConversionWindows,
} from '../../services/TaxOptimizationService';
import { type SimulationYear } from '../../services/simulation/types';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import { PassiveIncome } from '../../components/Objects/Income/models';
import { InvestedAccount } from '../../components/Objects/Accounts/models';
import * as TaxService from '../../components/Objects/Taxes/TaxService';

// ---------------------------------------------------------------------------
// Fixtures (mirror TaxOptimizationService.marginalRate.test.ts)
// ---------------------------------------------------------------------------

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
    accounts: SimulationYear['accounts'] = [],
    totalIncome = 0,
): SimulationYear {
    return {
        year,
        incomes,
        expenses: [],
        accounts,
        magi: undefined,
        cashflow: {
            totalIncome,
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

// A Traditional 401k balance (taxType is the 7th ctor arg) so getProjectedRMDMarginalRate
// treats the year as an RMD-era weight; the ordinary income is supplied via PassiveIncome
// so the AGI is exact (no SS, no state) and isolates the federal bracket.
function tradAccount(balance: number): InvestedAccount {
    return new InvestedAccount('t1', 'Traditional 401k', balance, 0, 0, 0.1, 'Traditional 401k');
}

// Post-2028 senior year so the senior add-on is the flat, phaseout-free REGULAR 65+
// additional deduction (the OBBBA bonus applies only 2025–2028) — no MAGI-proxy coupling,
// so choosing the AGI relative to the effective deduction is not circular. Born 1955 →
// RMD start age 73 → RMD-era by 2028; age 78 in 2033.
const BIRTH_YEAR = 1955;
const AGE = 78;
const YEAR = BIRTH_YEAR + AGE; // 2033

/** Build the shared MFJ senior scenario: AGI straddles the 12/22 edge by the senior add-on. */
function seniorEdgeScenario() {
    const filingStatus = 'Married Filing Jointly' as const;
    const assumptions = createTestAssumptions(BIRTH_YEAR);
    const taxState = createTestTaxState({ filingStatus, stateResidency: 'FL' });

    const fedParams = TaxService.getTaxParameters(YEAR, filingStatus, 'federal', undefined, assumptions);
    expect(fedParams).toBeTruthy();

    const rawStdDed = fedParams!.standardDeduction;
    const effDed = TaxService.getEffectiveDeduction(fedParams!, filingStatus, AGE, YEAR, 0, 0, 'Standard');
    const seniorAddOn = effDed - rawStdDed;
    expect(seniorAddOn).toBeGreaterThan(1000);

    const boundary = fedParams!.brackets.find(b => b.rate === 0.22)!.threshold;

    // AFTER the effective deduction, taxable income sits half the add-on BELOW the
    // boundary (12%); after the RAW deduction it sits half the add-on ABOVE it (22%).
    const agi = Math.round(effDed + boundary - seniorAddOn / 2);

    // Cross-check: the buggy raw-deduction reading really lands in the 22% bracket.
    const rawRate = TaxService.getMarginalTaxRate(Math.max(0, agi - rawStdDed), fedParams!).rate;
    expect(rawRate).toBe(0.22);
    // ...and the corrected effective-deduction reading lands in 12%.
    const effRate = TaxService.getMarginalTaxRate(Math.max(0, agi - effDed), fedParams!).rate;
    expect(effRate).toBe(0.12);

    return { filingStatus, assumptions, taxState, agi };
}

describe('getProjectedRMDMarginalRate — #184 rates the RMD-era federal bracket off the senior effective deduction', () => {
    it('reports 12% (engine bracket) for a senior RMD-era year, not the raw-deduction 22%', () => {
        const { assumptions, taxState, agi } = seniorEdgeScenario();

        // Pure non-SS ordinary income = agi; a Traditional balance makes the year an
        // RMD-era weight. Single RMD-era year → the weighted rate IS this year's rate.
        const passive = new PassiveIncome('p1', 'Rental', agi, 'Annually', 'No', 'Other', jan1(YEAR), dec31(YEAR));
        const simYear = createMockSimulationYear(YEAR, [passive], [tradAccount(500000)]);

        const rate = getProjectedRMDMarginalRate([simYear], assumptions, taxState);
        // FL → no state component, so the combined rate is the federal bracket alone.
        expect(rate).toBe(0.12);
    });
});

describe('findRothConversionWindows — #184 sizes the window off the senior effective deduction', () => {
    it('emits a senior-age window at the engine 12% bracket that the raw-deduction 22% would suppress', () => {
        const { assumptions, taxState, agi } = seniorEdgeScenario();

        const passive = new PassiveIncome('p1', 'Rental', agi, 'Annually', 'No', 'Other', jan1(YEAR), dec31(YEAR));
        const simYear = createMockSimulationYear(YEAR, [passive], [], agi);

        const windows = findRothConversionWindows([simYear], assumptions, taxState);

        // With the raw deduction the marginal read 22% == MIN_CONVERSION_TARGET_RATE, so
        // `rate < target` was false and NO window was emitted. The effective deduction
        // reads the true 12% bracket → the window is emitted at 12%.
        expect(windows).toHaveLength(1);
        expect(windows[0].year).toBe(YEAR);
        expect(windows[0].marginalRate).toBe(0.12);
    });
});
