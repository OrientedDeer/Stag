/**
 * RSU (Restricted Stock Unit) support — issue #29.
 *
 * Covers:
 *  - RSUAccount model: lot add/remove, withdrawal ordering, increment growth,
 *    cost-basis preservation, ST/LT capital-gains split, underwater losses.
 *  - WorkIncome vesting schedules: cliff vs graded, frequency, multi-grant.
 *  - RSUVesting service: ordinary income at vest, sell-to-cover withholding,
 *    net-share lots, FMV projection.
 *  - End-to-end: a multi-year simulation with RSU grants does not break taxes
 *    or the income breakdown.
 */
import { describe, it, expect } from 'vitest';

import {
    RSUAccount,
    type RSULot,
    SavedAccount,
} from '../../../components/Objects/Accounts/models';
import { WorkIncome, PassiveIncome } from '../../../components/Objects/Income/models';
import { processRSUVesting } from '../../../services/simulation/RSUVesting';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import {
    type AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { type TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import { type SimulationYear } from '../../../services/simulation/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeLot(overrides: Partial<RSULot> = {}): RSULot {
    const shares = overrides.shares ?? 100;
    const fmvAtVest = overrides.fmvAtVest ?? 50;
    return {
        id: overrides.id ?? 'lot-1',
        grantDate: overrides.grantDate ?? new Date(2020, 0, 1),
        vestDate: overrides.vestDate ?? new Date(2021, 0, 1),
        fmvAtVest,
        shares,
        costBasis: overrides.costBasis ?? fmvAtVest * shares,
    };
}

function makeAssumptions(birthYear: number, retireAge = 65): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(birthYear, retireAge, 95),
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: false,
            returnRates: { ror: 0 },
        },
    };
}

function makeTaxState(year: number): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year,
    };
}

