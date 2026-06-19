/**
 * Under Tax Optimization the algorithm OWNS the withdrawal order, so the user's manual order AND any
 * account EXCLUSIONS must NOT bind (the UI already disables the manual editor under tax-opt). An account
 * the user left OUT of the withdrawal order must still be a first-class participant the optimizer places
 * and scores — not merely tapped by the #111 last-resort fallback.
 *
 * These tests pin `withAllSellableAccounts` (the augmentation the tax-opt joint optimizer applies before
 * generating candidate orders) and prove an order-EXCLUDED sellable account DOES appear in the candidate
 * orders fed to the engine search. Property/Debt/DeficitDebt are never folded in (they aren't sellable).
 */
import { describe, it, expect } from 'vitest';
import {
    AnyAccount, InvestedAccount, SavedAccount, PropertyAccount, DebtAccount, DeficitDebtAccount,
} from '../../components/Objects/Accounts/models';
import {
    withAllSellableAccounts, generateCandidateWithdrawalOrders, WithdrawalOrderItem,
} from '../../services/simulation/EngineDirectConversionSearch';
import { isSellableAccount } from '../../services/simulation/WithdrawalPlanner';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';
import { FutureSocialSecurityIncome } from '../../components/Objects/Income/models';
import { FoodExpense } from '../../components/Objects/Expense/models';
import { runSimulationWithOptimization } from '../../components/Objects/Assumptions/useSimulation';

