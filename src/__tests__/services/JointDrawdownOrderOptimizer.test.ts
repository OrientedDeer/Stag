/**
 * Joint conversion + drawdown-order optimizer: when Tax Optimization is on, the optimizer also
 * CHOOSES the withdrawal order (scoring candidate orders on the real engine), instead of blindly
 * running the user's stored order. The UI already promises this; the engine now delivers it.
 *
 * Unit tests pin the candidate-order generator (fast, deterministic). One integration test
 * confirms the optimizer wires through (sets chosenWithdrawalOrder + the feasibility floor still
 * holds). The precise dollar gain on a real high-SS scenario lives in a gitignored *.personal test.
 */
import { describe, it, expect } from 'vitest';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { generateCandidateWithdrawalOrders, WithdrawalOrderItem } from '../../services/simulation/EngineDirectConversionSearch';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';

const accts = (): AnyAccount[] => [
    new SavedAccount('cash', 'Cash', 50_000, 2),
    new InvestedAccount('brk', 'Brokerage', 400_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 300_000),
    new InvestedAccount('trad', 'Traditional 401k', 1_000_000, 0, 10, 0.05, 'Traditional 401k', true, 0.2, 1_000_000),
    new InvestedAccount('roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
];
const userOrder: WithdrawalOrderItem[] = [
    { id: 'w1', name: 'Cash', accountId: 'cash' },
    { id: 'w2', name: 'Brokerage', accountId: 'brk' },
    { id: 'w3', name: 'Traditional 401k', accountId: 'trad' },
    { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
];
const seq = (c: WithdrawalOrderItem[]) => c.map(x => x.accountId).join('>');

describe('generateCandidateWithdrawalOrders', () => {
    it('always includes the user order FIRST (no-regression guarantee)', () => {
        const cands = generateCandidateWithdrawalOrders(accts(), userOrder);
        expect(seq(cands[0])).toBe('cash>brk>trad>roth');
    });

    it('includes a Traditional-preserving order (Roth before Traditional)', () => {
        const cands = generateCandidateWithdrawalOrders(accts(), userOrder);
        const tradPreserving = cands.some(c => {
            const r = c.findIndex(x => x.accountId === 'roth');
            const t = c.findIndex(x => x.accountId === 'trad');
            return r >= 0 && t >= 0 && r < t;
        });
        expect(tradPreserving).toBe(true);
    });

    it('dedupes identical orderings', () => {
        const keys = generateCandidateWithdrawalOrders(accts(), userOrder).map(seq);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('classifies by tax bucket: cash first, then taxable/deferred/tax-free per the sequence', () => {
        const cands = generateCandidateWithdrawalOrders(accts(), userOrder);
        // The conventional candidate must be cash → brokerage → traditional → roth.
        expect(cands.map(seq)).toContain('cash>brk>trad>roth');
        // The Traditional-preserving candidate must be cash → brokerage → roth → traditional.
        expect(cands.map(seq)).toContain('cash>brk>roth>trad');
    });

    it('preserves all item fields when reordering (not just accountId)', () => {
        const cands = generateCandidateWithdrawalOrders(accts(), userOrder);
        for (const c of cands) {
            expect(c).toHaveLength(userOrder.length);
            for (const item of c) expect(item.name).toBeTruthy();
        }
    });
});

describe('joint optimizer wires through runSimulationWithOptimization', { timeout: 240_000 }, () => {
    // High-SS, large-Traditional, long-horizon — the regime where the withdrawal order matters
    // (Traditional-preserving frees the post-SS 0% conversion band).
    const NOW = new Date().getFullYear();
    const BY = NOW - 60, RA = 60, LE = 90;
    const assumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BY, RA, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 2.5, inflationAdjusted: true },
        investments: {
            ...defaultAssumptions.investments, returnRates: { ror: 7 },
            taxOptimizationEnabled: true, autoRothConversions: true, rothConversionStrategy: 'dp-precomputed',
        },
        withdrawalStrategy: [
            { id: 'w1', name: 'Cash', accountId: 'cash' },
            { id: 'w2', name: 'Brokerage', accountId: 'brk' },
            { id: 'w3', name: 'Traditional 401k', accountId: 'trad' },
            { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
        ],
    };
    const taxState: TaxState = { filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW };
    const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 4_000, NOW)];
    const expenses = () => [new FoodExpense('exp', 'Living', 70_000, 'Annually', new Date(`${NOW}-01-01`))];

    it('sets chosenWithdrawalOrder and never scores below the std-ded baseline (floor holds)', () => {
        const res = runSimulationWithOptimization(LE - (NOW - BY), accts(), incomes(), expenses(), assumptions, taxState);
        const y0 = res[0];
        expect(y0.chosenWithdrawalOrder).toBeDefined();
        expect(y0.chosenWithdrawalOrder!.length).toBe(4);
        // The joint optimizer's result must be >= the trivial std-ded baseline (no regression).
        expect(y0.strategyTerminalAfterTaxNW!).toBeGreaterThanOrEqual(y0.stdDedBaselineTerminalAfterTaxNW! - 1);
    });

    it('does NOT change the order when Tax Optimization is OFF (uses the manual order)', () => {
        const offAssumptions: AssumptionsState = { ...assumptions, investments: { ...assumptions.investments, taxOptimizationEnabled: false } };
        const res = runSimulationWithOptimization(LE - (NOW - BY), accts(), incomes(), expenses(), offAssumptions, taxState);
        // Tax-opt off → no order optimization (chosenWithdrawalOrder not set).
        expect(res[0].chosenWithdrawalOrder).toBeUndefined();
    });
});
