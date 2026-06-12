/**
 * Full-horizon simulation benchmark (backlog B1/B2 perf work).
 *
 * Runs the REAL Monte Carlo hot path: `runSimulation` full-horizon (age 45 →
 * 95, ~50 simulated years) with per-trial yearly return overrides, exactly how
 * `MonteCarloEngine.runSingleScenario` drives the engine. The household is
 * deliberately rich so tax-parameter resolution and per-year account scans are
 * hot: work income with 401k + match, future Social Security, four investment/
 * savings accounts plus a goal sinking fund, a mortgage, a car loan, a
 * recurring long-term goal, California residency (state income tax), and
 * tax-optimized retirement withdrawals with Roth conversions (rate-match).
 *
 * Run with:  npx vitest bench --run src/__bench__/simulation.bench.ts
 * NOT picked up by `npx vitest run` / test:ci (only *.{test,spec}.* match the
 * test include glob; *.bench.* files are only matched in benchmark mode).
 *
 * Methodology notes (learned during the 2026-06 B1/B2 campaign):
 * - Each iteration rebuilds the household from scratch — the engine mutates
 *   account objects in place (RMD deduction, goal-fund credits), so reusing
 *   fixtures would change the workload run-over-run.
 * - One fixed seeded return sequence keeps every iteration on the same
 *   simulation trajectory across code versions.
 * - SEPARATE bench invocations drift ±20%+ on this machine (thermal/load),
 *   far above any candidate optimization. Never compare numbers from two
 *   different invocations. To A/B a code change, give the change a runtime
 *   toggle and add both variants as bench() entries in THIS file in
 *   order-symmetric A/B/B/A order (so JIT warmup and monotonic drift cancel),
 *   then compare the pooled A pair against the pooled B pair.
 * - For "how hot is function X" questions, prefer direct instrumentation
 *   (count calls + accumulate performance.now() self-time inside one run)
 *   over end-to-end deltas; it gives a hard ceiling on the possible win.
 *   Measured here: ~13ms/run total; getTaxParameters ≈ 300 calls ≈ 0.5ms
 *   (~3.5%) per run, so caching it cannot move the end-to-end number.
 */

import { bench, describe } from 'vitest';

import { runSimulation } from '../components/Objects/Assumptions/useSimulation';
import {
    AssumptionsState,
    defaultAssumptions,
    createBuiltinMilestones,
} from '../components/Objects/Assumptions/AssumptionsContext';
import { TaxState } from '../components/Objects/Taxes/TaxContext';
import { InvestedAccount, SavedAccount } from '../components/Objects/Accounts/models';
import { WorkIncome, FutureSocialSecurityIncome } from '../components/Objects/Income/models';
import {
    MortgageExpense,
    LoanExpense,
    FoodExpense,
    OtherExpense,
} from '../components/Objects/Expense/models';
import { SeededRandom } from '../services/RandomGenerator';

// ---------------------------------------------------------------------------
// Fixed parameters (deterministic across runs and code versions)
// ---------------------------------------------------------------------------

const BIRTH_YEAR = 1981;     // age 45 at a 2026 start
const RETIREMENT_AGE = 60;   // ~15 accumulation years, then decumulation
const LIFE_EXPECTANCY = 95;  // ~50 simulated years total
const YEARS_TO_RUN = 60;     // capped internally at life expectancy
const REFERENCE_DATE = new Date(2026, 0, 15); // fixed partial-year fraction

// One fixed return sequence shared by every iteration — mirrors a single
// Monte Carlo trial (percent units, e.g. 6.5 = 6.5%).
const YEARLY_RETURNS = new SeededRandom(42).generateReturns(YEARS_TO_RUN, 6.5, 12);

function createAssumptions(): AssumptionsState {
    return {
        ...defaultAssumptions,
        milestones: createBuiltinMilestones(BIRTH_YEAR, RETIREMENT_AGE, LIFE_EXPECTANCY),
        macro: {
            ...defaultAssumptions.macro,
            inflationRate: 2.6,
            inflationAdjusted: true, // exercises the bracket-inflation path
        },
        income: {
            ...defaultAssumptions.income,
            salaryGrowth: 3.0,
        },
        investments: {
            ...defaultAssumptions.investments,
            returnRates: { ror: 6.5 },
            withdrawalStrategy: 'Fixed Real',
            withdrawalRate: 4.0,
            taxOptimizationEnabled: true, // Roth conversions + tax-optimized withdrawals
            acaAware: true,
        },
        priorities: [
            { id: 'pb-1', name: 'Emergency fund', type: 'SAVINGS', accountId: 'acc-savings', capType: 'FIXED', capValue: 5000 },
            { id: 'pb-2', name: 'Brokerage', type: 'INVESTMENT', accountId: 'acc-brokerage', capType: 'REMAINDER' },
        ],
        withdrawalStrategy: [
            { id: 'ws-1', name: 'Savings', accountId: 'acc-savings' },
            { id: 'ws-2', name: 'Brokerage', accountId: 'acc-brokerage' },
            { id: 'ws-3', name: 'Traditional 401k', accountId: 'acc-401k' },
            { id: 'ws-4', name: 'Roth IRA', accountId: 'acc-roth' },
        ],
    };
}

