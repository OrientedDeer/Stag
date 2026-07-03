/**
 * #155 — under-59½ Roth penalty-free-slice-first withdrawals (tax-opt path).
 *
 * createOrderedSnapshots (honorLiteralOrder=false) splits each under-59½ Roth
 * snapshot into a PENALTY-FREE slice (contribution basis + conversion layers aged
 * ≥ 5 years) that keeps the account's place in the non-penalized bucket, and a
 * PENALIZED slice (young conversions + earnings) deferred to the very END of the
 * penalized bucket. A deficit therefore stops at the free slice, spills to the
 * next account (including a penalized Traditional), and touches penalized Roth
 * earnings only as the last resort.
 *
 * All figures below are INVENTED test numbers.
 */

import { describe, it, expect } from 'vitest';

import { createOrderedSnapshots, planWithdrawals } from '../../../services/simulation/WithdrawalPlanner';
import { AccountBalanceSnapshot } from '../../../services/simulation/types';
import { InvestedAccount } from '../../../components/Objects/Accounts/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';

const YEAR = 2030;
const AGE = 50; // < 59.5 → the split is active
const PENALTY_RATE = 0.10;
// Ordinary income high enough that every draw in these tests stays inside ONE
// federal bracket (22%, Single) — keeps old-vs-new total comparisons exact even
// though the split reorders which account stacks ordinary income first.
const ORDINARY_INCOME = 80000;

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(1980, 50, 95),
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            returnRates: { ror: 6 },
        },
        withdrawalStrategy: [],
    };
}

function makeTaxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas', // no state income tax — keeps the math clean
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

/** Roth account: costBasis = contributions + Σ conversions (regularContributions is derived). */
function makeRoth(
    id: string,
    taxType: 'Roth IRA' | 'Roth 401k',
    amount: number,
    contributions: number,
    conversions: { year: number; amount: number }[] = [],
): InvestedAccount {
    const conversionTotal = conversions.reduce((s, c) => s + c.amount, 0);
    return new InvestedAccount(
        id, id, amount, 0, 10, 0.05, taxType, true, 0.2,
        contributions + conversionTotal, undefined, conversions,
    );
}

function makeTraditional(id: string, amount: number): InvestedAccount {
    return new InvestedAccount(id, id, amount, 0, 10, 0.05, 'Traditional IRA');
}

function orderOf(accounts: InvestedAccount[]): { accountId: string }[] {
    return accounts.map(a => ({ accountId: a.id }));
}

/** Tax-opt path snapshots (honorLiteralOrder=false, no fallback tier). */
function taxOptSnapshots(accounts: InvestedAccount[], age = AGE): AccountBalanceSnapshot[] {
    return createOrderedSnapshots(accounts, orderOf(accounts), age, YEAR, false, false);
}

function plan(netNeeded: number, snapshots: AccountBalanceSnapshot[], opts?: {
    aca?: { acaCliffThreshold: number; currentMAGI: number };
}) {
    return planWithdrawals(
        netNeeded, snapshots, AGE, YEAR, makeTaxState(), ORDINARY_INCOME,
        makeAssumptions(), 'Spending deficit', opts?.aca,
    );
}

const grossFrom = (result: ReturnType<typeof plan>, accountId: string) =>
    result.withdrawals.filter(w => w.accountId === accountId).reduce((s, w) => s + w.gross, 0);