// ===========================================================================
// RSUAccount model
// ===========================================================================
describe('RSUAccount model', () => {
    it('addLot increases shares, cost basis, and balance by at-vest value', () => {
        const acc = new RSUAccount('rsu-1', 'My RSU', 0);
        const updated = acc.addLot(makeLot({ shares: 100, fmvAtVest: 50 }));
        expect(updated.totalShares).toBe(100);
        expect(updated.totalCostBasis).toBe(5000);
        expect(updated.amount).toBe(5000);
    });

    it('increment grows the balance but preserves lot cost bases', () => {
        const acc = new RSUAccount('rsu-1', 'My RSU', 10000, [makeLot({ shares: 100, fmvAtVest: 50 })]);
        const assumptions = {
            ...defaultAssumptions,
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false },
        };
        const grown = acc.increment(assumptions, 10); // +10%
        expect(grown.amount).toBeCloseTo(11000, 2);
        // Cost basis unchanged — only market value grows.
        expect(grown.totalCostBasis).toBe(5000);
    });

    it('calculateSaleTax: no ordinary income, splits short- vs long-term gains', () => {
        // Long-term lot vested 2021, short-term lot vested late 2024.
        const ltLot = makeLot({ id: 'lt', vestDate: new Date(2021, 0, 1), shares: 100, fmvAtVest: 50 });
        const stLot = makeLot({ id: 'st', vestDate: new Date(2024, 11, 1), shares: 100, fmvAtVest: 50 });
        const acc = new RSUAccount('rsu-1', 'My RSU', 20000, [ltLot, stLot]);

        const saleDate = new Date(2025, 5, 15);
        // Sell all 200 shares at $80 (gain $30/share).
        const result = acc.calculateSaleTax(200, 80, saleDate, 'fifo');
        expect(result.ordinaryIncome).toBe(0);
        // LT lot held >=1yr → long-term; ST lot <1yr → short-term.
        expect(result.longTermGains).toBeCloseTo(100 * 30, 2);
        expect(result.shortTermGains).toBeCloseTo(100 * 30, 2);
    });

    it('calculateSaleTax: underwater lot produces a real negative gain (loss)', () => {
        const lot = makeLot({ vestDate: new Date(2021, 0, 1), shares: 100, fmvAtVest: 50 });
        const acc = new RSUAccount('rsu-1', 'My RSU', 3000, [lot]);
        // Sell at $30 (below the $50 basis) — a $20/share loss.
        const result = acc.calculateSaleTax(100, 30, new Date(2025, 0, 1), 'fifo');
        expect(result.longTermGains).toBeCloseTo(-2000, 2);
    });

    it('unrealizedGains floors at 0 but does not clamp cost basis', () => {
        const lot = makeLot({ shares: 100, fmvAtVest: 50 }); // basis 5000
        const acc = new RSUAccount('rsu-1', 'My RSU', 3000, [lot]); // underwater
        expect(acc.totalCostBasis).toBe(5000);
        expect(acc.unrealizedGains).toBe(0); // floored for tax split
        // The card computes the true loss separately: amount - costBasis = -2000.
        expect(acc.amount - acc.totalCostBasis).toBe(-2000);
    });

    it('removeSoldShares respects long_term_first ordering', () => {
        const ltLot = makeLot({ id: 'lt', vestDate: new Date(2021, 0, 1), shares: 100, fmvAtVest: 50 });
        const stLot = makeLot({ id: 'st', vestDate: new Date(2024, 11, 1), shares: 100, fmvAtVest: 50 });
        const acc = new RSUAccount('rsu-1', 'My RSU', 20000, [stLot, ltLot]);

        // Sell 100 shares @ $100, long-term first → the LT lot is consumed.
        const after = acc.removeSoldShares(100, 100, new Date(2025, 5, 15), 'long_term_first');
        const remaining = after.lots;
        expect(remaining.length).toBe(1);
        expect(remaining[0].id).toBe('st');
        // Balance reduced by sale proceeds.
        expect(after.amount).toBeCloseTo(10000, 2);
    });

    it('removeSoldShares scales a partially-sold lot cost basis', () => {
        const lot = makeLot({ shares: 100, fmvAtVest: 50 });
        const acc = new RSUAccount('rsu-1', 'My RSU', 5000, [lot]);
        const after = acc.removeSoldShares(40, 50, new Date(2025, 0, 1), 'fifo');
        expect(after.lots[0].shares).toBeCloseTo(60, 4);
        expect(after.lots[0].costBasis).toBeCloseTo(60 * 50, 4);
    });
});