// Cash, brokerage, Traditional, Roth (all sellable) + a property and a debt (NOT sellable).
const accts = (): AnyAccount[] => [
    new SavedAccount('cash', 'Cash', 50_000, 2),
    new InvestedAccount('brk', 'Brokerage', 400_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 300_000),
    new InvestedAccount('trad', 'Traditional 401k', 1_000_000, 0, 10, 0.05, 'Traditional 401k', true, 0.2, 1_000_000),
    new InvestedAccount('roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
    new PropertyAccount('home', 'Home', 600_000, 'Owned', 0, 0, ''),
    new DebtAccount('card', 'Credit Card', 5_000, '', 18),
    new DeficitDebtAccount('deficit', 'Deficit', 0),
];

const seq = (c: WithdrawalOrderItem[]) => c.map(x => x.accountId).join('>');

describe('isSellableAccount', () => {
    it('treats everything except property and debt (incl. deficit-debt) as sellable', () => {
        const byId = new Map(accts().map(a => [a.id, a]));
        expect(isSellableAccount(byId.get('cash')!)).toBe(true);
        expect(isSellableAccount(byId.get('brk')!)).toBe(true);
        expect(isSellableAccount(byId.get('trad')!)).toBe(true);
        expect(isSellableAccount(byId.get('roth')!)).toBe(true);
        expect(isSellableAccount(byId.get('home')!)).toBe(false);
        expect(isSellableAccount(byId.get('card')!)).toBe(false);
        expect(isSellableAccount(byId.get('deficit')!)).toBe(false);
    });
});

describe('withAllSellableAccounts', () => {
    const make = (a: AnyAccount): WithdrawalOrderItem => ({ id: `synth-${a.id}`, name: a.name, accountId: a.id });

    it('appends a synthesized entry for a sellable account the user EXCLUDED from the order', () => {
        // User excluded the Traditional 401k (a sellable account) from the burn order.
        const userOrder: WithdrawalOrderItem[] = [
            { id: 'w1', name: 'Cash', accountId: 'cash' },
            { id: 'w2', name: 'Brokerage', accountId: 'brk' },
            { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
        ];
        const full = withAllSellableAccounts(accts(), userOrder, make);
        // The excluded Traditional now appears...
        expect(full.map(x => x.accountId)).toContain('trad');
        // ...the user's relative order is preserved (listed accounts come first, in order)...
        expect(full.slice(0, 3).map(x => x.accountId)).toEqual(['cash', 'brk', 'roth']);
        // ...and the synthesized entry is a valid WithdrawalOrderItem.
        const tradItem = full.find(x => x.accountId === 'trad')!;
        expect(tradItem.id).toBeTruthy();
        expect(tradItem.name).toBe('Traditional 401k');
    });

    it('never folds in property, debt, or deficit-debt accounts', () => {
        const userOrder: WithdrawalOrderItem[] = [{ id: 'w1', name: 'Cash', accountId: 'cash' }];
        const full = withAllSellableAccounts(accts(), userOrder, make);
        const ids = full.map(x => x.accountId);
        expect(ids).not.toContain('home');
        expect(ids).not.toContain('card');
        expect(ids).not.toContain('deficit');
        // Only the 4 sellable accounts end up in the order (cash + the 3 appended sellables).
        expect(new Set(ids)).toEqual(new Set(['cash', 'brk', 'trad', 'roth']));
    });

    it('returns the SAME reference when the order already lists every sellable account (no-op)', () => {
        const userOrder: WithdrawalOrderItem[] = [
            { id: 'w1', name: 'Cash', accountId: 'cash' },
            { id: 'w2', name: 'Brokerage', accountId: 'brk' },
            { id: 'w3', name: 'Traditional 401k', accountId: 'trad' },
            { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
        ];
        // Reference identity matters: useSimulation's tax-opt path uses `fullStrategy === userOrder`
        // to keep the all-listed scenario byte-for-byte unchanged (reuses the std-ded baseline).
        expect(withAllSellableAccounts(accts(), userOrder, make)).toBe(userOrder);
    });
});

describe('candidate orders cover all sellable accounts under tax-opt', () => {
    const make = (a: AnyAccount): WithdrawalOrderItem => ({ id: `synth-${a.id}`, name: a.name, accountId: a.id });

    it('an EXCLUDED account appears in EVERY candidate order (incl. tax-aware sequences)', () => {
        // User excluded the Traditional 401k.
        const userOrder: WithdrawalOrderItem[] = [
            { id: 'w1', name: 'Cash', accountId: 'cash' },
            { id: 'w2', name: 'Brokerage', accountId: 'brk' },
            { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
        ];
        const full = withAllSellableAccounts(accts(), userOrder, make);
        const candidates = generateCandidateWithdrawalOrders(accts(), full);
        // The excluded Traditional must be present in EVERY candidate order so the engine search scores it.
        for (const c of candidates) {
            expect(c.map(x => x.accountId)).toContain('trad');
        }
        // The tax-aware sequences place it by tax bucket: the conventional candidate spends Traditional
        // before Roth; the Traditional-preserving candidate spends Roth before Traditional. Both exist.
        expect(candidates.map(seq)).toContain('cash>brk>trad>roth');
        expect(candidates.map(seq)).toContain('cash>brk>roth>trad');
    });

    it('candidate #0 (user-derived) keeps the user order and appends the excluded account', () => {
        const userOrder: WithdrawalOrderItem[] = [
            { id: 'w1', name: 'Cash', accountId: 'cash' },
            { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
        ];
        const full = withAllSellableAccounts(accts(), userOrder, make);
        const candidates = generateCandidateWithdrawalOrders(accts(), full);
        // #0 is the user-derived order: cash, roth (user's listed order preserved), then the appended
        // omitted sellables (brokerage, traditional). This is the no-regression anchor.
        expect(candidates[0].slice(0, 2).map(x => x.accountId)).toEqual(['cash', 'roth']);
        expect(new Set(candidates[0].map(x => x.accountId))).toEqual(new Set(['cash', 'brk', 'trad', 'roth']));
    });
});

// ===========================================================================
// SIM-LEVEL: the augmentation must actually flow through runSimulationWithOptimization
// (the #89 joint optimizer: chosenWithdrawalOrder / orderOptimizationGain / MC), not just
// the candidate generator. Under tax-opt an account the user EXCLUDED from the order must
// end up in the order the engine chooses and runs.
// ===========================================================================
describe('tax-opt folds an order-EXCLUDED account into the chosen order (runSimulationWithOptimization)', { timeout: 240_000 }, () => {
    const NOW = new Date().getFullYear();
    const BY = NOW - 60, RA = 60, LE = 90;
    const simAccts = (): AnyAccount[] => [
        new SavedAccount('cash', 'Cash', 50_000, 2),
        new InvestedAccount('brk', 'Brokerage', 400_000, 0, 10, 0.05, 'Brokerage', true, 0.2, 300_000),
        new InvestedAccount('trad', 'Traditional 401k', 1_000_000, 0, 10, 0.05, 'Traditional 401k', true, 0.2, 1_000_000),
        new InvestedAccount('roth', 'Roth IRA', 100_000, 0, 10, 0.05, 'Roth IRA', true, 0.2, 100_000),
    ];
    // The user left the $1M Traditional 401k OUT of the burn order. Under tax-opt that exclusion
    // must NOT bind — the optimizer has to fold it in as a first-class participant.
    const orderExcludingTrad = [
        { id: 'w1', name: 'Cash', accountId: 'cash' },
        { id: 'w2', name: 'Brokerage', accountId: 'brk' },
        { id: 'w4', name: 'Roth IRA', accountId: 'roth' },
    ];
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
        withdrawalStrategy: orderExcludingTrad,
    };
    const taxState: TaxState = { filingStatus: 'Single', stateResidency: 'Texas', deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW };
    const incomes = () => [new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67, 4_000, NOW)];
    const expenses = () => [new FoodExpense('exp', 'Living', 70_000, 'Annually', new Date(`${NOW}-01-01`))];

    it('the chosen order contains the excluded Traditional (exclusion does not bind under tax-opt)', () => {
        const res = runSimulationWithOptimization(LE - (NOW - BY), simAccts(), incomes(), expenses(), assumptions, taxState);
        const chosen = res[0].chosenWithdrawalOrder;
        expect(chosen).toBeDefined();
        // All four sellable accounts are present even though the user listed only three.
        expect(chosen!.map(o => o.accountId).sort()).toEqual(['brk', 'cash', 'roth', 'trad']);
        // No-regression floor: the chosen plan never scores below the std-ded baseline.
        expect(res[0].strategyTerminalAfterTaxNW!).toBeGreaterThanOrEqual(res[0].stdDedBaselineTerminalAfterTaxNW! - 1);
    });
});
