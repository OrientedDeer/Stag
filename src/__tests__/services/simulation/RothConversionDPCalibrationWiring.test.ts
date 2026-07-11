/**
 * Isolating test for BUG #4: the DP-precomputed path must hand
 * buildDPYearContexts the CALIBRATED future-year assumptions (the same ones the
 * final sim executes against), not the raw year-0 assumptions.
 *
 * An end-to-end conversion-total comparison can't isolate this — the final sim
 * applies calibration to executed years regardless, which perturbs balances and
 * therefore the std-ded baseline timeline that feeds the DP contexts, so the
 * plan diverges even with the bug present. Instead we spy on the assumptions
 * object actually passed into buildDPYearContexts:
 *   - Before the fix: runSimulationWithOptimization passed raw `assumptions`,
 *     so `assumptions.macro.taxCalibration` is undefined.
 *   - After the fix: it passes `deriveFutureAssumptions(...)`, so when
 *     calibrateFutureYears is on with a positive override, taxCalibration.fed > 1.
 *
 * The mock delegates to the real implementation so the simulation still runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type AssumptionsState } from '../../../components/Objects/Assumptions/AssumptionsContext';
import type * as RothConversionDPModule from '../../../services/simulation/RothConversionDP';
import { type TaxState as TaxStateT } from '../../../components/Objects/Taxes/TaxContext';

// Capture the assumptions handed to buildDPYearContexts on each call.
const capturedAssumptions: AssumptionsState[] = [];

vi.mock('../../../services/simulation/RothConversionDP', async (importOriginal) => {
    const actual = await importOriginal<typeof RothConversionDPModule>();
    return {
        ...actual,
        buildDPYearContexts: (
            ...args: Parameters<typeof actual.buildDPYearContexts>
        ) => {
            capturedAssumptions.push(args[1]); // 2nd arg is `assumptions`
            return actual.buildDPYearContexts(...args);
        },
    };
});

// Imports below must come AFTER vi.mock so the consumer picks up the mock.
const { defaultAssumptions, createBuiltinMilestones } =
    await import('../../../components/Objects/Assumptions/AssumptionsContext');
const { runSimulationWithOptimization } =
    await import('../../../components/Objects/Assumptions/useSimulation');
const { InvestedAccount, SavedAccount } =
    await import('../../../components/Objects/Accounts/models');
const { WorkIncome, FutureSocialSecurityIncome } =
    await import('../../../components/Objects/Income/models');
const { FoodExpense } = await import('../../../components/Objects/Expense/models');

const birthYear = 1985;
const retirementAge = 45;
const lifeExpectancy = 95;
const yearsToSimulate = 55;

const baseAssumptions = (): AssumptionsState => ({
    ...defaultAssumptions,
    demographics: {},
    milestones: createBuiltinMilestones(birthYear, retirementAge, lifeExpectancy),
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: {
        ...defaultAssumptions.macro,
        inflationRate: 2.5,
        inflationAdjusted: true,
        taxBracketShiftPct: 0,
        taxBracketShiftStartYear: 0,
    },
    investments: {
        ...defaultAssumptions.investments,
        returnRates: { ror: 6 },
        taxOptimizationEnabled: true,
        autoRothConversions: true,
        rothConversionStrategy: 'dp-precomputed',
    },
    withdrawalStrategy: [
        { id: 'ws-savings', name: 'Savings', accountId: 'acc-savings' },
        { id: 'ws-brokerage', name: 'Brokerage', accountId: 'acc-brokerage' },
        { id: 'ws-roth', name: 'Roth IRA', accountId: 'acc-roth' },
        { id: 'ws-trad', name: 'Traditional IRA', accountId: 'acc-traditional' },
    ],
});

const accounts = () => [
    new InvestedAccount('acc-traditional', 'Traditional IRA', 1_500_000, 0, 10, 0.05, 'Traditional IRA', true, 0.2, 1_500_000),
    new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
    new InvestedAccount('acc-brokerage', 'Brokerage', 800_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 600_000),
    new SavedAccount('acc-savings', 'Savings', 100_000, 4),
];
const incomes = () => [
    new WorkIncome('inc', 'Salary', 90_000, 'Annually', 'Yes', 0, 0, 0, 0, '', null, 'FIXED',
        new Date(2025 - 5, 0, 1), new Date(birthYear + retirementAge - 1, 11, 31)),
    new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 0, 0),
];
const expenses = () => [
    new FoodExpense('exp-living', 'Living Expenses', 50_000, 'Annually', new Date('2025-01-01')),
];

describe('DP path wires calibration into context building (#4)', { timeout: 120_000 }, () => {
    beforeEach(() => {
        capturedAssumptions.length = 0;
    });

    it('passes CALIBRATED assumptions to buildDPYearContexts when calibrateFutureYears is on', () => {
        const a = baseAssumptions();
        const taxState: TaxStateT = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: 60_000, // > computed fed on $90k wage → factor > 1
            ficaOverride: null, stateOverride: null, year: 2025,
            calibrateFutureYears: true,
        };

        runSimulationWithOptimization(
            yearsToSimulate, accounts(), incomes(), expenses(), a, taxState,
            undefined, new Date('2025-06-15'),
        );

        // buildDPYearContexts must have been called by the DP path.
        expect(capturedAssumptions.length).toBeGreaterThan(0);
        const passed = capturedAssumptions[0];
        // The bug: the DP got the raw assumptions (no taxCalibration). The fix
        // hands it deriveFutureAssumptions(...) which carries the factor.
        expect(passed.macro.taxCalibration).toBeDefined();
        expect(passed.macro.taxCalibration!.fed).toBeGreaterThan(1);
    });

    it('does not inject a calibration factor when calibrateFutureYears is off', () => {
        const a = baseAssumptions();
        const taxState: TaxStateT = {
            filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard',
            fedOverride: 60_000, ficaOverride: null, stateOverride: null, year: 2025,
            // calibrateFutureYears omitted (off)
        };

        runSimulationWithOptimization(
            yearsToSimulate, accounts(), incomes(), expenses(), a, taxState,
            undefined, new Date('2025-06-15'),
        );

        expect(capturedAssumptions.length).toBeGreaterThan(0);
        // Off → no calibration factor injected; DP and final sim agree on current law.
        expect(capturedAssumptions[0].macro.taxCalibration).toBeUndefined();
    });
});
