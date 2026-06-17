// src/components/Simulation/SimulationEngine.ts
// Thin orchestrator - delegates to focused service modules.

import { AnyAccount } from "../../Objects/Accounts/models";
import { AnyExpense, MortgageExpense, LoanExpense, isLongTermGoal, isGoalDueInYear, getGoalFundAnnualSetAside, goalEndsBeforeYear } from "../Expense/models";
import { AnyIncome, WorkIncome, PassiveIncome } from "../../Objects/Income/models";
import { AssumptionsState, getBirthYear, BUILTIN_MILESTONE_IDS } from "./AssumptionsContext";
import { TaxState } from "../../Objects/Taxes/TaxContext";
import * as TaxService from "../../Objects/Taxes/TaxService";

// Re-export types from the new module structure
export type { SimulationYear } from "../../../services/simulation/types";
import { SimulationYear, WithdrawalState, BaselineProjections } from "../../../services/simulation/types";

// Re-export helper for external consumers (e.g., RothConversionService tests)
export { calculateEffectiveConversionTax } from "../../../services/simulation/helpers";

// Import service modules
import { projectIncomes } from "../../../services/simulation/IncomeProjection";
import { processRMDs } from "../../../services/simulation/RMDService";
import { applyLifestyleCreep, calculateStrategyTarget, calculateTotalDiscretionary } from "../../../services/simulation/SpendingStrategy";
import { processDeficitDebt } from "../../../services/simulation/WithdrawalService";
import { processInflows, growAccounts } from "../../../services/simulation/AccountGrowth";
import { evaluateAllMilestones, isActiveByMilestone, MilestoneContext } from "../../../services/simulation/MilestoneEvaluator";
import { InvestedAccount, SavedAccount, ESPPAccount, RSUAccount } from "../Accounts/models";
import { processRSUVesting } from "../../../services/simulation/RSUVesting";
import { solveYear, YearSolverInput } from "../../../services/simulation/YearSolver";
import { YearPlan } from "../../../services/simulation/types";
import { buildCashflowDetail } from "../../../services/simulation/CashflowDetailBuilder";

// =============================================================================
// YearSolver-based simulation engine
// =============================================================================

/**
 * Execute a YearPlan by applying withdrawals and conversions to accounts.
 * This is Phase 3 of the new engine - mutations happen here.
 */
function executeYearPlan(
    plan: YearPlan,
    accounts: AnyAccount[],
    withdrawalState: WithdrawalState,
    logs: string[]
): { conversionDeposits: Record<string, number> } {
    const conversionDeposits: Record<string, number> = {};

    // Execute withdrawals
    for (const withdrawal of plan.withdrawals) {
        const account = accounts.find(a => a.id === withdrawal.accountId);
        if (!account || !(account instanceof InvestedAccount || account instanceof SavedAccount || account instanceof ESPPAccount || account instanceof RSUAccount)) {
            continue;
        }

        // Skip RMDs — RMDService.processRMDs() already deducted from the account and
        // recorded the totals. The RMD entry is in plan.withdrawals only as a tracking
        // record for the solver's iteration logic and consumers that filter by reason.
        if (withdrawal.reason === 'Required Minimum Distribution') {
            continue;
        }

        // Deduct from account (will be applied in growAccounts)
        withdrawalState.userInflows[account.id] =
            (withdrawalState.userInflows[account.id] || 0) - withdrawal.gross;

        withdrawalState.totalWithdrawals += withdrawal.gross;
        withdrawalState.withdrawalDetail[account.name] =
            (withdrawalState.withdrawalDetail[account.name] || 0) + withdrawal.gross;

        // Track capital gains from brokerage withdrawals
        if (withdrawal.capitalGains) {
            withdrawalState.longTermCapitalGains += withdrawal.capitalGains.longTerm;
            withdrawalState.shortTermCapitalGains += withdrawal.capitalGains.shortTerm;
        }

        // Track penalties
        withdrawalState.withdrawalPenalties += withdrawal.penalty;

        // Track Traditional withdrawals for tax calculations
        if (withdrawal.source === 'traditional_401k' || withdrawal.source === 'traditional_ira') {
            withdrawalState.traditionalWithdrawals += withdrawal.gross;
        }

        if (withdrawal.gross > 0) {
            logs.push(`[V2 exec] Withdrew $${withdrawal.gross.toLocaleString()} from ${withdrawal.accountName} (${withdrawal.reason})`);
        }
    }

    // Execute Roth conversion
    if (plan.conversion) {
        const sourceAccount = accounts.find(a => a.id === plan.conversion!.fromAccountId);
        const targetAccount = accounts.find(a => a.id === plan.conversion!.toAccountId);

        if (sourceAccount && targetAccount &&
            sourceAccount instanceof InvestedAccount && targetAccount instanceof InvestedAccount) {

            // Deduct from source (Traditional)
            withdrawalState.userInflows[sourceAccount.id] =
                (withdrawalState.userInflows[sourceAccount.id] || 0) - plan.conversion.amount;

            // Add to target (Roth) - userInflows drives the balance change,
            // conversionDeposits tracks conversion history in increment()
            withdrawalState.userInflows[targetAccount.id] =
                (withdrawalState.userInflows[targetAccount.id] || 0) + plan.conversion.netToRoth;
            conversionDeposits[targetAccount.id] = plan.conversion.netToRoth;

            logs.push(`[V2] Roth conversion: $${plan.conversion.amount.toLocaleString()} from ${sourceAccount.name} → ${targetAccount.name}`);;
        }
    }

    return { conversionDeposits };
}

