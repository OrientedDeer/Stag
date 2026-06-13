/**
 * RSU retirement-year golden master — issue #29 review.
 *
 * The existing e2e RSU test only smoke-checks finiteness. The retirement-year
 * tax/withdrawal path (YearSolver.solveRetirementYear) is where the review found
 * the worst correctness bugs: STCG dropped from MAGI/NIIT/bracketing, frozen
 * share price, the withholding refund floor, underwater-loss caps, and lot
 * eligibility/ordering. This suite drives YearSolver directly for a RETIREMENT
 * year that sells RSU lots to fund a spending deficit and PINS the exact
 * resulting tax, MAGI, NIIT, and short-/long-term capital-gains dollars.
 *
 * Single filer, Texas (no state income tax), age 64 (no IRMAA / Medicare, ACA
 * disabled) so the numbers isolate the federal RSU math.
 */
import { describe, it, expect } from 'vitest';

import { RSUAccount, RSULot, AnyAccount, SavedAccount } from '../../../components/Objects/Accounts/models';
import { AnyIncome, WorkIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { solveYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import { PlannedWithdrawal } from '../../../services/simulation/types';

const YEAR = 2026;

function assumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        // Born 1962 → age 64 in 2026 (under 65: no Medicare/IRMAA).
        milestones: createBuiltinMilestones(1962, 60, 95),
        macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
        investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false, returnRates: { ror: 0 } },
    };
}

function taxState(): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency: 'Texas',
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: YEAR,
    };
}

function ltLot(): RSULot {
    // Vested Jan 2023 → long-term by 2026. 1,000 sh, $40 basis.
    return { id: 'lot-lt', grantDate: new Date(2022, 0, 1), vestDate: new Date(2023, 0, 1), fmvAtVest: 40, shares: 1000, costBasis: 40000 };
}

function stLot(): RSULot {
    // Vested Dec 2025 → short-term as of mid-2026. 1,000 sh, $40 basis.
    return { id: 'lot-st', grantDate: new Date(2025, 0, 1), vestDate: new Date(2025, 11, 1), fmvAtVest: 40, shares: 1000, costBasis: 40000 };
}

function buildInput(over: {
    lots: RSULot[];
    sharePrice: number;
    livingExpenses: number;
    minimumHoldingDays?: number;
    withdrawalPreference?: RSUAccount['withdrawalPreference'];
    extraAccounts?: AnyAccount[];
    incomes?: AnyIncome[];
}): YearSolverInput {
    const rsu = new RSUAccount(
        'rsu-1', 'Company RSU',
        // amount = market value at current price (lot pool valued at sharePrice).
        over.lots.reduce((s, l) => s + l.shares, 0) * over.sharePrice,
        over.lots, null, undefined, 'CO', over.sharePrice,
        over.withdrawalPreference ?? 'fifo', over.minimumHoldingDays ?? 0,
    );
    const accounts: AnyAccount[] = [rsu, ...(over.extraAccounts ?? [])];
    return {
        year: YEAR,
        currentAge: YEAR - 1962, // 64
        isRetired: true,
        incomes: over.incomes ?? [],
        expenses: [],
        totalLivingExpenses: over.livingExpenses,
        rmdAmount: 0,
        accounts,
        withdrawalOrder: accounts.map(a => ({ accountId: a.id })),
        taxState: taxState(),
        assumptions: assumptions(),
        taxOptimizationEnabled: false,
        acaAware: false,
        previousSimulation: [],
    };
}

function gains(withdrawals: PlannedWithdrawal[]): { st: number; lt: number; gross: number; net: number; tax: number } {
    let st = 0, lt = 0, gross = 0, net = 0, tax = 0;
    for (const w of withdrawals) {
        if (w.source !== 'rsu') continue;
        st += w.capitalGains?.shortTerm ?? 0;
        lt += w.capitalGains?.longTerm ?? 0;
        gross += w.gross;
        net += w.net;
        tax += w.tax;
    }
    return { st, lt, gross, net, tax };
}