// ===========================================================================
// WorkIncome vesting schedules
// ===========================================================================
describe('WorkIncome RSU vesting schedules', () => {
    function rsuIncome(schedule: WorkIncome['rsuVestingSchedule'], frequency: WorkIncome['rsuVestFrequency'], shares: number, grant: Date): WorkIncome {
        const inc = new WorkIncome(
            'work-1', 'Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED', grant, undefined,
        );
        inc.rsuVestingSchedule = schedule;
        inc.rsuVestFrequency = frequency;
        inc.rsuGrantShares = shares;
        inc.rsuAccountId = 'rsu-1';
        return inc;
    }

    it('cliff-1yr vests nothing in the grant year and everything at the 1-year mark', () => {
        const inc = rsuIncome('cliff-1yr', 'quarterly', 400, new Date(2025, 0, 1));
        expect(inc.getAnnualRSUVestShares(2025)).toBe(0);
        expect(inc.getAnnualRSUVestShares(2026)).toBe(400);
        expect(inc.getAnnualRSUVestShares(2027)).toBe(0);
    });

    it('graded-4yr quarterly vests 16 equal tranches across 4 years', () => {
        const inc = rsuIncome('graded-4yr', 'quarterly', 1600, new Date(2025, 0, 1));
        // 16 tranches of 100 shares. With a Jan-1 grant the vests fall at offsets
        // 0.25..4.0 yr, so the final tranche (4.0 yr) lands in 2029. The whole
        // grant is conserved across 2025-2029.
        const total = [2025, 2026, 2027, 2028, 2029].reduce((s, y) => s + inc.getAnnualRSUVestShares(y), 0);
        expect(total).toBeCloseTo(1600, 2);
        // First year: vests at 0.25, 0.5, 0.75 yr land in 2025 (offset 1.0 → 2026).
        const y2025 = inc.getAnnualRSUVestShares(2025);
        expect(y2025).toBeGreaterThan(0);
    });

    it('graded-3yr annual vests in equal yearly thirds', () => {
        const inc = rsuIncome('graded-3yr', 'annual', 300, new Date(2025, 0, 1));
        expect(inc.getAnnualRSUVestShares(2026)).toBeCloseTo(100, 4);
        expect(inc.getAnnualRSUVestShares(2027)).toBeCloseTo(100, 4);
        expect(inc.getAnnualRSUVestShares(2028)).toBeCloseTo(100, 4);
        const total = [2026, 2027, 2028].reduce((s, y) => s + inc.getAnnualRSUVestShares(y), 0);
        expect(total).toBeCloseTo(300, 4);
    });

    it('returns 0 when RSUs are not configured', () => {
        const inc = rsuIncome('NONE', 'quarterly', 0, new Date(2025, 0, 1));
        expect(inc.getAnnualRSUVestShares(2026)).toBe(0);
    });

    it('whole grant total is conserved across all schedules', () => {
        const grant = new Date(2025, 0, 1);
        for (const [schedule, freq] of [
            ['graded-4yr', 'quarterly'],
            ['graded-3yr', 'semi-annual'],
            ['graded-4yr', 'annual'],
        ] as const) {
            const inc = rsuIncome(schedule, freq, 1200, grant);
            const total = [2025, 2026, 2027, 2028, 2029].reduce((s, y) => s + inc.getAnnualRSUVestShares(y), 0);
            expect(total).toBeCloseTo(1200, 2);
        }
    });
});