describe('#155 splitRothPenaltySlices — snapshot structure', () => {
    it('splits an under-59½ Roth into a free slice (in place) and a penalized slice (at the very end)', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 100000, 40000);
        const trad = makeTraditional('trad-1', 500000);
        const snaps = taxOptSnapshots([roth, trad]);

        // Order: free slice (non-penalized) → Traditional (penalized) → penalized Roth slice (last)
        expect(snaps.map(s => s.accountId)).toEqual(['roth-1', 'trad-1', 'roth-1']);
        expect(snaps[0].vestedBalance).toBe(40000);
        expect(snaps[0].rothSlice).toBe('penaltyFree');
        expect(snaps[0].sliceKey).toBe('roth-1::penaltyFree');
        expect(snaps[0].rothContributions).toBe(40000); // free slice keeps basis fields
        expect(snaps[2].vestedBalance).toBe(60000);
        expect(snaps[2].rothSlice).toBe('penalized');
        expect(snaps[2].sliceKey).toBe('roth-1::penalized');
        expect(snaps[2].rothContributions).toBe(0);     // penalized slice zeroes basis (no double-count)
        expect(snaps[2].conversionHistory).toEqual([]);
    });

    it('puts aged (≥5yr) conversion layers in the free slice and young (<5yr) layers in the penalized slice', () => {
        // YEAR=2030: 2020 layer is 10yr (aged), 2025 layer is exactly 5yr (aged — the
        // >= 5 boundary, matching grossUpRoth's penalty check), 2027 is 3yr (young).
        const roth = makeRoth('roth-1', 'Roth IRA', 200000, 10000, [
            { year: 2020, amount: 30000 },
            { year: 2025, amount: 25000 },
            { year: 2027, amount: 50000 },
        ]);
        const snaps = taxOptSnapshots([roth]);

        expect(snaps).toHaveLength(2);
        // Free = 10k contributions + 30k (2020) + 25k (2025) = 65k
        expect(snaps[0].rothSlice).toBe('penaltyFree');
        expect(snaps[0].vestedBalance).toBe(65000);
        // Penalized = 200k − 65k = 135k (50k young conversion + 85k earnings)
        expect(snaps[1].rothSlice).toBe('penalized');
        expect(snaps[1].vestedBalance).toBe(135000);
    });

    it('does not split when the whole balance is penalty-free (remainder immaterial)', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 50000, 50000);
        const snaps = taxOptSnapshots([roth]);
        expect(snaps).toHaveLength(1);
        expect(snaps[0].rothSlice).toBeUndefined();
        expect(snaps[0].sliceKey).toBeUndefined();
        expect(snaps[0].vestedBalance).toBe(50000);
    });

    it('moves a Roth with no free capacity WHOLE to the end of the penalized bucket, keeping its basis fields', () => {
        const roth = makeRoth('roth-1', 'Roth 401k', 80000, 0, [{ year: 2028, amount: 30000 }]); // young only
        const trad = makeTraditional('trad-1', 100000);
        const snaps = taxOptSnapshots([roth, trad]);

        expect(snaps.map(s => s.accountId)).toEqual(['trad-1', 'roth-1']);
        expect(snaps[1].rothSlice).toBe('penalized');
        expect(snaps[1].vestedBalance).toBe(80000);
        // Sole slice for the account → keeps its conversion history (pooled/per-account
        // builders in planWithdrawals must still see the layers exactly once).
        expect(snaps[1].conversionHistory).toEqual([{ year: 2028, amount: 30000 }]);
    });

    it('is a no-op at age ≥ 59½ (self-healing)', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 100000, 40000);
        const trad = makeTraditional('trad-1', 500000);
        const snaps = taxOptSnapshots([roth, trad], 60);
        expect(snaps.map(s => s.accountId)).toEqual(['roth-1', 'trad-1']);
        expect(snaps.every(s => s.rothSlice === undefined && s.sliceKey === undefined)).toBe(true);
        expect(snaps[0].vestedBalance).toBe(100000);
    });

    it('never splits on the literal-order path (#154 contract), even under 59½', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 100000, 40000);
        const trad = makeTraditional('trad-1', 500000);
        const snaps = createOrderedSnapshots([roth, trad], orderOf([roth, trad]), AGE, YEAR, false, true);
        expect(snaps.map(s => s.accountId)).toEqual(['roth-1', 'trad-1']);
        expect(snaps.every(s => s.rothSlice === undefined && s.sliceKey === undefined)).toBe(true);
        expect(snaps[0].vestedBalance).toBe(100000);
    });
});