describe('RSU retirement-year golden master (YearSolver)', () => {
    it('long-term RSU sale: pins LTCG dollars, NIIT, MAGI, and tax', () => {
        // 1,000 long-term shares, basis $40, price $100 → $60/sh gain available.
        // Need ~$50,000 of living expenses; income is $0, so the planner sells RSU.
        const plan = solveYear(buildInput({ lots: [ltLot()], sharePrice: 100, livingExpenses: 50000 }));
        const g = gains(plan.withdrawals);

        // Long-term only — no short-term gains realized.
        expect(g.st).toBe(0);
        expect(g.lt).toBeGreaterThan(0);

        // Cash conservation: net never exceeds gross, and the realized LT gain is
        // bounded by gross × (gain ratio). Gain ratio = 60/100 = 0.6.
        expect(g.net).toBeLessThanOrEqual(g.gross + 1e-6);
        expect(g.lt).toBeCloseTo(g.gross * 0.6, 4);

        // MAGI equals the realized LTCG (no other income). LTCG is the only AGI.
        expect(plan.magi).toBeCloseTo(g.lt, 0);

        // No short-term capital-gains tax line (all long-term).
        expect(plan.tax.capitalGainsST).toBe(0);

        // GOLDEN PINS — exact engine output for this scenario.
        expect(Math.round(g.gross)).toBe(GOLD.lt.gross);
        expect(Math.round(g.lt)).toBe(GOLD.lt.ltcg);
        expect(Math.round(plan.magi ?? 0)).toBe(GOLD.lt.magi);
        expect(Math.round(plan.tax.capitalGainsLT)).toBe(GOLD.lt.ltcgTax);
        expect(Math.round(plan.tax.niit)).toBe(GOLD.lt.niit);
        expect(Math.round(plan.tax.total)).toBe(GOLD.lt.total);
    });

    it('short-term RSU sale: STCG feeds ordinary tax, MAGI, and NIIT', () => {
        // 1,000 short-term shares, basis $40, price $100 → $60/sh ST gain.
        const plan = solveYear(buildInput({ lots: [stLot()], sharePrice: 100, livingExpenses: 50000 }));
        const g = gains(plan.withdrawals);

        expect(g.lt).toBe(0);
        expect(g.st).toBeGreaterThan(0);
        expect(g.net).toBeLessThanOrEqual(g.gross + 1e-6);
        expect(g.st).toBeCloseTo(g.gross * 0.6, 4);

        // STCG must be in MAGI (the bug: it was dropped in the retirement path).
        expect(plan.magi).toBeCloseTo(g.st, 0);

        // GOLDEN PINS
        expect(Math.round(g.gross)).toBe(GOLD.st.gross);
        expect(Math.round(g.st)).toBe(GOLD.st.stcg);
        expect(Math.round(plan.magi ?? 0)).toBe(GOLD.st.magi);
        expect(Math.round(plan.tax.niit)).toBe(GOLD.st.niit);
        expect(Math.round(plan.tax.total)).toBe(GOLD.st.total);
    });

    it('minimumHoldingDays makes recent lots unsellable (deficit goes unfunded)', () => {
        // The only lot vested Dec 2025; a 400-day hold isn't met by mid-2026, so
        // NO shares are sellable. With no other account, the deficit is unfunded.
        const plan = solveYear(buildInput({
            lots: [stLot()], sharePrice: 100, livingExpenses: 50000, minimumHoldingDays: 400,
        }));
        const g = gains(plan.withdrawals);
        expect(g.gross).toBe(0);
        expect(plan.unfundedDeficit).toBeGreaterThan(0);
    });

    it('underwater RSU sale: realized loss benefit is capped at $3,000, net never exceeds gross', () => {
        // Price $25 below the $40 basis → $15/sh LT loss. Force a sale by giving a
        // tiny living expense the planner still tries to fund from the RSU.
        const plan = solveYear(buildInput({ lots: [ltLot()], sharePrice: 25, livingExpenses: 5000 }));
        const g = gains(plan.withdrawals);

        // A sale happened (or the deficit is unfunded), but in no case may the
        // realized loss refund more than the $3,000-capped benefit, and net can
        // never exceed gross.
        expect(g.net).toBeLessThanOrEqual(g.gross + 1e-6);
        // The loss is capped: total tax can dip slightly below zero only by the
        // capped benefit (3000 × top ordinary rate ≈ <$1,110), never unbounded.
        expect(plan.tax.total).toBeGreaterThan(-1200);
    });

});

