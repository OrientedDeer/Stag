/**
 * Joint conversion + drawdown-order optimizer: when Tax Optimization is on, the optimizer also
 * CHOOSES the withdrawal order (scoring candidate orders on the real engine), instead of blindly
 * running the user's stored order. The UI already promises this; the engine now delivers it.
 *
 * Unit tests pin the candidate-order generator (fast, deterministic). One integration test
 * confirms the optimizer wires through (sets chosenWithdrawalOrder + the feasibility floor still
 * holds). A PAYOFF test pins the economic value on a synthetic order-sensitive scenario (so the
 * committed suite guards the gain, not just the wiring).
 */
import { describe, it, expect } from 'vitest';
import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, RSUAccount } from '../../components/Objects/Accounts/models';
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

    it('NEVER spends Roth or Traditional before cash/brokerage in any candidate (guards the bogus-gain mix bug)', () => {
        // Regression guard for the "+$5.4M Roth-before-brokerage" artifact: an economically-unsound
        // order that PRESERVES taxable brokerage (spending a tax-advantaged bucket first) ends the
        // horizon brokerage-heavy, and the ONE shared ruler then mis-compares that mix into a spurious
        // gain. The generator must never emit such an order — cash + taxable brokerage are always spent
        // before BOTH tax-advantaged buckets; only the Roth-vs-Traditional relative order is a real
        // lever. The other tests assert good candidates are PRESENT; this asserts bad ones are ABSENT,
        // so re-adding a roth-before-brokerage sequence to TYPE_SEQUENCES would fail here (not pass green).
        const cands = generateCandidateWithdrawalOrders(accts(), userOrder);
        expect(cands.length).toBeGreaterThan(0);
        for (const c of cands) {
            const pos = (id: string) => c.findIndex(x => x.accountId === id);
            expect(pos('cash')).toBeLessThan(pos('roth'));
            expect(pos('cash')).toBeLessThan(pos('trad'));
            expect(pos('brk')).toBeLessThan(pos('roth'));
            expect(pos('brk')).toBeLessThan(pos('trad'));
        }
    });

    // #156: ESPP/RSU used to bucket as 'other' and sort dead-LAST (after Roth) in both
    // tax-aware candidates. They now land in the taxable band — 'brokerage' (favourable
    // gain character) or the new 'taxable-late' bucket (unfavourable), i.e. adjacent to
    // brokerage and always BEFORE both tax-advantaged buckets. All numbers invented.
    describe('ESPP/RSU taxable-band placement (#156)', () => {
        const SALE_DATE = new Date(2032, 5, 15);
        const yearsBefore = (y: number) => new Date(2032 - y, 5, 15);
        const monthsBefore = (m: number) => new Date(2032, 5 - m, 15);
        // Disqualifying ESPP (bought 3 months ago) → tier 1.5 → 'taxable-late'.
        const espp = () => new ESPPAccount('espp', 'ESPP', 40_000, [{
            id: 'l1', grantDate: monthsBefore(9), purchaseDate: monthsBefore(3),
            fmvAtGrant: 80, fmvAtPurchase: 85, purchasePrice: 72.25,
            shares: 400, totalCost: 28_900, discountAmount: 12.75,
        }], null, undefined, 'TICK', 100);
        // Long-term-gain RSU (vested 2 years ago, $40 basis, $100 price) → tier 1 → 'brokerage'.
        const rsu = () => new RSUAccount('rsu', 'RSU', 30_000, [{
            id: 'l1', grantDate: yearsBefore(3), vestDate: yearsBefore(2),
            fmvAtVest: 40, shares: 300, costBasis: 12_000,
        }], null, undefined, 'TICK', 100);
        // User's stored order deliberately puts ESPP/RSU dead-last, AFTER Roth.
        const eqAccts = (): AnyAccount[] => [...accts(), espp(), rsu()];
        const eqUserOrder: WithdrawalOrderItem[] = [
            ...userOrder,
            { id: 'w5', name: 'ESPP', accountId: 'espp' },
            { id: 'w6', name: 'RSU', accountId: 'rsu' },
        ];

        it('places ESPP/RSU in the taxable band — after cash, never after Roth/Traditional — in both tax-aware candidates', () => {
            const cands = generateCandidateWithdrawalOrders(eqAccts(), eqUserOrder, SALE_DATE);
            expect(cands.length).toBeGreaterThan(2);
            for (const c of cands.slice(1)) { // tax-aware candidates only (candidate #0 is the user's order)
                const pos = (id: string) => c.findIndex(x => x.accountId === id);
                // Long-term RSU joins the brokerage bucket (tier 1, stable tie-break keeps 'brk' first).
                expect(pos('rsu')).toBe(pos('brk') + 1);
                // Disqualifying ESPP lands in 'taxable-late': after ALL tier-1 taxable, before tax-advantaged.
                expect(pos('espp')).toBe(pos('rsu') + 1);
                for (const equityComp of ['espp', 'rsu']) {
                    expect(pos(equityComp)).toBeGreaterThan(pos('cash'));
                    expect(pos(equityComp)).toBeLessThan(pos('trad'));
                    expect(pos(equityComp)).toBeLessThan(pos('roth'));
                }
            }
        });

        it('candidate #0 (the user\'s stored order) is untouched — same items, same sequence', () => {
            const cands = generateCandidateWithdrawalOrders(eqAccts(), eqUserOrder, SALE_DATE);
            expect(cands[0]).toBe(eqUserOrder); // same reference: never rewritten
            expect(cands[0].map(x => x.accountId)).toEqual(['cash', 'brk', 'trad', 'roth', 'espp', 'rsu']);
        });
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
// PAYOFF (not just wiring): on an order-sensitive scenario the optimizer actively SWITCHES away
// from a stored order to a materially better one. A regression that silently kept the user's
// order would still pass the wiring tests above — but fails these.
//
// HISTORY (fp-review 2026-07-02): this block originally asserted a switch trad-first →
// Traditional-preserving worth ~$62k. That gain was substantially a SEARCH-MISS artifact: the
// pre-F9 golden refinement missed the user-order conversion peak at h≈$320k, which the F9
// IRMAA-probe grid brackets correctly (with ACA priced via the DP shadow penalty, the
// conventional order won at nw $5,221,766). Then F1 made the ACA subsidy loss real engine cash,
// this fixture set acaAware:false to keep testing order mechanics in isolation, and the
// co-optimum flipped back to Traditional-preserving (measured switch gain $27,026 from
// trad-first storage). Twice flipped by legitimate economics changes → these tests are now
// DIRECTION-AGNOSTIC: they pin that both storages converge to one co-optimum, that the arm
// stored away from it actively switches with a material gain, and that the incumbent arm
// reports gain $0 — without hardcoding WHICH order wins.
// ===========================================================================
describe('joint optimizer payoff — material order gain on an order-sensitive scenario', { timeout: 240_000 }, () => {
    // MFJ, large Traditional, strong SS, modest liquid buffer, high living, long horizon — the
    // conversion-heavy regime where the drawdown order interacts with the conversion plan. SS via
    // CurrentSocialSecurity so it actually delivers ($60k+); a hand-set Future* PIA would be
    // recomputed from empty earnings to ~$0 (see harness.ts makeSSHeavyScenario).
    const NOW = new Date().getFullYear();
    const RETIRE = 58, LE = 92, BY = NOW - RETIRE, YEARS = LE - RETIRE;
    const osAccts = (): AnyAccount[] => [
        new InvestedAccount('acc-trad', 'Traditional 401k', 2_500_000, 0, 30, 0, 'Traditional 401k', false, 1.0, 2_500_000),
        new InvestedAccount('acc-brk', 'Brokerage', 200_000, 0, 10, 0, 'Brokerage', false, 1.0, 100_000),
        new InvestedAccount('acc-roth', 'Roth IRA', 100_000, 0, 10, 0, 'Roth IRA', false, 1.0, 100_000),
        new SavedAccount('acc-cash', 'Cash', 50_000, 0),
    ];
    // Two stored orders differing only in Trad/Roth position; the co-optimum equals exactly one
    // of them, so whichever arm stores the other one must actively switch away from it.
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
            // ACA off: this scenario retires at 58 with $160k/yr spending, so its MAGI crosses
            // the MFJ 400%-FPL cliff in every pre-65 year under EVERY order. With the ACA
            // subsidy loss now charged as real engine cash (fp-review F1, default on), the
            // extra ~$12k/yr on the gap-year conversion strategy erases the order-switch gain
            // this test exists to pin. Disable it to keep testing the order-sensitivity
            // mechanics in isolation (an ACA-exposed household legitimately gets a different
            // answer now — that's the F1 fix working, not a regression).
            acaAware: false,
        },
        withdrawalStrategy: tradFirst,
    };
    const osTaxState: TaxState = { filingStatus: 'Married Filing Jointly', stateResidency: 'Texas', deductionMethod: 'Standard', fedOverride: null, ficaOverride: null, stateOverride: null, year: NOW };
    const osIncomes = () => [new CurrentSocialSecurityIncome('inc-ss', 'Social Security', 6_666, 'Monthly', new Date(BY + 67, 0, 1))]; // ~$80k/yr from 67
    const osExpenses = () => [new FoodExpense('exp-living', 'Living', 160_000, 'Annually', new Date(`${NOW}-01-01`))];
    // Both joint runs are shared across the assertions below (each is ~13-14 engine sims per order).
    const run = (() => {
        const cache = new Map<string, ReturnType<typeof runSimulationWithOptimization>>();
        return (name: string, order: WithdrawalOrderItem[]) => {
            let r = cache.get(name);
            if (!r) {
                r = runSimulationWithOptimization(YEARS, osAccts(), osIncomes(), osExpenses(),
                    { ...osAssumptions, withdrawalStrategy: order }, osTaxState);
                cache.set(name, r);
            }
            return r;
        };
    })();

    it('the arm stored away from the co-optimum actively switches to it with a material gain', () => {
        const a = run('stored-trad-first', tradFirst);
        const b = run('stored-trad-preserving', tradPreserving);
        const chosenIds = (r: typeof a) => r[0].chosenWithdrawalOrder!.map(o => o.accountId);
        // Both storages converge to ONE co-optimum, which equals exactly one of the two stored
        // orders — so the other arm exercised a real switch (not just enumeration).
        expect(chosenIds(a)).toEqual(chosenIds(b));
        const storedIds = { a: tradFirst.map(o => o.accountId), b: tradPreserving.map(o => o.accountId) };
        const aIsIncumbent = JSON.stringify(chosenIds(a)) === JSON.stringify(storedIds.a);
        const bIsIncumbent = JSON.stringify(chosenIds(b)) === JSON.stringify(storedIds.b);
        expect(aIsIncumbent !== bIsIncumbent).toBe(true); // exactly one arm is stored at the co-optimum
        const incumbent = aIsIncumbent ? a : b;
        const switcher = aIsIncumbent ? b : a;
        // PAYOFF: the switching arm beats its stored order by a material margin at FULL
        // co-optimization (each order scored with its own optimal conversion plan). Threshold is
        // conservative (measured $27,026 on 2026-07-02 with acaAware:false + the F8/F9 search);
        // a regression that silently kept the stored order → $0 → fails. The incumbent arm's
        // own order IS the co-optimum, so its gain is exactly $0.
        expect(switcher[0].orderOptimizationGain!).toBeGreaterThan(20_000);
        expect(incumbent[0].orderOptimizationGain!).toBe(0);
        // F5a dpTrace fallback: the switching arm's winning order never got its own DP solve (the
        // DP is solved once, under the user's order, and reused as every candidate's seed) — the
        // debug trace must still be attached, carrying the user-order DP analysis.
        expect(switcher.some(y => y.dpTrace)).toBe(true);
        // Same co-optimized after-tax value from either starting point (small tolerance because
        // each storage builds its ruler from its OWN stored-order std-ded baseline).
        const nwA = a[0].strategyTerminalAfterTaxNW!;
        const nwB = b[0].strategyTerminalAfterTaxNW!;
        expect(Math.abs(nwA - nwB)).toBeLessThan(Math.max(5_000, Math.abs(nwA) * 1e-3));
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
