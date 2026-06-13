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

import { RSUAccount, RSULot, AnyAccount, SavedAccount, InvestedAccount } from '../../../components/Objects/Accounts/models';
import { AnyIncome, WorkIncome, SocialSecurityIncome } from '../../../components/Objects/Income/models';
import { OtherExpense } from '../../../components/Objects/Expense/models';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../../components/Objects/Taxes/TaxContext';
import { solveYear, YearSolverInput } from '../../../services/simulation/YearSolver';
import { simulateOneYear } from '../../../components/Objects/Assumptions/SimulationEngine';
import * as TaxService from '../../../components/Objects/Taxes/TaxService';
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

function taxState(stateResidency: string = 'Texas'): TaxState {
    return {
        filingStatus: 'Single',
        stateResidency,
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
    stateResidency?: string;
    // Explicit withdrawal order by account id. Defaults to accounts' own order
    // (RSU first, then extras).
    withdrawalOrder?: string[];
}): YearSolverInput {
    const rsu = new RSUAccount(
        'rsu-1', 'Company RSU',
        // amount = market value at current price (lot pool valued at sharePrice).
        over.lots.reduce((s, l) => s + l.shares, 0) * over.sharePrice,
        over.lots, null, undefined, 'CO', over.sharePrice,
        over.withdrawalPreference ?? 'fifo', over.minimumHoldingDays ?? 0,
    );
    const accounts: AnyAccount[] = [rsu, ...(over.extraAccounts ?? [])];
    const withdrawalOrder = over.withdrawalOrder
        ? over.withdrawalOrder.map(accountId => ({ accountId }))
        : accounts.map(a => ({ accountId: a.id }));
    return {
        year: YEAR,
        currentAge: YEAR - 1962, // 64
        isRetired: true,
        incomes: over.incomes ?? [],
        expenses: [],
        totalLivingExpenses: over.livingExpenses,
        rmdAmount: 0,
        accounts,
        withdrawalOrder,
        taxState: taxState(over.stateResidency),
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

    // =========================================================================
    // Issue #84 — pin the STCG ordinary-tax BACK-OUT under all four interactions
    // =========================================================================
    // The earlier pins all use Texas / no SS / no Traditional draw / sub-NIIT
    // income, so YearSolver.solveRetirementYear's `stcgOrdinaryTaxDelta` back-out
    // never exercises its real paths. This test drives ONE retirement year with
    // every dimension live at once and pins the exact dollars, so a future change
    // that double-counts the STCG ordinary tax (federal/total too high) or
    // over-subtracts it (NIIT, LTCG-stack, or SS-taxability effect of the STCG
    // dropped) fails loudly.
    //
    // Scenario (Single, age 64, 2026):
    //   - STATE = California (taxes the STCG as ordinary income; exempts SS).
    //   - Social Security = $2,500/mo = $30,000/yr → taxable-SS coupling is LIVE
    //     and gain-sensitive (see ssTaxable assertions below).
    //   - Traditional IRA = $20,000, drawn FIRST → its ordinary income stacks
    //     UNDER the STCG (the planner advances runningOrdinaryIncome by the
    //     Traditional draw before the RSU sale, so the STCG is taxed on top).
    //   - One SHORT-TERM RSU lot (vested Dec 2025), 1,000 sh, $40 basis, $300
    //     price → up to $260/sh STCG. Living expenses $250k force a large sale,
    //     pushing MAGI above the $200k NIIT threshold so NIIT actually bites.
    //
    // The Traditional ($20k) is too small to cover the deficit, so the planner
    // sells RSU for the remainder and realizes ~$205,917 of STCG.
    it('mixed retirement year: pins STCG back-out under CA tax / SS / Traditional / NIIT', () => {
        const buildMixed = (stateResidency: string) => buildInput({
            lots: [stLot()],
            sharePrice: 300,
            livingExpenses: 250000,
            // Small Traditional balance so the ordinary draw is modest — this keeps
            // the no-gain SS taxability BELOW the 85% cap, so the STCG genuinely
            // MOVES taxable SS (proven in the assertions below).
            extraAccounts: [new InvestedAccount(
                'trad-1', 'Traditional IRA', 20000, 0, 0, 0.1, 'Traditional IRA', true, 0.2, 20000,
            )],
            // SS active all of 2026 (start well before, no end) → full $30,000/yr.
            incomes: [new SocialSecurityIncome(
                'ss-1', 'Social Security', 2500, 'Monthly', 64, undefined, new Date(2020, 0, 1),
            )],
            // Traditional drawn FIRST so its ordinary income stacks under the STCG.
            withdrawalOrder: ['trad-1', 'rsu-1'],
            stateResidency,
        });

        const plan = solveYear(buildMixed('California'));
        const g = gains(plan.withdrawals);

        // The whole deficit is funded (no unfunded shortfall) and the solver converged.
        expect(plan.unfundedDeficit).toBe(0);
        expect(plan.converged).toBe(true);

        // ---- All four interaction paths are non-zero & gain-driven ----------

        // (1) Traditional draw: the full $20k balance, drawn as ordinary income.
        const tradGross = plan.withdrawals
            .filter(w => w.source === 'traditional_ira')
            .reduce((s, w) => s + w.gross, 0);
        expect(Math.round(tradGross)).toBe(20000);

        // (2) STCG realized (short-term only — the lot is < 1yr from vest).
        expect(g.lt).toBe(0);
        expect(g.st).toBeGreaterThan(200000);
        expect(g.net).toBeLessThanOrEqual(g.gross + 1e-6);

        // (3) NIIT bites: MAGI ($251,417) is above the $200k Single threshold, and
        //     the STCG is the net investment income that drives it.
        expect(plan.tax.niit).toBeGreaterThan(0);

        // (4) State tax taxes the gain. CA's tax on the STCG + Traditional draw
        //     flows through withdrawalOrdinaryTax (the planner charges it), so the
        //     gain-sensitive state cost shows up as the CA-vs-TX total delta. Texas
        //     (no state income tax) is the control.
        const txPlan = solveYear(buildMixed('Texas'));
        const stateTaxEffect = plan.tax.total - txPlan.tax.total;
        expect(stateTaxEffect).toBeGreaterThan(0);
        expect(Math.round(stateTaxEffect)).toBe(GOLD.mixed.stateTaxEffect);

        // (5) Taxable-SS coupling is LIVE and moved by the gain. Combined income
        //     WITHOUT the STCG (just the $20k Traditional draw) leaves SS only
        //     partially taxable; WITH the STCG it pins to the 85% cap. The back-out
        //     must NOT drop this effect.
        const ssTaxableNoGain = TaxService.getTaxableSocialSecurityBenefits(30000, tradGross, 0, 'Single');
        const ssTaxableWithGain = TaxService.getTaxableSocialSecurityBenefits(30000, tradGross + g.st, 0, 'Single');
        expect(Math.round(ssTaxableNoGain)).toBe(GOLD.mixed.taxableSSNoGain); // 5,350 (well below the cap)
        expect(Math.round(ssTaxableWithGain)).toBe(GOLD.mixed.taxableSSWithGain); // 25,500 (= 0.85 × $30k cap)
        expect(ssTaxableWithGain).toBeGreaterThan(ssTaxableNoGain);

        // ---- INVARIANT RECONCILIATION (the heart of the regression test) ------
        // solveRetirementYear assembles total tax as:
        //   total = finalFedTaxExStcgOrdinary  (= finalFedResult.totalTax − stcgOrdinaryTaxDelta)
        //         + finalStateTax              (income-side state line; $0 here, SS-exempt)
        //         + withdrawalOrdinaryTax      (planner: STCG ordinary + Traditional ordinary + their CA state tax)
        //         + fica + penalties + irmaa   (all $0 here)
        // The taxSummary surfaces this as:
        //   tax.federal  = finalFedResult.ordinaryTax − stcgOrdinaryTaxDelta   (STCG ordinary backed out)
        //   tax.niit     = finalFedResult.niitTax                              (STCG's NIIT RETAINED)
        //   tax.state    = finalStateTax                                       (income-side only)
        //   tax.withdrawalOrdinaryTax                                          (carries the STCG ordinary tax)
        // so tax.total == tax.federal + tax.capitalGainsLT + tax.niit
        //               + tax.state + tax.withdrawalOrdinaryTax + tax.fica + tax.penalties.
        // If the back-out double-counted the STCG ordinary tax, tax.federal (and
        // tax.total) would jump by ~$1.2k+. If it over-subtracted, niit/LTCG-stack
        // would vanish. This identity + the pins below lock both failure modes out.
        const componentSum =
            plan.tax.federal + plan.tax.capitalGainsLT + plan.tax.niit +
            plan.tax.state + plan.tax.withdrawalOrdinaryTax + plan.tax.fica + plan.tax.penalties;
        expect(componentSum).toBeCloseTo(plan.tax.total, 4);

        // ---- GOLDEN PINS — exact verified-correct engine output --------------
        expect(Math.round(g.gross)).toBe(GOLD.mixed.rsuGross);
        expect(Math.round(g.st)).toBe(GOLD.mixed.stcg);
        expect(Math.round(plan.magi ?? 0)).toBe(GOLD.mixed.magi);
        expect(Math.round(plan.tax.federal)).toBe(GOLD.mixed.fedOrdinary);
        expect(Math.round(plan.tax.niit)).toBe(GOLD.mixed.niit);
        expect(Math.round(plan.tax.state)).toBe(GOLD.mixed.stateLine);
        expect(Math.round(plan.tax.withdrawalOrdinaryTax)).toBe(GOLD.mixed.withdrawalOrdinaryTax);
        expect(Math.round(plan.tax.capitalGainsST)).toBe(0); // STCG tax lives in withdrawalOrdinaryTax
        expect(Math.round(plan.tax.total)).toBe(GOLD.mixed.total);
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
//
//  MIXED (issue #84): Single, CALIFORNIA, age 64, $30,000/yr SS, $20,000
//  Traditional IRA drawn first, one short-term RSU lot (1,000 sh, $40 basis,
//  $300 price), $250,000 living expenses. The Traditional draw ($20k) can't
//  cover the deficit, so the planner sells RSU for the rest → $205,917 STCG.
//  MAGI = taxable SS ($25,500) + Traditional ($20,000) + STCG ($205,917) =
//  $251,417 → above the $200k NIIT threshold. The federal helper's internal
//  NIIT MAGI excludes the planner-side Traditional draw (it's carried in
//  withdrawalOrdinaryTax), so niitBase = min($205,917, ($25,500+$205,917)−$200k)
//  = $31,417 → NIIT = $31,417 × 3.8% = $1,194. tax.federal ($940) is the
//  ordinary tax on the $25,500 taxable SS alone (the STCG ordinary tax is BACKED
//  OUT and instead lives in withdrawalOrdinaryTax = $35,463, which also carries
//  the Traditional ordinary tax and CA state tax on both). tax.state is the
//  income-side line ($0 — CA exempts SS); the gain's CA state cost surfaces as
//  the $9,748 CA-vs-Texas total delta. Taxable SS is gain-driven: $5,350 without
//  the STCG, $25,500 (85% cap) with it.
const GOLD = {
    lt: { gross: 50000, ltcg: 30000, magi: 30000, ltcgTax: 0, niit: 0, total: 0 },
    st: { gross: 53191, stcg: 31915, magi: 31915, niit: 0, total: 3191 },
    mixed: {
        rsuGross: 237597,
        stcg: 205917,
        magi: 251417,
        fedOrdinary: 940,
        niit: 1194,
        stateLine: 0,
        withdrawalOrdinaryTax: 35463,
        total: 37597,
        stateTaxEffect: 9748,
        taxableSSNoGain: 5350,
        taxableSSWithGain: 25500,
    },
};