describe('RSU sell-to-cover over-withholding refund (engine path)', () => {
    // Already-retired single filer (age 66 in 2026), no other income or expenses,
    // a 1-year cliff RSU grant whose only vest lands this year. 100 sh × $100 =
    // $10,000 gross vest. The actual tax on $10k of ordinary income for a single
    // filer (after the 2026 standard deduction) is far below the 37% sell-to-cover
    // ($3,700) → a genuine refund. Fix #3: that over-withholding returns as
    // spendable cash instead of being clamped to zero.
    function runVestYear(withholdingRate: number): number {
        const assume = {
            ...defaultAssumptions,
            // Born 1976 → age 50 in 2026 (still working: an inactive WorkIncome
            // without an end milestone is NOT dropped, so the grant still vests).
            milestones: createBuiltinMilestones(1976, 65, 95),
            macro: { ...defaultAssumptions.macro, inflationAdjusted: false, inflationRate: 0 },
            investments: { ...defaultAssumptions.investments, taxOptimizationEnabled: false, returnRates: { ror: 0 } },
        } as AssumptionsState;

        const work = new WorkIncome(
            'work-1', 'Job', 0, 'Annually', 'Yes',
            0, 0, 0, 0, 'sav-1', null, 'FIXED', new Date(2025, 0, 1), undefined,
        );
        work.rsuVestingSchedule = 'cliff-1yr';
        work.rsuGrantShares = 100;            // vests 100 sh × $100 = $10,000 in 2026
        work.rsuAccountId = 'rsu-1';
        work.rsuExpectedStockGrowth = 0;
        work.rsuWithholdingRate = withholdingRate;

        const rsu = new RSUAccount('rsu-1', 'RSU', 0, [], 'work-1', undefined, 'CO', 100);
        const sav = new SavedAccount('sav-1', 'Cash', 100000, 0);
        const expense = new OtherExpense('e1', 'none', 0, 'Annually', new Date(2020, 0, 1));

        const out = simulateOneYear(2026, [work], [expense], [rsu, sav], assume, taxState(), []);
        // The Sankey "invested by user" figure is the year's net spendable cash;
        // the RSU withholding refund flows into it via totalCashAvailable.
        return (out as unknown as { cashflow: { investedUser: number } }).cashflow.investedUser;
    }

    it('returns the over-withholding as spendable cash (not clamped to zero)', () => {
        const saved37 = runVestYear(37);
        const saved0 = runVestYear(0);

        expect(Number.isFinite(saved37)).toBe(true);
        expect(Number.isFinite(saved0)).toBe(true);

        // $10,000 vest, reinvested (no cash). Actual tax ≈ $765 (FICA only; ordinary
        // income is below the standard deduction). At 0% withholding that $765 is a
        // cash shortfall → investedUser ≈ −765. At 37% the company remits $3,700; the
        // EXCESS over the $765 actual tax (≈ $2,935) returns as a refund (spendable
        // cash). PINNED:
        expect(Math.round(saved0)).toBe(-765);   // no withholding: tax owed from cash
        expect(Math.round(saved37)).toBe(2935);  // refund: $3,700 withheld − $765 tax
        // The full over-withholding ($3,700) is preserved — not clamped away.
        expect(Math.round(saved37 - saved0)).toBe(3700);
    });
});

// GOLDEN NUMBERS — the exact, verified-correct YearSolver output for these
// retirement-year RSU scenarios (Single, Texas, 2026 federal params, age 64).
// Each was hand-checked for internal consistency before pinning:
//
//  LONG-TERM: sell $50,000 gross of a 60%-gain LT pool → $30,000 LTCG. With the
//  2026 standard deduction the entire $30k LTCG lands in the 0% cap-gains bracket
//  (taxable income < the 0% ceiling), MAGI < $200k NIIT threshold → $0 tax. Net
//  equals gross (no tax). MAGI == realized LTCG.
//
//  SHORT-TERM: the planner grosses up to $53,191 so that after $3,191 of
//  ordinary-rate STCG tax the net is exactly the $50,000 deficit. STCG = 60% of
//  gross = $31,915, and — the core review fix #1 — that STCG now appears in MAGI
//  ($31,915) and would feed NIIT (here $0, below threshold). Net never exceeds
//  gross. STCG tax flows through withdrawalOrdinaryTax (== total here).
const GOLD = {
    lt: { gross: 50000, ltcg: 30000, magi: 30000, ltcgTax: 0, niit: 0, total: 0 },
    st: { gross: 53191, stcg: 31915, magi: 31915, niit: 0, total: 3191 },
};