/**
 * Convert YearPlan tax to withdrawal state format for compatibility.
 * Uses the split tax values from YearPlan:
 * - capitalGainsLT: tax from brokerage/ESPP withdrawals (have w.capitalGains)
 * - withdrawalOrdinaryTax: tax from Roth earnings (5-year rule), Traditional, HSA non-medical
 */
function updateWithdrawalStateFromPlan(
    plan: YearPlan,
    withdrawalState: WithdrawalState
): void {
    // Use the pre-split values from YearPlan.tax (computed by YearSolver)
    withdrawalState.capitalGainsTaxTotal = plan.tax.capitalGainsLT;
    withdrawalState.withdrawalOrdinaryTaxTotal = plan.tax.withdrawalOrdinaryTax;
    withdrawalState.withdrawalTaxes = plan.tax.total - plan.tax.fica;
}

/**
 * Long-term goals that are milestone-active this year AND carry a reserved
 * fund account — the shared gate for both the goal-funding (set-aside) and
 * goal-purchase (lump) loops. Expects the already milestone-filtered expense
 * list, so a goal gated by an inactive start/end milestone is neither funded
 * nor purchased. Loop-specific guards (due-year, recurring end date) stay
 * with their loops.
 */
function activeFundedGoals(milestoneFilteredExpenses: AnyExpense[]): AnyExpense[] {
    return milestoneFilteredExpenses.filter(e => isLongTermGoal(e) && !!e.goalAccountId);
}

/**
 * Per-year conversion-decision knobs for `simulateOneYear` /
 * `simulateOneYearWithNewEngine`. Bagged into one object (#99 follow-up to #97)
 * so the trailing optional Maps can't silently misalign positionally — two of
 * them (`dpConversionPlan`, `mcAdaptiveExpectedTrad`) share the
 * `Map<number, number>` type, so a positional swap would NOT be caught by the
 * type checker. Fed straight into YearSolverInput.
 */
export interface SimulateOneYearOptions {
    /** Per-year sub-sim baseline projections feeding the conversion ceiling. */
    baselineProjections?: BaselineProjections;
    /** Conversion-decision mode for the rate-match path. Default 'rate-match'. */
    conversionMode?: 'rate-match' | 'std-ded-only';
    dpConversionPlan?: Map<number, number>;
    dpDebugByYear?: Map<number, string[]>;
    /** #93 MC non-anticipative adaptive overlay: per-year expected start-of-year
     *  Traditional balance from the deterministic projection. MC path only;
     *  undefined in production. */
    mcAdaptiveExpectedTrad?: Map<number, number>;
}

/**
 * Simulate one year using the new YearSolver-based engine.
 *
 * This is the V2 engine that uses:
 * - Conversion-before-withdrawal ordering
 * - Algebraic gross-up formulas
 * - Convergence loop for bracket crossings
 */
