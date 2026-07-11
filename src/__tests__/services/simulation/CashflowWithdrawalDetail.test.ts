import { describe, it, expect } from 'vitest';
import { type AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import { FoodExpense } from '../../../components/Objects/Expense/models';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';

// #205 (b): CashflowDetail.withdrawals is populated straight from the engine's
// PlannedWithdrawal loop (executeYearPlan) — asserted from a REAL simulated year,
// not a fabricated fixture.

const baseAssumptions: AssumptionsState = {
    ...defaultAssumptions,
    demographics: {},
    income: { ...defaultAssumptions.income, salaryGrowth: 0 },
    macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
    investments: { ...defaultAssumptions.investments, returnRates: { ror: 0 } },
};

const taxState: TaxState = {
    filingStatus: 'Single', stateResidency: 'DC', deductionMethod: 'Standard',
    fedOverride: null, ficaOverride: null, stateOverride: null, year: 2024,
};

describe('CashflowDetail.withdrawals (#205b)', () => {
    it('records a spending-deficit withdrawal with gross/tax/penalty/net/reason', () => {
        // Age 29, no income, one expense → the engine covers the deficit by drawing
        // from the Traditional IRA. reason === 'Spending deficit'.
        const tradIRA = new InvestedAccount('ira-1', 'Traditional IRA', 100000, 0, 5, 0.0, 'Traditional IRA', true, 0.2);
        const expense = new FoodExpense('exp-1', 'Living', 5000, 'Annually', new Date('2024-01-01'));

        const assumptions: AssumptionsState = {
            ...baseAssumptions,
            milestones: createBuiltinMilestones(1995, 67, 90), // age 29 in 2024
            withdrawalStrategy: [{ id: 'w1', name: 'IRA', accountId: 'ira-1' }],
        };

        const yr = simulateOneYear(2024, [], [expense], [tradIRA], assumptions, taxState);

        const withdrawals = yr.cashflowDetail?.withdrawals;
        expect(withdrawals).toBeDefined();
        const deficit = withdrawals!.find(w => w.reason === 'Spending deficit');
        expect(deficit).toBeDefined();
        expect(deficit!.accountId).toBe('ira-1');
        expect(deficit!.accountName).toBe('Traditional IRA');
        expect(deficit!.gross).toBeGreaterThan(0);
        expect(deficit!.net).toBeGreaterThan(0);
        // Under-59½ Traditional draw carries the 10% early-withdrawal penalty.
        expect(deficit!.penalty).toBeGreaterThan(0);
        // net = gross − tax − penalty (identity the engine emits per withdrawal).
        expect(deficit!.net).toBeCloseTo(deficit!.gross - deficit!.tax - deficit!.penalty, 2);
    });

    it('records an RMD withdrawal (distinct reason) at RMD age alongside a spending draw', () => {
        // Age 74 (born 1950), retired, large Traditional balance → a Required Minimum
        // Distribution is forced; a big expense also forces a spending-deficit draw, so
        // TWO distinct reasons appear in the provenance array.
        const tradIRA = new InvestedAccount('ira-1', 'Traditional IRA', 800000, 0, 5, 0.0, 'Traditional IRA', true, 0.2);
        const expense = new FoodExpense('exp-1', 'Living', 90000, 'Annually', new Date('2024-01-01'));

        const assumptions: AssumptionsState = {
            ...baseAssumptions,
            milestones: createBuiltinMilestones(1950, 67, 95), // age 74 in 2024, retired
            withdrawalStrategy: [{ id: 'w1', name: 'IRA', accountId: 'ira-1' }],
        };

        const yr = simulateOneYear(2024, [], [expense], [tradIRA], assumptions, taxState);

        const withdrawals = yr.cashflowDetail?.withdrawals;
        expect(withdrawals).toBeDefined();

        const rmd = withdrawals!.find(w => w.reason === 'Required Minimum Distribution');
        expect(rmd, `reasons seen: ${withdrawals!.map(w => w.reason).join(', ')}`).toBeDefined();
        expect(rmd!.accountId).toBe('ira-1');
        expect(rmd!.gross).toBeGreaterThan(0);

        const reasons = new Set(withdrawals!.map(w => w.reason));
        expect(reasons.size).toBeGreaterThanOrEqual(2);
        expect(reasons.has('Spending deficit')).toBe(true);
    });
});