// ===========================================================================
// RSUVesting service
// ===========================================================================
describe('processRSUVesting', () => {
    function setup(grantYear: number, withholdingRate = 37, currentSharePrice = 100, growth = 0) {
        const inc = new WorkIncome(
            'work-1', 'Job', 100000, 'Annually', 'Yes',
            0, 0, 0, 0, '', null, 'FIXED', new Date(grantYear, 0, 1), undefined,
        );
        inc.rsuVestingSchedule = 'cliff-1yr';
        inc.rsuGrantShares = 100;
        inc.rsuAccountId = 'rsu-1';
        inc.rsuExpectedStockGrowth = growth;
        inc.rsuWithholdingRate = withholdingRate;

        const acc = new RSUAccount('rsu-1', 'My RSU', 0, [], 'work-1', undefined, 'TICK', currentSharePrice);
        return { inc, acc };
    }

    it('recognizes gross vest value as ordinary (earned) income at the vest year', () => {
        const { inc, acc } = setup(2025, 37, 100, 0);
        const logs: string[] = [];
        // Cliff vests in grantYear + 1 = 2026. currentSimYear = 2025 (today).
        const result = processRSUVesting([inc], [acc], 2026, 2025, logs);
        expect(result.vestIncomes.length).toBe(1);
        const vest = result.vestIncomes[0];
        // 100 shares × $100 FMV = $10,000 gross.
        expect(vest.amount).toBeCloseTo(10000, 2);
        expect(vest.earned_income).toBe('Yes');
        expect(vest.sourceType).toBe('RSU');
        expect(vest.isReinvested).toBe(true);
    });

    it('applies sell-to-cover withholding and nets the remaining shares into the lot', () => {
        const { inc, acc } = setup(2025, 40, 100, 0);
        const logs: string[] = [];
        const result = processRSUVesting([inc], [acc], 2026, 2025, logs);
        // 40% withheld of $10,000 = $4,000 prepayment.
        expect(result.totalWithholding).toBeCloseTo(4000, 2);
        // Net shares = 100 × (1 - 0.40) = 60.
        const lot = result.rsuLots['rsu-1'][0];
        expect(lot.shares).toBeCloseTo(60, 4);
        // fmvAtVest is both income/share and cost basis/share.
        expect(lot.fmvAtVest).toBeCloseTo(100, 4);
        expect(lot.costBasis).toBeCloseTo(60 * 100, 2);
    });

    it('compounds FMV-at-vest from the current price by expected growth', () => {
        // currentSimYear 2025, vest 2026 (1 year), 10% growth → FMV = 100 × 1.1 = 110.
        // Compounds from the CURRENT sim year (today's price), NOT the grant year.
        const { inc, acc } = setup(2025, 0, 100, 10);
        const logs: string[] = [];
        const result = processRSUVesting([inc], [acc], 2026, 2025, logs);
        const vest = result.vestIncomes[0];
        // 100 shares × $110 = $11,000.
        expect(vest.amount).toBeCloseTo(11000, 2);
        expect(result.rsuLots['rsu-1'][0].fmvAtVest).toBeCloseTo(110, 4);
    });

    it('produces nothing in a non-vesting year', () => {
        const { inc, acc } = setup(2025, 37, 100, 0);
        const logs: string[] = [];
        const result = processRSUVesting([inc], [acc], 2025, 2025, logs); // grant year, cliff not yet vested
        expect(result.vestIncomes.length).toBe(0);
        expect(result.totalWithholding).toBe(0);
    });

    it('skips vest recognition (no fabricated $100/share income) when the linked share price is unset', () => {
        // The UI maps a blank price field to undefined and does not require it. With
        // no current price, the vest FMV must NOT silently fall back to $100/share —
        // that fabricates grossIncome = shares × $100 of taxable ordinary income from
        // nothing, inflating AGI/FICA/SS-taxability/IRMAA/ACA and seeding a bogus lot.
        // Mirror the SALE path's `if (fmvPerShare > 0)` guard: skip recognition.
        const { inc } = setup(2025, 37, 100, 0);
        const acc = new RSUAccount('rsu-1', 'My RSU', 0, [], 'work-1', undefined, 'TICK', undefined);
        const logs: string[] = [];
        const result = processRSUVesting([inc], [acc], 2026, 2025, logs);

        expect(result.vestIncomes.length).toBe(0);
        expect(result.totalWithholding).toBe(0);
        expect(result.rsuLots['rsu-1']).toBeUndefined();
        expect(logs.some(l => l.includes('[WARN]') && l.toLowerCase().includes('price'))).toBe(true);
    });

    it('skips vest recognition when the linked share price is zero', () => {
        const { inc } = setup(2025, 37, 100, 0);
        const acc = new RSUAccount('rsu-1', 'My RSU', 0, [], 'work-1', undefined, 'TICK', 0);
        const logs: string[] = [];
        const result = processRSUVesting([inc], [acc], 2026, 2025, logs);

        expect(result.vestIncomes.length).toBe(0);
        expect(result.totalWithholding).toBe(0);
        expect(result.rsuLots['rsu-1']).toBeUndefined();
    });
});