function simulateOneYearWithNewEngine(
    year: number,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    previousSimulation: SimulationYear[] = [],
    returnOverride?: number,
    previousActiveMilestones: string[] = [],
    previousMilestoneReachYears: Map<string, number> = new Map(),
    options: SimulateOneYearOptions = {},
): SimulationYear {
    const {
        baselineProjections,
        conversionMode = 'rate-match',
        dpConversionPlan,
        dpDebugByYear,
        mcAdaptiveExpectedTrad,
    } = options;
    const logs: string[] = [];
    logs.push('[V2 Engine] Using new YearSolver-based simulation');

    // Calculate current age
    const currentAge = year - getBirthYear(assumptions.milestones);

    // ------------------------------------------------------------------
    // MILESTONE EVALUATION (same as old engine)
    // ------------------------------------------------------------------
    const milestoneContext: MilestoneContext = {
        accounts,
        expenses,
        year,
        age: currentAge,
        milestoneReachYears: previousMilestoneReachYears,
        filingStatus: taxState.filingStatus,
    };

    const milestoneResult = evaluateAllMilestones(
        assumptions.milestones || [],
        new Set(previousActiveMilestones),
        milestoneContext
    );

    const activeMilestoneSet = new Set(milestoneResult.activeMilestones);
    const isRetired = activeMilestoneSet.has(BUILTIN_MILESTONE_IDS.RETIRE);

    milestoneResult.newlyReached.forEach(event => {
        const milestone = assumptions.milestones?.find(m => m.id === event.milestoneId);
        if (milestone) {
            logs.push(`🎯 Milestone reached: "${milestone.name}" at age ${event.ageReached}`);
        }
    });

    const previousMilestoneSet = new Set(previousActiveMilestones);

    // ------------------------------------------------------------------
    // ROTH 401K → ROTH IRA ROLLOVER AT RETIREMENT
    // ------------------------------------------------------------------
    // Per IRS Notice 2014-54 and §402A(d)(4), a Roth 401k rolled into a Roth
    // IRA carries its contribution basis as Roth IRA regular contributions
    // (immediately tappable, no penalty) and earnings as Roth IRA earnings.
    // This eliminates the Roth 401k pro-rata distribution rule for retirees
    // and aligns with how the WithdrawalPlanner already orders Roth dollars
    // (contributions → conversions → earnings).
    const justRetired = isRetired && !previousMilestoneSet.has(BUILTIN_MILESTONE_IDS.RETIRE);
    if (justRetired) {
        accounts = accounts.map(acc => {
            if (acc instanceof InvestedAccount && acc.taxType === 'Roth 401k') {
                logs.push(`💸 Rolled over Roth 401k "${acc.name}" → Roth IRA at retirement (balance $${Math.round(acc.amount).toLocaleString()}, contributions $${Math.round(acc.regularContributions).toLocaleString()})`);
                return new InvestedAccount(
                    acc.id,
                    acc.name,
                    acc.amount,
                    acc.employerBalance,
                    acc.tenureYears,
                    acc.expenseRatio,
                    'Roth IRA',
                    acc.isContributionEligible,
                    acc.vestedPerYear,
                    acc.costBasis,
                    acc.customROR,
                    acc.conversionHistory,
                    acc.lots,
                );
            }
            return acc;
        });
    }

    // ------------------------------------------------------------------
    // FILTER INCOMES AND EXPENSES BY MILESTONE
    // ------------------------------------------------------------------
    const milestoneFilteredIncomes = incomes.filter(inc => {
        if (!isActiveByMilestone(inc.startMilestoneId, inc.endMilestoneId, activeMilestoneSet, previousMilestoneSet)) {
            return false;
        }
        if (isRetired && inc instanceof WorkIncome && !inc.endMilestoneId) {
            return false;
        }
        return true;
    });

    const milestoneFilteredExpenses = expenses.filter(exp =>
        isActiveByMilestone(exp.startMilestoneId, exp.endMilestoneId, activeMilestoneSet, previousMilestoneSet)
    );

    // ------------------------------------------------------------------
    // PROJECT INCOMES (same as old engine)
    // ------------------------------------------------------------------
    const incomeResult = projectIncomes(
        year, milestoneFilteredIncomes, accounts, assumptions, previousSimulation,
        currentAge, isRetired, logs
    );
    const { nextIncomes: incomesWithEarningsTest, allIncomes } = incomeResult;

    // ------------------------------------------------------------------
    // RSU VESTING
    // ------------------------------------------------------------------
    // Vest income is ordinary (W-2 supplemental) income — recognized here BEFORE
    // the tax solver so it feeds federal/state/FICA and the income breakdown.
    // Net-share lots are created in growAccounts (rsuLots); the withheld amount
    // is an estimated-tax prepayment subtracted from the year's tax owed.
    // Vesting reads the ORIGINAL incomes (pre-retirement-zeroing carries the RSU
    // config, so a grant keeps vesting after the salary ends).
    // The sim's base ("current") year — today, or last year in priorYearMode.
    // RSU FMV projection compounds currentSharePrice (TODAY's price) forward
    // from THIS year, so the base must be the current calendar year, not the
    // grant year. Mirrors the startYear computation in useSimulation.
    const currentSimYear =
        new Date().getFullYear() - (assumptions.demographics.priorYearMode ? 1 : 0);
    const rsuVestingResult = processRSUVesting(
        incomesWithEarningsTest, accounts, year, currentSimYear, logs
    );
    // Add vest income to allIncomes only — that array drives tax/FICA (via the
    // solver) and the income breakdown. It is NOT added to incomesWithEarningsTest
    // (the persisted income list) because vest income is regenerated fresh each
    // year from the schedule; projectIncomes filters prior-year RSU vest income
    // out at the top (same pattern as Interest/RMD synthetic incomes).
    allIncomes.push(...rsuVestingResult.vestIncomes);

    // ------------------------------------------------------------------
    // LIFESTYLE CREEP (same as old engine)
    // ------------------------------------------------------------------
    let nextExpenses = milestoneFilteredExpenses.map(exp => {
        const next = exp.increment(assumptions);
        // A goal's `amount` is its total cost, funded by a nominal fixed monthly
        // set-aside (and the budget computes that set-aside from the un-inflated
        // amount). Inflating the cost here would make the lump outgrow the fund
        // and silently underfund the purchase, so keep it static.
        if (isLongTermGoal(exp)) next.amount = exp.amount;
        return next;
    });
    nextExpenses = applyLifestyleCreep(nextExpenses, milestoneFilteredIncomes, assumptions, year, isRetired, logs);

    // ------------------------------------------------------------------
    // CALCULATE EXPENSES
    // ------------------------------------------------------------------
    // Long-term goal funding is COMMITTED, like any other expense — not a
    // surplus-allocation priority. Each year the goal's monthly set-aside
    // (derived live from the goal — $0 outside its saving window) is counted
    // with living expenses so the solver covers it like a bill (withdrawing in
    // retirement if needed), and the same dollars are credited into the goal's
    // reserved fund account after account growth — a forced transfer, immune
    // to priority ordering and surplus availability. Net worth is unchanged by
    // saving (cash out, fund up); it dips when the lump is spent in the due year.
    const goalFundCredits = new Map<string, number>(); // fund accountId → annual set-aside
    // Collect the unique fund accountIds from milestone-active goals only, so a
    // goal gated by an inactive start/end milestone is NOT funded (consistent
    // with how its set-aside is excluded from living expenses).
    const fundedGoals = activeFundedGoals(milestoneFilteredExpenses);
    const activeGoalFundIds = new Set(fundedGoals.map(e => e.goalAccountId!));
    for (const fundId of activeGoalFundIds) {
        // Months-prorated: a goal starting in June commits 7 months this year,
        // and the target year commits only the months before the target.
        // getGoalFundAnnualSetAside already SUMS the set-aside across every goal
        // on this account, so assign once — never += (that would double-count
        // when two goals share a fund account).
        const annual = getGoalFundAnnualSetAside(milestoneFilteredExpenses, fundId, year) ?? 0;
        if (annual > 0) goalFundCredits.set(fundId, annual);
    }
    const totalGoalFunding = [...goalFundCredits.values()].reduce((s, v) => s + v, 0);

    const totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0) + totalGoalFunding;

    // ------------------------------------------------------------------
    // WITHDRAWAL STRATEGY TARGET (for GK, Fixed Real, etc.)
    // ------------------------------------------------------------------
    const strategyWithdrawalResult = isRetired
        ? calculateStrategyTarget(accounts, assumptions, previousSimulation, year, currentAge, logs)
        : undefined;

    // ------------------------------------------------------------------
    // PROCESS RMDs
    // ------------------------------------------------------------------
    const totalGrossIncome = TaxService.getGrossIncome(allIncomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomesWithEarningsTest, year);

    const withdrawalState: WithdrawalState = {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        withdrawalOrdinaryTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome,
        traditionalWithdrawals: 0,
        longTermCapitalGains: 0,
        shortTermCapitalGains: 0,
        stateCapitalGainsTax: 0,
    };

    const rmdResult = processRMDs(
        year, accounts, assumptions,
        previousSimulation, currentAge, totalGrossIncome,
        withdrawalState, logs
    );

    const rmdDetails = rmdResult.rmdDetails;
    const rmdIncomes = rmdResult.rmdIncomes;
    const rmdAmount = rmdDetails?.totalWithdrawn || 0;

    // Add RMD incomes to allIncomes
    allIncomes.push(...rmdIncomes);

    // ------------------------------------------------------------------
    // CALL YEAR SOLVER (Phase 2)
    // ------------------------------------------------------------------
    // Calculate fixed vs discretionary expenses for GK budget handling
    const discretionaryExpenses = calculateTotalDiscretionary(nextExpenses, year);
    const fixedExpenses = totalLivingExpenses - discretionaryExpenses;

    // Legacy cleanup: goals used to create a savings-priority bucket and fund
    // from surplus. Funding now flows as a committed transfer (see
    // goalFundCredits above), so any remaining bucket pointing at a goal fund
    // is zeroed to prevent double-funding old data. Neutralized rather than
    // dropped: an empty bucket list trips the surplus allocator's
    // smart-default, which would refill the reserved fund anyway.
    const goalFundIds = new Set(
        expenses.filter(e => isLongTermGoal(e) && e.goalAccountId).map(e => e.goalAccountId!)
    );
    const effectiveAssumptions = goalFundIds.size > 0
        ? {
            ...assumptions,
            priorities: (assumptions.priorities || []).map(p =>
                p.accountId && goalFundIds.has(p.accountId)
                    ? { ...p, capType: 'FIXED' as const, capValue: 0 }
                    : p
            ),
        }
        : assumptions;

    const solverInput: YearSolverInput = {
        year,
        currentAge,
        isRetired,
        incomes: allIncomes,
        expenses: nextExpenses,
        totalLivingExpenses,
        rmdAmount,
        // RMD shortfall excise (25% of unmet required distribution) — solver folds
        // it into the year's tax/penalties so it reduces cash (Bug #4).
        rmdPenalty: rmdDetails?.penalty ?? 0,
        accounts,
        withdrawalOrder: assumptions.withdrawalStrategy.map(w => ({ accountId: w.accountId })),
        // Goal funds are reserved: funded directly via goalFundCredits, so the
        // surplus allocator must not pick them as general savings targets.
        reservedAccountIds: [...goalFundIds],
        taxState,
        assumptions: effectiveAssumptions,
        strategyResult: strategyWithdrawalResult,
        taxOptimizationEnabled: assumptions.investments.taxOptimizationEnabled,
        acaAware: currentAge < 65 && (assumptions.investments.acaAware !== false),
        previousSimulation: previousSimulation.map(s => ({ year: s.year, accounts: s.accounts, magi: s.magi })),
        // GK Guardrails: Pass budget and expense breakdown when strategy is active
        gkBudget: strategyWithdrawalResult?.amount,
        fixedExpenses,
        discretionaryExpenses,
        // Per-year sub-sim baseline projections. Used by the conversion ceiling
        // calculator so SS / pension / passive / Trad-balance at RMD come from a
        // forward sub-simulation that does only std-ded-headroom conversions —
        // rather than rough estimates or naive forward-compounding.
        baselineProjections,
        conversionMode,
        dpConversionPlan,
        dpDebugByYear,
        mcAdaptiveExpectedTrad,
    };

    const yearPlan = solveYear(solverInput);

    // Log decisions from solver (planning phase)
    yearPlan.decisions.forEach(d => {
        if (d.category === 'warning') {
            logs.push(`⚠️ ${d.description}`);
        } else if (d.category === 'conversion' || d.category === 'withdrawal') {
            // Always log conversion/withdrawal decisions (skip, reduce, execute)
            if (d.amount) {
                logs.push(`[V2 plan] ${d.category}: $${d.amount.toLocaleString()} - ${d.description}`);
            } else {
                logs.push(`[V2 plan] ${d.category}: ${d.description}`);
            }
        } else if (d.amount) {
            logs.push(`[V2 plan] ${d.category}: $${d.amount.toLocaleString()} - ${d.description}`);
        }
    });

    // ------------------------------------------------------------------
    // ADJUST EXPENSES FOR GK TRIMMING + BUILD STRATEGY ADJUSTMENT RESULT
    // ------------------------------------------------------------------
    // When GK guardrails trim discretionary spending, the solver uses a reduced
    // effectiveLivingExpenses but the expense objects still report full amounts.
    // Adjust discretionary expense objects so their getAnnualAmount() values
    // match the actual trimmed spending. This ensures downstream consumers
    // (like the Sankey chart) get consistent data without needing corrections.
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] = undefined;

    if (yearPlan.totalExpenses < totalLivingExpenses) {
        const trimAmount = totalLivingExpenses - yearPlan.totalExpenses;
        const totalDiscretionary = calculateTotalDiscretionary(nextExpenses, year);
        if (totalDiscretionary > 0) {
            const cutRatio = 1 - Math.min(trimAmount, totalDiscretionary) / totalDiscretionary;
            nextExpenses = nextExpenses.map(exp =>
                exp.isDiscretionary ? exp.adjustAmount(cutRatio) : exp
            );
        }

        // Populate strategyAdjustment so the UI can show warning banners.
        // This fires for any withdrawal strategy budget cap — including the first
        // retirement year where guardrailTriggered is 'none' (just the base 4% withdrawal).
        if (strategyWithdrawalResult) {
            strategyAdjustmentResult = {
                guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                requiredAdjustment: trimAmount,
                actualAdjustment: Math.min(trimAmount, totalDiscretionary),
                discretionaryAvailable: totalDiscretionary,
                warning: totalDiscretionary < trimAmount
                    ? `Fixed expenses exceed budget. Only $${totalDiscretionary.toLocaleString()} of $${trimAmount.toLocaleString()} could be cut.`
                    : undefined,
            };
        }
    } else if (strategyWithdrawalResult && strategyWithdrawalResult.guardrailTriggered === 'prosperity'
        && yearPlan.totalExpenses > totalLivingExpenses) {
        // Prosperity: solver increased spending above original expenses
        strategyAdjustmentResult = {
            guardrailTriggered: 'prosperity',
            requiredAdjustment: 0,
            actualAdjustment: yearPlan.totalExpenses - totalLivingExpenses,
            discretionaryAvailable: discretionaryExpenses,
        };
    }

    // ------------------------------------------------------------------
    // EXECUTE YEAR PLAN (Phase 3)
    // ------------------------------------------------------------------
    const { conversionDeposits } = executeYearPlan(yearPlan, accounts, withdrawalState, logs);
    updateWithdrawalStateFromPlan(yearPlan, withdrawalState);

    // ------------------------------------------------------------------
    // SURPLUS ALLOCATION (from YearPlan - computed by YearSolver)
    // ------------------------------------------------------------------
    // Track surplus allocations for Sankey display and account growth
    // Note: YearSolver already computed the allocations - we just apply them here
    const surplusBucketDetail: Record<string, number> = {};

    if (yearPlan.surplusAllocations.length > 0) {
        // Apply surplus allocations to withdrawal state (for account growth) and bucket detail (for Sankey)
        yearPlan.surplusAllocations.forEach(alloc => {
            logs.push(`[V2] Surplus allocated: $${alloc.amount.toLocaleString()} to ${alloc.reason}`);

            // Add to userInflows so growAccounts() will deposit the surplus
            withdrawalState.userInflows[alloc.accountId] =
                (withdrawalState.userInflows[alloc.accountId] || 0) + alloc.amount;

            // Track in bucket detail for Sankey display
            surplusBucketDetail[alloc.accountId] =
                (surplusBucketDetail[alloc.accountId] || 0) + alloc.amount;
        });
    }

    // Compute totalSurplusAllocations early so we can subtract it from trueUserSaved
    // (bucket allocations are counted separately, so they shouldn't also be in "invested")
    const totalSurplusAllocations = Object.values(surplusBucketDetail).reduce((sum, amt) => sum + amt, 0);

    // ------------------------------------------------------------------
    // DEFICIT DEBT TRACKING
    // ------------------------------------------------------------------
    // V2 path: Use unfundedDeficit from YearSolver to track when expenses
    // couldn't be covered by income + withdrawals (portfolio failure).
    // Pass as negative because processDeficitDebt expects negative = deficit.
    let discretionaryCash = -yearPlan.unfundedDeficit;
    const deficitDebtResult = processDeficitDebt(discretionaryCash, accounts, logs);
    const existingDeficitDebt = deficitDebtResult.existingDeficitDebt;
    discretionaryCash = deficitDebtResult.discretionaryCash;

    // ------------------------------------------------------------------
    // PROCESS INFLOWS (contributions, matching, etc.)
    // ------------------------------------------------------------------
    const inflowResult = processInflows(
        incomesWithEarningsTest, accounts, assumptions, year, withdrawalState,
        discretionaryCash, existingDeficitDebt, totalLivingExpenses, currentAge, logs
    );
    discretionaryCash = inflowResult.discretionaryCash;

    // ------------------------------------------------------------------
    // GROW ACCOUNTS (Phase 4)
    // ------------------------------------------------------------------
    const nextAccounts = growAccounts(
        accounts, nextExpenses, withdrawalState, conversionDeposits,
        inflowResult.esppLots, rsuVestingResult.rsuLots, yearPlan.deficitDebtPayment, existingDeficitDebt,
        assumptions, year, returnOverride, logs
    );

    // ------------------------------------------------------------------
    // LONG-TERM GOAL FUNDING (committed transfer)
    // The set-aside was counted with living expenses above (cash already left
    // the budget); deposit the same dollars into each goal's reserved fund so
    // it's a transfer, not spending. Credited after growth (no growth on the
    // current year's contributions), before the purchase check below so the
    // due year's own set-aside counts toward the lump.
    // ------------------------------------------------------------------
    for (const [fundId, annual] of goalFundCredits) {
        const fund = nextAccounts.find(a => a.id === fundId);
        if (!fund) continue;
        fund.amount += annual;
        logs.push(`🎯 Goal funding: set aside $${Math.round(annual).toLocaleString()} into "${fund.name}" (balance now $${Math.round(fund.amount).toLocaleString()})`);
    }

    // ------------------------------------------------------------------
    // LONG-TERM GOAL PURCHASES
    // In a goal's due year, spend the lump from its reserved sinking-fund
    // account. Net worth dips by what's available in the fund; recurring goals
    // keep accruing toward the next cycle afterward.
    // ------------------------------------------------------------------
    for (const exp of fundedGoals) {
        if (!isGoalDueInYear(exp, year)) continue;
        // Past a goal's type-aware end (a recurring goal's "stop replacing it"
        // date, or a targetDate target) we don't fire the lump — shared with the
        // funding cap / set-aside / active-list via goalEndsBeforeYear.
        if (goalEndsBeforeYear(exp, year)) continue;
        const fund = nextAccounts.find(a => a.id === exp.goalAccountId);
        if (!fund) continue;
        const spent = Math.min(fund.amount, exp.amount);
        fund.amount -= spent;
        logs.push(`🎯 Goal "${exp.name}" came due: spent $${Math.round(spent).toLocaleString()} from its fund (balance now $${Math.round(fund.amount).toLocaleString()})`);
    }

    // ------------------------------------------------------------------
    // BUILD ROTH CONVERSION RESULT (for output compatibility)
    // ------------------------------------------------------------------
    let rothConversionResult: SimulationYear['rothConversion'] = undefined;
    if (yearPlan.conversion) {
        const sourceAccount = accounts.find(a => a.id === yearPlan.conversion!.fromAccountId);
        const targetAccount = accounts.find(a => a.id === yearPlan.conversion!.toAccountId);

        if (sourceAccount && targetAccount) {
            rothConversionResult = {
                amount: yearPlan.conversion.amount,
                taxCost: yearPlan.conversion.taxAmount,
                federalTaxCost: yearPlan.conversion.federalTaxCost,
                stateTaxCost: yearPlan.conversion.stateTaxCost,
                taxAfter: yearPlan.tax.federal + yearPlan.conversion.taxAmount,
                fromAccounts: { [sourceAccount.name]: yearPlan.conversion.amount },
                toAccounts: { [targetAccount.name]: yearPlan.conversion.netToRoth },
                fromAccountIds: { [sourceAccount.id]: yearPlan.conversion.amount },
                toAccountIds: { [targetAccount.id]: yearPlan.conversion.netToRoth },
            };
        }
    }

    // ------------------------------------------------------------------
    // CALCULATE FINAL STATS
    // ------------------------------------------------------------------
    const totalInsuranceCost = incomesWithEarningsTest.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            return sum + inc.getProratedAnnual(inc.insurance, year);
        }
        return sum;
    }, 0);

    const postTaxDeductions = TaxService.getPostTaxExemptions(incomesWithEarningsTest, year);
    // RSU sell-to-cover withholding is an estimated-tax PREPAYMENT: the company
    // already remitted it (by selling the withholding slice of shares at vest), so
    // it offsets the cash tax due this year. Subtracting it from totalTax means a
    // vest whose withholding ≈ its marginal tax is cash-neutral, while a user who
    // lowers the rate sees the resulting shortfall reduce spendable cash.
    //
    // When the 37% sell-to-cover EXCEEDS actual tax (e.g. a post-retirement vest
    // year with little other income), the over-withholding is a genuine refund.
    // We floor totalTax at 0 (no phantom negative tax) AND return the excess as a
    // cash inflow (rsuWithholdingRefund) below, instead of clamping it away.
    const rsuWithholding = rsuVestingResult.totalWithholding;
    const totalTax = Math.max(0, yearPlan.tax.total - rsuWithholding);
    const rsuWithholdingRefund = Math.max(0, rsuWithholding - yearPlan.tax.total);

    // ------------------------------------------------------------------
    // SANKEY CASH ACCOUNTING (Fix A + Fix B + Fix C)
    // ------------------------------------------------------------------
    // Fix A: Use solver's spendable income (excludes reinvested dividends which aren't cash)
    // Fix B: Subtract bucket allocations (counted separately in Sankey outflows)
    // Fix C: Subtract the planner's LTCG tax baked into the brokerage gross-up.
    //
    // Sankey equation: inflows = outflows
    //   inflows = spendableIncome + withdrawals - brokerageLTCGFromGross
    //   outflows = expenses + taxes + invested + bucketAllocations + discretionary
    //
    // The solver's spendable income correctly excludes reinvested dividends (taxable but not cash).
    const spendableIncome = yearPlan.income.spendable;
    //
    // LTCG NOTE: planner's LTCG (sum of w.tax for brokerage/ESPP) is paid directly to the
    // government from the brokerage gross-up — it never reaches user cash. Subtracting it
    // here mirrors YearSolver Step F's `actualLTCGTax` subtraction in `cashIn`. Without this,
    // a phantom surplus equal to the LTCG tax appears in `trueUserSaved` (showing up as
    // "investedUser" during retirement years even when there's $0 income).
    //
    // When planner rate is 0% (low ordinary income) there's no gross-up, sum is 0, no
    // change. Auth LTCG in that case is captured by `unfundedDeficit` instead.
    const brokerageLTCGFromGross = yearPlan.withdrawals
        .filter(w => w.capitalGains !== undefined)
        .reduce((sum, w) => sum + (w.tax - (w.ordinaryTax ?? 0)), 0);
    const totalCashAvailable =
        spendableIncome
        + withdrawalState.totalWithdrawals
        - brokerageLTCGFromGross
        // Over-withholding from RSU sell-to-cover comes back as spendable cash
        // (a tax refund). totalTax is already floored at 0; this restores the
        // excess so it isn't silently lost.
        + rsuWithholdingRefund;
    const totalBucketAllocationsForSankey = totalSurplusAllocations + inflowResult.totalBucketAllocations;
    // Use solver's actual expenses (yearPlan.totalExpenses) which reflects GK budget trimming,
    // not the pre-trim totalLivingExpenses. Otherwise the Sankey equation is unbalanced when
    // GK cuts discretionary spending — withdrawals cover the trimmed amount but this formula
    // subtracts the full (untrimmed) expenses, creating a phantom negative "invested" amount.
    const actualLivingExpenses = yearPlan.totalExpenses;
    const trueUserSaved = totalCashAvailable - totalTax - totalInsuranceCost - actualLivingExpenses - discretionaryCash - totalBucketAllocationsForSankey;

    // Filter out RMD incomes from returned array
    const returnedIncomes = allIncomes.filter(inc =>
        !(inc instanceof PassiveIncome && inc.sourceType === 'RMD')
    );

    // ------------------------------------------------------------------
    // MERGE BUCKET DETAILS (surplus allocations + inflow allocations)
    // ------------------------------------------------------------------
    const mergedBucketDetail: Record<string, number> = { ...inflowResult.bucketDetail };
    for (const [accountId, amount] of Object.entries(surplusBucketDetail)) {
        mergedBucketDetail[accountId] = (mergedBucketDetail[accountId] || 0) + amount;
    }
    // Note: totalSurplusAllocations was already computed earlier for trueUserSaved calculation
    const totalBucketAllocations = inflowResult.totalBucketAllocations + totalSurplusAllocations;

    // ------------------------------------------------------------------
    // BUILD CASHFLOW DETAIL (for Sankey chart - avoids re-deriving
    // per-source income, contribution splits, mortgage breakdown, and
    // expense categories from scratch in the chart layer)
    // ------------------------------------------------------------------
    // Use allIncomes so reinvested interest (created in projectIncomes) is
    // included, and so RMD-sourced PassiveIncomes are surfaced as income (they
    // drain the Traditional account via userInflows but are not in
    // withdrawalDetail, so income is their single Sankey representation).
    const cashflowDetail = buildCashflowDetail({
        incomes: allIncomes,
        expenses: nextExpenses,
        accounts: nextAccounts,
        insurance: totalInsuranceCost,
        year,
        brokerageLTCGFromGross,
        employerInflows: withdrawalState.employerInflows,
    });

    // ------------------------------------------------------------------
    // RETURN SIMULATION YEAR
    // ------------------------------------------------------------------
    return {
        year,
        incomes: returnedIncomes,
        expenses: nextExpenses,
        accounts: nextAccounts,
        cashflow: {
            // Use spendableIncome for Sankey (excludes reinvested dividends which aren't cash)
            totalIncome: spendableIncome,
            totalExpense: actualLivingExpenses + totalTax + preTaxDeductions + postTaxDeductions,
            livingExpenses: actualLivingExpenses,
            discretionary: discretionaryCash,
            investedUser: trueUserSaved,
            investedMatch: inflowResult.totalEmployerMatch,
            totalInvested: trueUserSaved + inflowResult.totalEmployerMatch,
            bucketAllocations: totalBucketAllocations,
            bucketDetail: mergedBucketDetail,
            withdrawals: withdrawalState.totalWithdrawals,
            withdrawalDetail: withdrawalState.withdrawalDetail,
        },
        cashflowDetail,
        taxDetails: {
            fed: yearPlan.tax.federal + withdrawalState.withdrawalPenalties,
            state: yearPlan.tax.state,
            fica: yearPlan.tax.fica,
            preTax: preTaxDeductions - totalInsuranceCost,
            insurance: totalInsuranceCost,
            postTax: postTaxDeductions,
            capitalGains: withdrawalState.capitalGainsTaxTotal,
            withdrawalOrdinaryTax: withdrawalState.withdrawalOrdinaryTaxTotal,
            niit: yearPlan.tax.niit,
            irmaa: yearPlan.tax.irmaa,
            earlyWithdrawalPenalty: withdrawalState.withdrawalPenalties,
            longTermCapitalGains: withdrawalState.longTermCapitalGains,
        },
        magi: yearPlan.magi,
        logs,
        strategyWithdrawal: strategyWithdrawalResult,
        strategyAdjustment: strategyAdjustmentResult,
        rothConversion: rothConversionResult,
        rmdDetails,
        milestoneEvents: milestoneResult.newlyReached,
        activeMilestones: milestoneResult.activeMilestones,
        taxOptimizationTarget: yearPlan.taxOptimizationTarget,
    };
}

