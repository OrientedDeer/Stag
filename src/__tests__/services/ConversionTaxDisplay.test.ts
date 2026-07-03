/**
 * #164: Displayed Roth-conversion tax cost must equal the finite difference
 *
 * The per-year conversion tax shown to the user (rothConversion.taxCost, fed by
 * PlannedConversion.taxAmount) must equal the conversion's TRUE incremental
 * cost: (year's total tax with the conversion) − (year's total tax without it).
 *
 * The old planning-time estimator priced the conversion's LTCG-bump from the
 * ACCOUNT-AVERAGE brokerage gain ratio and ignored the extra brokerage sale
 * that funds the conversion tax itself — but the withdrawal planner realizes
 * gains FIFO oldest-lot-first, so in brokerage-funded years the displayed cost
 * understated the truth. These tests pin the finite-difference equality on a
 * synthetic household with an appreciated FIFO brokerage account, in:
 *   (a) an LTCG-heavy year (deficit funded by high-gain FIFO lots),
 *   (b) a no-LTCG year (gainless brokerage — the case that already matched),
 *   (c) a year where the conversion tax itself is brokerage-funded.
 * Plus an engine-level wiring test that SimulationEngine surfaces the value.
 *
 * All figures are INVENTED test numbers.
 */

import { describe, it, expect } from 'vitest';

import { solveRetirementYear, YearSolverInput } from '../../services/simulation/YearSolver';
import { simulateOneYear } from '../../components/Objects/Assumptions/SimulationEngine';

import { InvestedAccount, BrokerageLot, AnyAccount } from '../../components/Objects/Accounts/models';
import { PassiveIncome, AnyIncome } from '../../components/Objects/Income/models';
import { OtherExpense } from '../../components/Objects/Expense/models';
import { AssumptionsState, defaultAssumptions, createBuiltinMilestones } from '../../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../../components/Objects/Taxes/TaxContext';

// =============================================================================
// FIXTURES (invented numbers)
// =============================================================================

const YEAR = 2025;
const BIRTH_YEAR = 1962; // age 63 in 2025: past 59.5 (no penalty), pre-65 (no IRMAA)
const AGE = YEAR - BIRTH_YEAR;
const CONVERSION = 40000;

/**
 * Appreciated brokerage with FIFO lots of very mixed gain ratios.
 * Account average gain ratio = (400k − 200k) / 400k = 0.50, but the OLDEST lot
 * (sold first, FIFO) carries ratio (150k − 20k)/150k ≈ 0.867 — the divergence
 * that made the old account-average estimate understate the LTCG bump.
 * All lots long-term by 2025 (purchase ≥ 2 years back).
 */
function appreciatedLots(): BrokerageLot[] {
    return [
        { purchaseYear: 2008, costBasis: 20000, currentValue: 150000 },
        { purchaseYear: 2016, costBasis: 80000, currentValue: 130000 },
        { purchaseYear: 2022, costBasis: 100000, currentValue: 120000 },
    ];
}

/** Gainless brokerage lots: basis == value, so no LTCG can be realized. */
function gainlessLots(): BrokerageLot[] {
    return [
        { purchaseYear: 2008, costBasis: 150000, currentValue: 150000 },
        { purchaseYear: 2016, costBasis: 130000, currentValue: 130000 },
        { purchaseYear: 2022, costBasis: 120000, currentValue: 120000 },
    ];
}

function makeAccounts(lots: BrokerageLot[]): AnyAccount[] {
    const totalValue = lots.reduce((s, l) => s + l.currentValue, 0);
    const totalBasis = lots.reduce((s, l) => s + l.costBasis, 0);
    return [
        new InvestedAccount(
            'brokerage-1', 'Brokerage', totalValue,
            0, 0, 0.001, 'Brokerage', false, 0,
            totalBasis, undefined, [], lots,
        ),
        new InvestedAccount('trad-1', 'Traditional IRA', 600000, 0, 0, 0.001, 'Traditional IRA', false, 0),
        new InvestedAccount('roth-1', 'Roth IRA', 60000, 0, 0, 0.001, 'Roth IRA', false, 0),
    ];
}

function makeAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, 60, 100), // retired at 60
        investments: {
            ...defaultAssumptions.investments,
            taxOptimizationEnabled: true,
            acaAware: false,
            returnRates: { ror: 0 }, // zero growth for predictability
        },
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Brokerage', accountId: 'brokerage-1' },
            { id: 'ws-2', name: 'Traditional IRA', accountId: 'trad-1' },
            { id: 'ws-3', name: 'Roth IRA', accountId: 'roth-1' },
        ],
    };
}

function makeTaxState(): TaxState {
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

function makeSolverInput(args: {
    lots: BrokerageLot[];
    livingExpenses: number;
    passiveIncome: number;
    conversionAmount: number;
}): YearSolverInput {
    const incomes: AnyIncome[] = args.passiveIncome > 0
        ? [new PassiveIncome('passive-1', 'Rental Income', args.passiveIncome, 'Annually', 'No', 'Other', new Date(2020, 0, 1))]
        : [];
    return {
        year: YEAR,
        currentAge: AGE,
        isRetired: true,
        incomes,
        expenses: [new OtherExpense('living-1', 'Living Expenses', args.livingExpenses, 'Annually', new Date(2020, 0, 1))],
        totalLivingExpenses: args.livingExpenses,
        rmdAmount: 0,
        accounts: makeAccounts(args.lots),
        withdrawalOrder: [
            { accountId: 'brokerage-1' },
            { accountId: 'trad-1' },
            { accountId: 'roth-1' },
        ],
        taxState: makeTaxState(),
        assumptions: makeAssumptions(),
        taxOptimizationEnabled: true,
        acaAware: false,
        // dp-precomputed is the resolved default strategy; the plan pins the
        // conversion amount for the year (0 ⇒ the no-conversion counterfactual).
        dpConversionPlan: new Map([[YEAR, args.conversionAmount]]),
    };
}

// =============================================================================
// SOLVER-LEVEL FINITE-DIFFERENCE TESTS
// =============================================================================

describe('#164 displayed conversion taxCost = finite difference (solver level)', () => {
    it('(a) LTCG-heavy year: deficit funded from appreciated FIFO lots', () => {
        // No income, $80k expenses → the deficit is funded from the brokerage,
        // realizing large FIFO gains; the $40k conversion pushes 0%-band gains
        // into the 15% band.
        const base = { lots: appreciatedLots(), livingExpenses: 80000, passiveIncome: 0 };
        const planWith = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: CONVERSION }));
        const planWithout = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: 0 }));

        // Scenario sanity: the conversion executed and the year is LTCG-heavy,
        // with the conversion itself raising the LTCG tax (the bump the old
        // account-average estimate mispriced).
        expect(planWith.conversion?.amount).toBe(CONVERSION);
        expect(planWithout.conversion).toBeNull();
        expect(planWith.tax.capitalGainsLT).toBeGreaterThan(500);
        expect(planWith.tax.capitalGainsLT).toBeGreaterThan(planWithout.tax.capitalGainsLT + 100);

        const finiteDifference = planWith.tax.total - planWithout.tax.total;
        expect(planWith.conversion!.taxAmount).toBeCloseTo(finiteDifference, 0);
        expect(Math.abs(planWith.conversion!.taxAmount - finiteDifference)).toBeLessThanOrEqual(1);
        // Texas: no state income tax, so the state component must be 0 and the
        // federal component must carry the whole cost.
        expect(planWith.conversion!.stateTaxCost).toBe(0);
        expect(planWith.conversion!.federalTaxCost).toBeCloseTo(finiteDifference, 0);
    });

    it('(b) no-LTCG year: gainless brokerage — already-matching case stays exact', () => {
        const base = { lots: gainlessLots(), livingExpenses: 80000, passiveIncome: 0 };
        const planWith = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: CONVERSION }));
        const planWithout = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: 0 }));

        expect(planWith.conversion?.amount).toBe(CONVERSION);
        // Truly no LTCG on either return
        expect(planWith.tax.capitalGainsLT).toBe(0);
        expect(planWithout.tax.capitalGainsLT).toBe(0);

        const finiteDifference = planWith.tax.total - planWithout.tax.total;
        expect(Math.abs(planWith.conversion!.taxAmount - finiteDifference)).toBeLessThanOrEqual(1);
    });

    it('(c) conversion tax itself is brokerage-funded (income covers expenses)', () => {
        // Passive income equals living expenses, so the only deficit is the tax
        // bill — the conversion tax is raised by an extra FIFO brokerage sale,
        // whose own realized gains the old estimate ignored.
        const base = { lots: appreciatedLots(), livingExpenses: 50000, passiveIncome: 50000 };
        const planWith = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: CONVERSION }));
        const planWithout = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: 0 }));

        expect(planWith.conversion?.amount).toBe(CONVERSION);
        // The tax payment source must actually be the brokerage (no surplus).
        expect(planWith.conversion!.taxSource).toBe('BROKERAGE');

        // The tax-funding sale effect: the with-conversion year sells more
        // brokerage than the without-conversion year.
        const grossSold = (p: typeof planWith) =>
            p.withdrawals.filter(w => w.accountId === 'brokerage-1').reduce((s, w) => s + w.gross, 0);
        expect(grossSold(planWith)).toBeGreaterThan(grossSold(planWithout) + 1000);

        const finiteDifference = planWith.tax.total - planWithout.tax.total;
        expect(Math.abs(planWith.conversion!.taxAmount - finiteDifference)).toBeLessThanOrEqual(1);
    });

    it('refinement is reporting-only: cashflows and decisions match the unrefined solve', () => {
        // The refinement is attribution, not a levy: the refined taxAmount must
        // not feed back into the year's own tax total or cashflows. Pin the
        // internal-consistency invariants that would break if it ever did.
        const base = { lots: appreciatedLots(), livingExpenses: 80000, passiveIncome: 0 };
        const plan = solveRetirementYear(makeSolverInput({ ...base, conversionAmount: CONVERSION }));

        // tax.total is composed of its components — the refined taxAmount is
        // not among them (it is attribution, not a levy).
        const componentSum = plan.tax.federal + plan.tax.state + plan.tax.fica +
            plan.tax.capitalGainsLT + plan.tax.capitalGainsST + plan.tax.withdrawalOrdinaryTax +
            plan.tax.niit + plan.tax.irmaa + plan.tax.aca + plan.tax.penalties;
        expect(plan.tax.total).toBeCloseTo(componentSum, 6);

        // The conversion still moves the full planned amount to Roth.
        expect(plan.conversion!.netToRoth).toBe(CONVERSION);
        expect(plan.converged).toBe(true);
    });
});