// ===========================================================================
// End-to-end: multi-year simulation with RSU grants
// ===========================================================================
describe('RSU end-to-end simulation', () => {
    it('vests over multiple years, feeds taxes, and grows the RSU account', () => {
        const BIRTH_YEAR = 1985; // age 40 in 2025
        const assumptions = makeAssumptions(BIRTH_YEAR, 65);
        const taxState = makeTaxState(2025);

        const work = new WorkIncome(
            'work-1', 'Engineer', 200000, 'Annually', 'Yes',
            0, 0, 0, 0, 'savings-1', null, 'FIXED', new Date(2025, 0, 1), undefined,
        );
        work.rsuVestingSchedule = 'graded-4yr';
        work.rsuVestFrequency = 'annual';
        work.rsuGrantShares = 400; // 100 shares/yr for 4 years
        work.rsuAccountId = 'rsu-1';
        work.rsuExpectedStockGrowth = 5;
        work.rsuWithholdingRate = 37;

        const rsu = new RSUAccount('rsu-1', 'Company RSU', 0, [], 'work-1', undefined, 'CO', 100);
        const savings = new SavedAccount('savings-1', 'Cash', 50000, 0);
        const expense = new OtherExpense('exp-1', 'Living', 60000, 'Annually', new Date(2020, 0, 1));

        let incomes = [work];
        let accounts: (RSUAccount | SavedAccount)[] = [rsu, savings];
        const history: SimulationYear[] = [];

        for (let i = 0; i < 5; i++) {
            const year = 2025 + i;
            const result = simulateOneYear(
                year, incomes, [expense], accounts, assumptions, taxState, history,
            );
            history.push(result);
            incomes = result.incomes.filter(inc => inc instanceof WorkIncome) as WorkIncome[];
            accounts = result.accounts.filter(
                a => a instanceof RSUAccount || a instanceof SavedAccount,
            ) as (RSUAccount | SavedAccount)[];

            // The simulation must not throw and must produce a finite net worth.
            const nw = result.accounts.reduce((s, a) => s + a.amount, 0);
            expect(Number.isFinite(nw)).toBe(true);
        }

        // After 4 vesting years the RSU account should hold accumulated net shares.
        const finalRSU = history[history.length - 1].accounts.find(a => a instanceof RSUAccount) as RSUAccount;
        expect(finalRSU).toBeDefined();
        expect(finalRSU.amount).toBeGreaterThan(0);
        expect(finalRSU.totalShares).toBeGreaterThan(0);

        // In the first vest year (2026), the RSU vest income should appear and
        // taxes should be non-zero (the vest is taxable W-2 income).
        const year2026 = history[1];
        const rsuVestIncome = year2026.incomes.find(
            inc => inc instanceof PassiveIncome && inc.sourceType === 'RSU',
        );
        expect(rsuVestIncome).toBeDefined();
        const totalTax2026 = year2026.taxDetails.fed + year2026.taxDetails.state + year2026.taxDetails.fica;
        expect(totalTax2026).toBeGreaterThan(0);
    });

    it('does not double-count RSU vest income across years (regenerated, not persisted)', () => {
        const assumptions = makeAssumptions(1985, 65);
        const taxState = makeTaxState(2025);

        const work = new WorkIncome(
            'work-1', 'Engineer', 200000, 'Annually', 'Yes',
            0, 0, 0, 0, 'savings-1', null, 'FIXED', new Date(2025, 0, 1), undefined,
        );
        work.rsuVestingSchedule = 'graded-3yr';
        work.rsuVestFrequency = 'annual';
        work.rsuGrantShares = 300;
        work.rsuAccountId = 'rsu-1';
        work.rsuWithholdingRate = 37;

        const rsu = new RSUAccount('rsu-1', 'Company RSU', 0, [], 'work-1', undefined, 'CO', 100);
        const savings = new SavedAccount('savings-1', 'Cash', 50000, 0);
        const expense = new OtherExpense('exp-1', 'Living', 60000, 'Annually', new Date(2020, 0, 1));

        let incomes: WorkIncome[] = [work];
        let accounts: (RSUAccount | SavedAccount)[] = [rsu, savings];
        const history: SimulationYear[] = [];

        for (let i = 0; i < 3; i++) {
            const year = 2025 + i;
            const result = simulateOneYear(
                year, incomes, [expense], accounts, assumptions, taxState, history,
            );
            history.push(result);
            incomes = result.incomes.filter(inc => inc instanceof WorkIncome) as WorkIncome[];
            accounts = result.accounts.filter(
                a => a instanceof RSUAccount || a instanceof SavedAccount,
            ) as (RSUAccount | SavedAccount)[];

            // Each year should carry AT MOST one RSU vest income — never an
            // accumulation of prior years' synthetic vest entries.
            const rsuVestCount = result.incomes.filter(
                inc => inc instanceof PassiveIncome && inc.sourceType === 'RSU',
            ).length;
            expect(rsuVestCount).toBeLessThanOrEqual(1);
        }
    });
});
