/**
 * Joint conversion + drawdown-order optimizer: when Tax Optimization is on, the optimizer also
 * CHOOSES the withdrawal order (scoring candidate orders on the real engine), instead of blindly
 * running the user's stored order. The UI already promises this; the engine now delivers it.
 *
 * Unit tests pin the candidate-order generator (fast, deterministic). One integration test
 * confirms the optimizer wires through (sets chosenWithdrawalOrder + the feasibility floor still
 * holds). A PAYOFF test pins the economic value on a synthetic order-sensitive scenario (so the
 * committed suite guards the gain, not just the wiring — the real high-SS dollar figure lives in a
 * gitignored *.personal test).
 */
import { describe, it, expect } from 'vitest';
import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { generateCandidateWithdrawalOrders, WithdrawalOrderItem } from '../../services/simulation/EngineDirectConversionSearch';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { FutureSocialSecurityIncome, CurrentSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulation, runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';
import { buildTradValuation, terminalAfterTaxNetWorth } from '../../tabs/Future/tabs/FutureUtils';

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

// ===========================================================================
// PAYOFF (not just wiring): on an order-sensitive scenario the optimizer switches to a
// Traditional-preserving order AND that order adds material after-tax wealth. A regression that
// silently kept the user's order would still pass the wiring tests above — but fails these.
// ===========================================================================
describe('joint optimizer payoff — material order gain on an order-sensitive scenario', { timeout: 240_000 }, () => {
    // MFJ, large Traditional, strong SS, modest liquid buffer, high living, long horizon. Under the
    // conventional (trad-first) order the Traditional is SPENT for living at torpedo-stacked rates;
    // Traditional-preserving (Roth before Traditional) instead converts it cheaply in the gap years
    // and funds living from Roth — so the order is worth real money here. SS via CurrentSocialSecurity
    // so it actually delivers ($60k+); a hand-set Future* PIA would be recomputed from empty earnings
    // to ~$0 (see harness.ts makeSSHeavyScenario).
    const NOW = new Date().getFullYear();
    const RETIRE = 58, LE = 92, BY = NOW - RETIRE, YEARS = LE - RETIRE;
    const osAccts = (): AnyAccount[] => [
        new InvestedAccount('acc-trad', 'Traditional 401k', 2_500_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 2_500_000),
        new InvestedAccount('acc-brk', 'Brokerage', 200_000, 0, 10, 0, 'Brokerage', false, 1.0, 100_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0, 'Roth IRA', false, 1.0, 100_000),
        new SavedAccount('acc-cash', 'Cash', 50_000, 0),
    ];
    // Stored order is CONVENTIONAL (trad-first) — the optimizer must actively switch away from it.
    const tradFirst: WithdrawalOrderItem[] = [
        { id: 'ws-cash', name: 'Cash', accountId: 'acc-cash' },
        { id: 'ws-brk', name: 'Brokerage', accountId: 'acc-brk' },
        { id: 'ws-trad', name: 'Traditional', accountId: 'acc-trad' },
        { id: 'ws-roth', name: 'Roth', accountId: 'acc-roth' },
    ];
    const tradPreserving: WithdrawalOrderItem[] = [tradFirst[0], tradFirst[1], tradFirst[3], tradFirst[2]];
    const osAssumptions: AssumptionsState = {
        ...defaultAssumptions,
        demographics: {},
        milestones: createBuiltinMilestones(BY, RETIRE, LE),
        income: { ...defaultAssumptions.income, salaryGrowth: 0 },
        macro: { ...defaultAssumptions.macro, inflationRate: 0, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments, returnRates: { ror: 6 }, withdrawalRate: 4.0,
            autoRothConversions: false, taxOptimizationEnabled: true,
            rothConversionStrategy: 'dp-precomputed', rothConversionUserSituation: 'self-liquidate',
        },
        withdrawalStrategy: tradFirst,
    };
    const osTaxState: TaxState = { filingStatus: 'Married Filing Jointly', stateResidency: 'Texas', deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW };
    const osIncomes = () => [new CurrentSocialSecurityIncome('inc-ss', 'Social Security', 6_666, 'Monthly', new Date(BY + 67, 0, 1))]; // ~$80k/yr from 67
    const osExpenses = () => [new FoodExpense('exp-living', 'Living', 160_000, 'Annually', new Date(`${NOW}-01-01`))];
    const idx = (order: { accountId: string }[], id: string) => order.findIndex(o => o.accountId === id);

    it('switches to a Traditional-preserving order whose co-optimized gain is material', () => {
        const res = runSimulationWithOptimization(YEARS, osAccts(), osIncomes(), osExpenses(), osAssumptions, osTaxState);
        const chosen = res[0].chosenWithdrawalOrder!;
        expect(chosen).toBeDefined();
        // Picked Traditional-preserving (Roth drawn before Traditional), switching from the trad-first stored order.
        expect(idx(chosen, 'acc-roth')).toBeLessThan(idx(chosen, 'acc-trad'));
        // PAYOFF: the chosen order beats the user's stored order by a material margin at FULL
        // co-optimization (each order scored with its own optimal conversion plan). Threshold is
        // conservative (measured ~$62k / ~1.3%); a regression that kept the user order → ~$0 → fails.
        expect(res[0].orderOptimizationGain!).toBeGreaterThan(20_000);
    });

    it('a std-ded conversion proxy MIS-RANKS the order (why a full per-order search is required)', () => {
        // Under std-ded-only conversions the Traditional-preserving order looks WORSE — its value only
        // appears once conversions are aggressive enough to refill Roth via the post-SS 0% band. So a
        // cheap proxy would mis-pick the order; this pins the design decision (full search per order).
        const runStd = (order: WithdrawalOrderItem[]) => runSimulation(
            YEARS, osAccts(), osIncomes(), osExpenses(),
            { ...osAssumptions, investments: { ...osAssumptions.investments, rothConversionStrategy: 'rate-match' }, withdrawalStrategy: order },
            osTaxState, undefined, { conversionMode: 'std-ded-only' },
        );
        // ONE shared situation ruler (built from the conventional baseline), applied to both orders.
        const ruler = buildTradValuation(runStd(tradFirst), osAssumptions, osTaxState);
        const proxyGain = terminalAfterTaxNetWorth(runStd(tradPreserving), ruler) - terminalAfterTaxNetWorth(runStd(tradFirst), ruler);
        expect(proxyGain).toBeLessThan(0);
    });
});
