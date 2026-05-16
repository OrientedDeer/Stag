// src/components/Simulation/SimulationEngine.ts
// Thin orchestrator - delegates to focused service modules.

import { AnyAccount } from "../../Objects/Accounts/models";
import { AnyExpense, MortgageExpense, LoanExpense } from "../Expense/models";
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
import { InvestedAccount, SavedAccount } from "../Accounts/models";
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
        if (!account || !(account instanceof InvestedAccount || account instanceof SavedAccount)) {
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
    baselineProjections?: BaselineProjections,
    conversionMode: 'rate-match' | 'std-ded-only' = 'rate-match',
    dpConversionPlan?: Map<number, number>,
    dpDebugByYear?: Map<number, string[]>,
): SimulationYear {
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
    // LIFESTYLE CREEP (same as old engine)
    // ------------------------------------------------------------------
    let nextExpenses = milestoneFilteredExpenses.map(exp => exp.increment(assumptions));
    nextExpenses = applyLifestyleCreep(nextExpenses, milestoneFilteredIncomes, assumptions, year, isRetired, logs);

    // ------------------------------------------------------------------
    // CALCULATE EXPENSES
    // ------------------------------------------------------------------
    const totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0);

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
        year, accounts, allIncomes, assumptions, taxState,
        previousSimulation, currentAge, totalGrossIncome, preTaxDeductions,
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

    const solverInput: YearSolverInput = {
        year,
        currentAge,
        isRetired,
        incomes: allIncomes,
        expenses: nextExpenses,
        totalLivingExpenses,
        rmdAmount,
        accounts,
        withdrawalOrder: assumptions.withdrawalStrategy.map(w => ({ accountId: w.accountId })),
        taxState,
        assumptions,
        strategyResult: strategyWithdrawalResult,
        taxOptimizationEnabled: assumptions.investments.taxOptimizationEnabled,
        acaAware: currentAge < 65 && (assumptions.investments.acaAware !== false),
        previousSimulation: previousSimulation.map(s => ({ year: s.year, accounts: s.accounts })),
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
        inflowResult.esppLots, yearPlan.deficitDebtPayment, existingDeficitDebt,
        assumptions, year, returnOverride, logs
    );

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
    const totalTax = yearPlan.tax.total;

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
        .reduce((sum, w) => sum + w.tax, 0);
    const totalCashAvailable =
        spendableIncome
        + withdrawalState.totalWithdrawals
        - brokerageLTCGFromGross;
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
    // included. RMD-sourced PassiveIncomes are filtered inside the builder
    // since they're surfaced as withdrawals, not income.
    const cashflowDetail = buildCashflowDetail({
        incomes: allIncomes,
        expenses: nextExpenses,
        accounts: nextAccounts,
        insurance: totalInsuranceCost,
        year,
        brokerageLTCGFromGross,
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
            earlyWithdrawalPenalty: withdrawalState.withdrawalPenalties,
            longTermCapitalGains: withdrawalState.longTermCapitalGains,
        },
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
    baselineProjections?: BaselineProjections,
    conversionMode: 'rate-match' | 'std-ded-only' = 'rate-match',
    dpConversionPlan?: Map<number, number>,
    dpDebugByYear?: Map<number, string[]>,
): SimulationYear {
    return simulateOneYearWithNewEngine(
        year, incomes, expenses, accounts, assumptions, taxState,
        previousSimulation, returnOverride, previousActiveMilestones,
        previousMilestoneReachYears, baselineProjections, conversionMode,
        dpConversionPlan, dpDebugByYear,
    );
}