describe('#155 pooled Roth IRA basis vs per-account Roth 401k', () => {
    it('allocates pooled Roth IRA free capacity to accounts in input (= drain) order', () => {
        // Basis is pooled per IRS Pub 590-B: A carries no basis of its own but drains
        // first, so the pool backs A entirely before B gets the remainder.
        const rothA = makeRoth('roth-a', 'Roth IRA', 30000, 0);
        const rothB = makeRoth('roth-b', 'Roth IRA', 100000, 50000);
        const snaps = taxOptSnapshots([rothA, rothB]);

        // A: fully covered by the pool (30k ≤ 50k) → no split.
        // B: min(100k, 50k − 30k) = 20k free + 80k penalized.
        expect(snaps.map(s => `${s.accountId}:${s.vestedBalance}:${s.rothSlice ?? 'whole'}`)).toEqual([
            'roth-a:30000:whole',
            'roth-b:20000:penaltyFree',
            'roth-b:80000:penalized',
        ]);
    });

    it('does not double-count pooled basis across slices when draining', () => {
        const rothA = makeRoth('roth-a', 'Roth IRA', 30000, 0);
        const rothB = makeRoth('roth-b', 'Roth IRA', 100000, 50000);
        const snaps = taxOptSnapshots([rothA, rothB]);

        // Exactly the pooled free capacity: all tax/penalty-free, nothing penalized.
        const atPool = plan(50000, snaps);
        expect(atPool.totalGross).toBeCloseTo(50000, 6);
        expect(atPool.totalTax).toBe(0);
        expect(atPool.totalPenalties).toBe(0);
        expect(atPool.remainingDeficit).toBe(0);

        // $10k past the pool: the excess must come from PENALIZED earnings (taxed +
        // 10% penalty), proving the penalized slice can't re-spend the pooled basis.
        const pastPool = plan(60000, snaps);
        expect(pastPool.remainingDeficit).toBe(0);
        const penalizedDraws = pastPool.withdrawals.filter(w => w.penalty > 0);
        expect(penalizedDraws).toHaveLength(1);
        expect(penalizedDraws[0].accountId).toBe('roth-b');
        // The free slices delivered exactly 50k net; the penalized draw nets the
        // remaining 10k, carrying ordinary tax AND the 10% penalty on its gross.
        expect(penalizedDraws[0].net).toBeCloseTo(10000, 1);
        expect(penalizedDraws[0].tax).toBeGreaterThan(0);
        expect(pastPool.totalPenalties).toBeCloseTo(penalizedDraws[0].gross * PENALTY_RATE, 4);
        expect(pastPool.totalTax).toBeCloseTo(penalizedDraws[0].tax, 6);
    });

    it('treats Roth 401k free capacity strictly per-account (no pooling)', () => {
        const r401kA = makeRoth('r401k-a', 'Roth 401k', 50000, 40000);
        const r401kB = makeRoth('r401k-b', 'Roth 401k', 50000, 0);
        const snaps = taxOptSnapshots([r401kA, r401kB]);

        // A: 40k free + 10k penalized. B: NO free capacity (its own basis is 0 —
        // A's basis must not leak over) → whole snapshot at the penalized end.
        expect(snaps.map(s => `${s.accountId}:${s.vestedBalance}:${s.rothSlice ?? 'whole'}`)).toEqual([
            'r401k-a:40000:penaltyFree',
            'r401k-a:10000:penalized',
            'r401k-b:50000:penalized',
        ]);
    });
});

describe('#155 drain behavior — deficit stops at the free slice', () => {
    it('stops at the contribution basis and spills to Traditional; Roth earnings untouched', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 100000, 40000);
        const trad = makeTraditional('trad-1', 500000);
        const snaps = taxOptSnapshots([roth, trad]);

        // Need $60k net: $40k free Roth basis, the remaining $20k from Traditional
        // (with its own tax + 10% penalty) — NOT from penalized Roth earnings.
        const result = plan(60000, snaps);

        expect(result.remainingDeficit).toBe(0);
        expect(grossFrom(result, 'roth-1')).toBeCloseTo(40000, 6);
        const rothDraws = result.withdrawals.filter(w => w.accountId === 'roth-1');
        expect(rothDraws).toHaveLength(1);
        expect(rothDraws[0].tax).toBe(0);
        expect(rothDraws[0].penalty).toBe(0);

        const tradDraw = result.withdrawals.find(w => w.accountId === 'trad-1');
        expect(tradDraw).toBeDefined();
        expect(tradDraw!.net).toBeCloseTo(20000, 1);
        expect(tradDraw!.penalty).toBeCloseTo(tradDraw!.gross * PENALTY_RATE, 6);
    });

    it('taps penalized Roth earnings only after every other account (incl. penalized Traditional) is exhausted', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 50000, 20000);
        const trad = makeTraditional('trad-1', 15000);
        const snaps = taxOptSnapshots([roth, trad]);

        // A huge deficit drains everything. Draw sequence must be:
        // free Roth slice → Traditional (fully) → penalized Roth slice (last resort).
        const result = plan(500000, snaps);

        const sequence = result.withdrawals.map(w => `${w.accountId}:${Math.round(w.gross)}`);
        expect(sequence).toEqual(['roth-1:20000', 'trad-1:15000', 'roth-1:30000']);
        expect(grossFrom(result, 'roth-1')).toBeCloseTo(50000, 6);
        expect(grossFrom(result, 'trad-1')).toBeCloseTo(15000, 6);
        expect(result.remainingDeficit).toBeGreaterThan(0); // everything exhausted
    });

    it('matches the old single-pass tax/penalty totals when everything drains anyway', () => {
        // When the deficit exceeds ALL balances the split only reorders the draws;
        // the same dollars come out of the same layers, so totals must match the
        // pre-split single-pass (emulated with unsplit whole-account snapshots).
        // Balances are kept small ($15k earnings + $5k Traditional on top of $80k
        // ordinary income) so every draw stays inside the SAME federal bracket —
        // reordering the ordinary-income stacking then can't shift marginal rates.
        const makeAccts = () => [makeRoth('roth-1', 'Roth IRA', 25000, 10000), makeTraditional('trad-1', 5000)];

        const split = plan(500000, taxOptSnapshots(makeAccts()));
        // Old behavior: same buckets, whole under-59½ Roth in nonPenalized —
        // i.e. the literal-order path's snapshots in the old bucket order
        // [roth (non-penalized), trad (penalized)].
        const accts = makeAccts();
        const whole = createOrderedSnapshots(accts, orderOf(accts), AGE, YEAR, false, true);
        const single = plan(500000, whole);

        expect(split.totalGross).toBeCloseTo(single.totalGross, 4);
        expect(split.totalNet).toBeCloseTo(single.totalNet, 4);
        expect(split.totalTax).toBeCloseTo(single.totalTax, 4);
        expect(split.totalPenalties).toBeCloseTo(single.totalPenalties, 4);
    });

    it('applies the 10% penalty to a young conversion layer drawn through the penalized slice', () => {
        const roth = makeRoth('roth-1', 'Roth IRA', 200000, 10000, [
            { year: 2020, amount: 30000 }, // aged → free slice
            { year: 2027, amount: 50000 }, // young → penalized slice
        ]);
        const snaps = taxOptSnapshots([roth]);

        // Need $45k: 40k from the free slice (10k contrib + 30k aged conversion,
        // no tax/penalty), then $5k net from the penalized slice's YOUNG conversion
        // layer — penalty-grossed to 5k/0.9, penalty 10% of that, NO ordinary tax
        // (conversions are never taxed again, only penalized).
        const result = plan(45000, snaps);

        expect(result.remainingDeficit).toBe(0);
        expect(result.totalTax).toBe(0);
        const expectedYoungGross = 5000 / (1 - PENALTY_RATE);
        expect(result.totalPenalties).toBeCloseTo(expectedYoungGross * PENALTY_RATE, 4);
        expect(grossFrom(result, 'roth-1')).toBeCloseTo(40000 + expectedYoungGross, 4);
    });
});

