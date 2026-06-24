/**
 * Finding 1 (2026-06-24 deep-review): DP year-tax must include the engine's
 * 10% early-withdrawal penalty on pre-59.5 Traditional SPENDING.
 *
 * The real engine (WithdrawalPlanner) charges a flat 10% penalty on Traditional
 * 401k/IRA withdrawals taken for spending before age 59.5 (conversions are
 * penalty-free). The DP's per-year tax (`computeYearTax`) priced only
 * fed+state+ACA+IRMAA, so a cell whose spending waterfall reached `tradSpending`
 * at age < 59.5 looked ~10% cheaper than the engine actually charges — biasing
 * conversion sizing in the early-FIRE corner where brokerage+Roth are depleted
 * and the waterfall is forced into Traditional for living expenses.
 *
 * These tests exercise `evaluateCell` directly (the cell where the penalty must
 * land) and confirm the penalty applies to trad SPENDING only, pre-59.5 only.
 */
import { describe, it, expect } from 'vitest';
import {
    evaluateCell,
    computeYearTax,
    DPYearContext,
} from '../../../services/simulation/RothConversionDP';
import { makeDPContext } from './dpFixtures';

const EARLY_PENALTY_RATE = 0.10;

/**
 * Early-FIRE cell builder: a retiree well under 59.5 with a real spending need,
 * no brokerage and no Roth, so the spending waterfall is forced all the way down
 * to Traditional. nonSSOrdinaryIncomeExclRMD is small so trad spending is the
 * dominant tax driver and the engine's penalty bites cleanly.
 */
function earlyFireCtx(age: number, overrides: Partial<DPYearContext> = {}): DPYearContext {
    return makeDPContext(2030, age, {
        nonSSOrdinaryIncomeExclRMD: 5_000,
        ssBenefits: 0,
        ltcgIncome: 0,
        spendingNeed: 60_000,
        baselineBrokerageAvailable: 0, // no brokerage cushion
        rmdDivisor: 0,                 // pre-RMD (and pre-59.5)
        ...overrides,
    });
}

describe('DP early-withdrawal penalty on pre-59.5 trad spending (Finding 1)', () => {
    it('charges the 10% penalty when the waterfall reaches trad spending at age 57', () => {
        const ctx = earlyFireCtx(57);
        const trad = 1_000_000;
        const roth = 0; // no Roth → waterfall must hit trad for spending
        const conversion = 0;
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD, ctx);

        const cell = evaluateCell(trad, roth, conversion, ctx, taxBaseline);

        // Sanity: the waterfall really did reach trad spending in this cell.
        expect(cell.tradSpending).toBeGreaterThan(0);

        // The year's tax must include a 10% penalty on the trad SPENDING portion.
        // Reconstruct the no-penalty tax (fed+state+ACA+IRMAA on the same ordinary
        // income) and confirm the cell's yearTax exceeds it by ~10% of tradSpending.
        const ordIncome = ctx.nonSSOrdinaryIncomeExclRMD + cell.tradSpending;
        // taxNoPenalty: what computeYearTax returns with NO penalized trad spending.
        const taxNoPenalty = computeYearTax(ordIncome, ctx, 0);
        const expectedPenalty = cell.tradSpending * EARLY_PENALTY_RATE;

        expect(cell.yearTax).toBeGreaterThan(taxNoPenalty);
        expect(cell.yearTax - taxNoPenalty).toBeCloseTo(expectedPenalty, 0);
    });

    it('charges NO early penalty once age >= 59.5 (same spending)', () => {
        const ctx = earlyFireCtx(62);
        const trad = 1_000_000;
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD, ctx);

        const cell = evaluateCell(trad, 0, 0, ctx, taxBaseline);
        expect(cell.tradSpending).toBeGreaterThan(0);

        const ordIncome = ctx.nonSSOrdinaryIncomeExclRMD + cell.tradSpending;
        const taxNoPenalty = computeYearTax(ordIncome, ctx, 0);
        // At 62 the penalty is gone — yearTax is exactly the no-penalty tax.
        expect(cell.yearTax).toBeCloseTo(taxNoPenalty, 0);
    });

    it('does NOT penalize a pre-59.5 conversion (conversions are penalty-free)', () => {
        // A cell with a conversion but NO trad spending (brokerage covers the gap)
        // must NOT incur the early-withdrawal penalty — conversions are exempt.
        const ctx = earlyFireCtx(55, {
            spendingNeed: 20_000,
            baselineBrokerageAvailable: 1_000_000, // brokerage covers all spending
        });
        const trad = 1_000_000;
        const conversion = 40_000;
        const taxBaseline = computeYearTax(ctx.nonSSOrdinaryIncomeExclRMD, ctx);

        const cell = evaluateCell(trad, 0, conversion, ctx, taxBaseline);
        expect(cell.tradSpending).toBe(0); // brokerage covered the gap

        // yearTax must equal fed+state tax on (nonSSOrd + conversion) with NO penalty.
        const ordIncome = ctx.nonSSOrdinaryIncomeExclRMD + conversion;
        const taxNoPenalty = computeYearTax(ordIncome, ctx, 0);
        expect(cell.yearTax).toBeCloseTo(taxNoPenalty, 0);
    });

    it('computeYearTax adds exactly 10% of the penalized trad spending arg, pre-59.5', () => {
        const ctx = earlyFireCtx(57);
        const ordIncome = ctx.nonSSOrdinaryIncomeExclRMD + 40_000;
        const taxNoPenalty = computeYearTax(ordIncome, ctx, 0);
        const taxWithPenalty = computeYearTax(ordIncome, ctx, 40_000);
        expect(taxWithPenalty - taxNoPenalty).toBeCloseTo(40_000 * EARLY_PENALTY_RATE, 6);
    });

    it('computeYearTax adds NO penalty for the trad-spending arg at age >= 59.5', () => {
        const ctx = earlyFireCtx(60);
        const ordIncome = ctx.nonSSOrdinaryIncomeExclRMD + 40_000;
        const taxNoPenalty = computeYearTax(ordIncome, ctx, 0);
        const taxWithArg = computeYearTax(ordIncome, ctx, 40_000);
        expect(taxWithArg).toBeCloseTo(taxNoPenalty, 6);
    });
});