/**
 * Runs the simulation for a single timestep (1 year).
 * Takes "Year N" data and returns "Year N+1" data.
 *
 * ARCHITECTURE NOTE: Tax/Withdrawal Circular Dependency
 * =====================================================
 *
 * There is a circular dependency in tax calculation:
 *   Deficit → Withdrawals → LTCG → Tax → Deficit
 *
 * Current approach (Option B - Post-hoc correction):
 * - Calculate preliminary tax with LTCG=0 to estimate deficit
 * - Execute withdrawals, which determines actual LTCG/STCG from brokerage sales
 * - Recalculate final tax with actual LTCG/STCG
 * - Do NOT iterate — accept any shortfall/surplus in discretionary cash
 *
 * Tradeoffs:
 * - Shortfall: If LTCG triggers more tax than estimated (e.g., NIIT), the
 *   shortfall reduces discretionary cash or rolls to next year
 * - Magnitude: Typically <$1k/year; could be $5-10k in years with large
 *   brokerage liquidation
 * - Over full simulation: Total taxes are correct, just slightly misallocated
 *   between years
 *
 * TODO: Future SimulationEngine rewrite should consider:
 * 1. Iteration with convergence cap (max 3 passes, accept <$500 difference)
 * 2. Predictive LTCG estimation based on withdrawal plan before execution
 * 3. Full constraint-based solver that handles all circular dependencies
 *
 * Related issues this affects:
 * - NIIT calculation (3.8% on investment income when MAGI > $200k/$250k)
 * - LTCG stacking (LTCG rate depends on ordinary taxable income)
 * - SS torpedo (withdrawal amount affects SS taxability, but we handle this
 *   correctly since Traditional withdrawals are known before tax calc)
 */
export function simulateOneYear(
    year: number,
    incomes: AnyIncome[],
    expenses: AnyExpense[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    previousSimulation: SimulationYear[] = [],
    returnOverride?: number,
    previousActiveMilestones: string[] = [],
    previousMilestoneReachYears: Map<string, number> = new Map(),
    options: SimulateOneYearOptions = {},
): SimulationYear {
    return simulateOneYearWithNewEngine(
        year, incomes, expenses, accounts, assumptions, taxState,
        previousSimulation, returnOverride, previousActiveMilestones,
        previousMilestoneReachYears, options,
    );
}