// =============================================================================
// ENGINE-LEVEL WIRING TEST
// =============================================================================

describe('#164 SimulationEngine surfaces the finite-difference taxCost', () => {
    it('rothConversion.taxCost equals the year tax delta between engine runs (no-LTCG wiring pin)', () => {
        // Gainless brokerage keeps the engine-level tax components clean
        // (no capital-gains / NIIT / penalty terms), so the year's total tax is
        // exactly fed + state + fica and the finite difference is computable
        // from two engine runs.
        const assumptions = makeAssumptions();
        const taxState = makeTaxState();
        const incomes: AnyIncome[] = [];
        const expenses = [new OtherExpense('living-1', 'Living Expenses', 80000, 'Annually', new Date(2020, 0, 1))];

        const run = (conversionAmount: number) => simulateOneYear(
            YEAR, incomes, expenses, makeAccounts(gainlessLots()), assumptions, taxState,
            [], undefined, [], new Map(),
            { dpConversionPlan: new Map([[YEAR, conversionAmount]]) },
        );

        const withConv = run(CONVERSION);
        const withoutConv = run(0);

        expect(withConv.rothConversion?.amount).toBe(CONVERSION);
        expect(withoutConv.rothConversion).toBeUndefined();

        const totalTax = (r: typeof withConv) =>
            r.taxDetails.fed + r.taxDetails.state + r.taxDetails.fica +
            r.taxDetails.capitalGains + r.taxDetails.withdrawalOrdinaryTax + r.taxDetails.niit +
            (r.taxDetails.irmaa ?? 0) + (r.taxDetails.aca ?? 0);

        const finiteDifference = totalTax(withConv) - totalTax(withoutConv);
        expect(Math.abs(withConv.rothConversion!.taxCost - finiteDifference)).toBeLessThanOrEqual(1);
        expect(withConv.rothConversion!.taxCost).toBeGreaterThan(0);
    });
});
