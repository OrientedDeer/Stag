/**
 * #184 regression tests for the shared diagnostic helper getOrdinaryMarginalRate.
 *
 * BUG 1 (federal): the helper must rate the federal bracket against the SAME
 * effective deduction the engine bills — the senior 65+ add-ons (#191) and the
 * itemized/Auto total (#198) that every ENGINE tax chokepoint routes through
 * TaxService.getEffectiveDeduction — NOT the raw fedParams.standardDeduction. The
 * RMD-years these diagnostics price are always senior-eligible (age >= 73), so the
 * raw-deduction path reported 22% where the engine actually bills 12%.
 *
 * BUG 2 (state): the helper must EXCLUDE taxable Social Security from the state base,
 * mirroring the engine's state path (YearSolver) and the DP aligned to it
 * (commit 6c19b83 — "the engine never bills state tax on SS"). Rating the state
 * marginal on the SS-inclusive AGI charges a retiree just below a state bracket edge
 * one bracket higher than the simulation ever bills.
 *
 * Parameters come from the repo's REAL TaxService data (getTaxParameters +
 * getEffectiveDeduction), so the scenarios stay valid under inflation adjustment.
 */
import { describe, it, expect } from 'vitest';
import { getOrdinaryMarginalRate } from '../../services/TaxOptimizationService';
import { type SimulationYear } from '../../services/simulation/types';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../components/Objects/Taxes/TaxContext';
import {
    CurrentSocialSecurityIncome,
    PassiveIncome,
} from '../../components/Objects/Income/models';
import * as TaxService from '../../components/Objects/Taxes/TaxService';

// ---------------------------------------------------------------------------
// Fixture builders (mirrors the ones in TaxOptimizationService.test.ts)
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
    rmdWithdrawn?: number,
): SimulationYear {
    return {
        year,
        incomes,
        expenses: [],
        accounts: [],
        magi: undefined,
        rmdDetails: rmdWithdrawn !== undefined
            ? { totalRMD: rmdWithdrawn, totalWithdrawn: rmdWithdrawn, accountBreakdown: [], shortfall: 0, penalty: 0 }
            : undefined,
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

describe('getOrdinaryMarginalRate — #184 Bug 1 (federal senior effective deduction)', () => {
    it('rates the RMD-year federal bracket against the senior effective deduction, not the raw standard deduction', () => {
        const filingStatus = 'Married Filing Jointly' as const;
        // Post-OBBBA-window (2025–2028) year so the senior add-on is the flat,
        // phaseout-free REGULAR 65+ additional deduction — no MAGI-proxy coupling.
        const age = 73;
        const birthYear = 1960;
        const year = birthYear + age; // 2033
        const assumptions = createTestAssumptions(birthYear);
        // FL: no state income tax, so this isolates the federal bracket.
        const taxState = createTestTaxState({ filingStatus, stateResidency: 'FL' });

        const fedParams = TaxService.getTaxParameters(year, filingStatus, 'federal', undefined, assumptions);
        expect(fedParams).toBeTruthy();

        // The senior add-on the engine folds into the deduction (itemized=0, Standard).
        const rawStdDed = fedParams!.standardDeduction;
        const effDed = TaxService.getEffectiveDeduction(fedParams!, filingStatus, age, year, 0, 0, 'Standard');
        const seniorAddOn = effDed - rawStdDed;
        // Sanity: a 73-year-old MFJ couple must get a positive senior add-on.
        expect(seniorAddOn).toBeGreaterThan(1000);

        // 12% -> 22% bracket boundary (in taxable-income space).
        const boundary = fedParams!.brackets.find(b => b.rate === 0.22)!.threshold;

        // Choose ordinary AGI so that AFTER the effective deduction taxable income sits
        // half the add-on BELOW the boundary (12%), but after the RAW deduction it sits
        // half the add-on ABOVE it (22%). Only the deduction choice flips the bracket.
        const agi = Math.round(effDed + boundary - seniorAddOn / 2);

        // Pure RMD income => getOrdinaryAGI === agi (no SS, no other income).
        const simYear = createMockSimulationYear(year, [], agi);

        // Cross-check the buggy raw-deduction reading really lands in 22%.
        const rawRate = TaxService.getMarginalTaxRate(Math.max(0, agi - rawStdDed), fedParams!).rate;
        expect(rawRate).toBe(0.22);

        const result = getOrdinaryMarginalRate(simYear, age, taxState, assumptions);
        expect(result.federal).toBe(0.12);
    });
});

describe('getOrdinaryMarginalRate — #184 Bug 2 (state base excludes taxable SS)', () => {
    it('rates the state bracket on non-SS ordinary income, matching the engine which never taxes SS', () => {
        const filingStatus = 'Single' as const;
        const age = 73;
        const birthYear = 1960;
        const year = birthYear + age; // 2033
        const assumptions = createTestAssumptions(birthYear);
        const taxState = createTestTaxState({ filingStatus, stateResidency: 'Virginia' });

        const stateParams = TaxService.getTaxParameters(year, filingStatus, 'state', 'Virginia', assumptions);
        expect(stateParams).toBeTruthy();
        const stateStdDed = stateParams!.standardDeduction;

        // Top VA bracket boundary (5% -> 5.75%).
        const boundary = stateParams!.brackets.find(b => b.rate === 0.0575)!.threshold;

        // Non-SS ordinary income placed so state taxable income (nonSS - stateStdDed)
        // sits comfortably BELOW the boundary → 5% bracket.
        const nonSSBase = Math.round(boundary + stateStdDed - 1500);

        // A large SS benefit whose taxable portion, if wrongly folded into the state
        // base, would push it OVER the boundary into the 5.75% bracket.
        const ssBenefit = 30000;
        const passive = new PassiveIncome('p1', 'Rental', nonSSBase, 'Annually', 'No', 'Other', jan1(year), dec31(year));
        const ss = new CurrentSocialSecurityIncome('ss1', 'Social Security', ssBenefit, 'Annually', jan1(year), dec31(year));
        const simYear = createMockSimulationYear(year, [passive, ss]);

        // Confirm the SS-inclusive (buggy) base really crosses into 5.75%.
        const taxableSS = TaxService.getTaxableSocialSecurityBenefits(ssBenefit, nonSSBase, 0, filingStatus);
        expect(taxableSS).toBeGreaterThan(1500);
        const buggyStateRate = TaxService.getMarginalTaxRate(
            Math.max(0, nonSSBase + taxableSS - stateStdDed), stateParams!,
        ).rate;
        expect(buggyStateRate).toBe(0.0575);

        const result = getOrdinaryMarginalRate(simYear, age, taxState, assumptions);
        expect(result.state).toBe(0.05);
    });
});