function createTaxState(): TaxState {
    return {
        filingStatus: 'Married Filing Jointly',
        stateResidency: 'California', // state with a real income tax table
        deductionMethod: 'Standard',
        fedOverride: null,
        ficaOverride: null,
        stateOverride: null,
        year: 2026,
    };
}

function createAccounts() {
    const traditional401k = new InvestedAccount(
        'acc-401k', '401k', 450000,
        50000,  // employerBalance
        10,     // tenureYears
        0.04,   // expenseRatio
        'Traditional 401k',
        true,   // isContributionEligible
        0.2,    // vestedPerYear
        300000, // costBasis
    );
    const rothIRA = new InvestedAccount(
        'acc-roth', 'Roth IRA', 120000,
        0, 10, 0.04, 'Roth IRA', true, 0.2, 90000,
    );
    const brokerage = new InvestedAccount(
        'acc-brokerage', 'Brokerage', 300000,
        0, 10, 0.04, 'Brokerage', true, 0.2,
        180000, // costBasis → 40% gain ratio
    );
    const savings = new SavedAccount('acc-savings', 'Savings', 50000, 3.5);
    const roofFund = new SavedAccount('acc-roof-fund', 'Roof (fund)', 0, 0);
    return [traditional401k, rothIRA, brokerage, savings, roofFund];
}

function createIncomes() {
    const job = new WorkIncome(
        'inc-work', 'Job', 160000, 'Annually',
        'Yes',
        20000,  // pre-tax 401k
        3000,   // insurance
        0,      // Roth 401k
        8000,   // employer match
        'acc-401k',
        'Traditional 401k',
        'GROW_WITH_SALARY',
    );
    const futureSS = new FutureSocialSecurityIncome('inc-ss', 'Social Security', 67);
    return [job, futureSS];
}

function createExpenses() {
    const mortgage = new MortgageExpense(
        'exp-mortgage', 'Home', 'Monthly',
        600000,  // valuation
        320000,  // loan_balance
        400000,  // starting_loan_balance
        4.25,    // apr
        30,      // term_length
        1.1,     // property_taxes %
        0,       // valuation_deduction
        0.5,     // maintenance %
        250,     // utilities
        0.35,    // home_owners_insurance %
        0.5,     // pmi %
        50,      // hoa_fee
        'Yes', 0, '',
        new Date(2018, 5, 1),
    );
    const carLoan = new LoanExpense(
        'exp-car', 'Car Loan', 18000, 'Monthly',
        5.5, 'Compounding',
        450,    // monthly payment
        'No', 0, '',
        new Date(2024, 2, 1), new Date(2029, 2, 1),
    );
    const food = new FoodExpense('exp-food', 'Food', 1200, 'Monthly', new Date(2020, 0, 1));
    const travel = new OtherExpense('exp-travel', 'Travel', 8000, 'Annually', new Date(2020, 0, 1));
    travel.isDiscretionary = true;
    const roofGoal = new OtherExpense('exp-roof', 'Roof', 25000, 'Monthly', new Date(2025, 0, 1));
    roofGoal.goalType = 'recurring';
    roofGoal.intervalYears = 8;
    roofGoal.goalAccountId = 'acc-roof-fund';
    return [mortgage, carLoan, food, travel, roofGoal];
}

function runFullHorizon(): number {
    // Fresh objects every run: the engine mutates accounts in place (RMDs,
    // goal-fund credits) and increments incomes/expenses year-over-year.
    const timeline = runSimulation(
        YEARS_TO_RUN,
        createAccounts(),
        createIncomes(),
        createExpenses(),
        createAssumptions(),
        createTaxState(),
        YEARLY_RETURNS,
        REFERENCE_DATE,
    );
    return timeline.length;
}

// ---------------------------------------------------------------------------
// Sanity guard: a broken fixture (e.g. mistyped state name → undefined tax
// params → $0 tax) would still "benchmark" fine while measuring a much
// cheaper code path. Verify once, outside the timed loop, that the run is
// actually exercising what we think it is.
// ---------------------------------------------------------------------------
{
    const timeline = runSimulation(
        YEARS_TO_RUN, createAccounts(), createIncomes(), createExpenses(),
        createAssumptions(), createTaxState(), YEARLY_RETURNS, REFERENCE_DATE,
    );
    const simYears = timeline.filter(y => !y.isEndOfYearProjection);
    const lastYear = simYears[simYears.length - 1];
    const sawStateTax = simYears.some(y => (y.taxDetails.state ?? 0) > 0);
    const sawConversion = simYears.some(y => (y.rothConversion?.amount ?? 0) > 0);
    const sawWithdrawals = simYears.some(y => y.cashflow.withdrawals > 0);
    if (lastYear.year < BIRTH_YEAR + LIFE_EXPECTANCY - 1 || !sawStateTax || !sawConversion || !sawWithdrawals) {
        throw new Error(
            `Benchmark fixture is not exercising the intended hot path: ` +
            `lastYear=${lastYear.year}, stateTax=${sawStateTax}, ` +
            `conversion=${sawConversion}, withdrawals=${sawWithdrawals}`
        );
    }
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------

describe('SimulationEngine full-horizon (Monte Carlo hot path)', () => {
    bench(
        'runSimulation 50-year household trial',
        () => {
            runFullHorizon();
        },
        {
            warmupIterations: 15,
            warmupTime: 0,
            iterations: 250,
            time: 0,
        },
    );
});