describe('#155 ACA-cliff Roth substitution against a split account', () => {
    it('tracks consumption per-slice: substitution on the free slice cannot starve the penalized slice', () => {
        // Brokerage is fully MAGI-capped (cliff barely above current MAGI), so the
        // whole $60k shortfall routes to Roth. The look-ahead substitutes the free
        // slice's $40k (non-MAGI contributions). The remaining $20k must then come
        // from the penalized slice's earnings in the main pass — with accountId-keyed
        // consumption the $40k would ALSO be deducted from the penalized slice's
        // availability, leaving it 20k gross ≈ 13.6k net and a phantom shortfall.
        const roth = makeRoth('roth-1', 'Roth IRA', 100000, 40000);
        const brokerage = new InvestedAccount(
            'brk-1', 'brk-1', 100000, 0, 10, 0.05, 'Brokerage', true, 0.2, 50000, // gainRatio 0.5
        );
        const snaps = taxOptSnapshots([brokerage, roth]);

        const result = plan(60000, snaps, {
            aca: { acaCliffThreshold: ORDINARY_INCOME + 100, currentMAGI: ORDINARY_INCOME },
        });

        expect(result.remainingDeficit).toBe(0);

        // Substitution drew exactly the free slice (tax/penalty-free).
        const substitutions = result.withdrawals.filter(w => w.reason === 'ACA cliff Roth substitution');
        expect(substitutions).toHaveLength(1);
        expect(substitutions[0].gross).toBeCloseTo(40000, 4);
        expect(substitutions[0].tax).toBe(0);
        expect(substitutions[0].penalty).toBe(0);

        // The penalized slice topped up the rest from earnings (taxed + penalized) —
        // possible only because its availability wasn't corrupted by the free-slice draw.
        const earningsDraw = result.withdrawals.find(
            w => w.accountId === 'roth-1' && w.reason === 'Spending deficit',
        );
        expect(earningsDraw).toBeDefined();
        expect(earningsDraw!.net).toBeCloseTo(20000, 1);
        expect(earningsDraw!.penalty).toBeCloseTo(earningsDraw!.gross * PENALTY_RATE, 4);
        expect(earningsDraw!.tax).toBeGreaterThan(0);

        // No double-spend: total Roth gross stays within the account balance.
        expect(grossFrom(result, 'roth-1')).toBeLessThanOrEqual(100000 + 1e-6);
    });
});
