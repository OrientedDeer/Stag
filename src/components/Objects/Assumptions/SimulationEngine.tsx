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
import { getRMDStartAge } from "../../../data/RMDData";
import { executeRothConversions } from "../../../services/simulation/RothConversionService";
import { applyLifestyleCreep, calculateStrategyTarget, enforceSpendingCap, applyProsperitySpending, calculateTotalDiscretionary } from "../../../services/simulation/SpendingStrategy";
import { executeWithdrawals, processDeficitDebt, WithdrawalPlan } from "../../../services/simulation/WithdrawalService";
import { processInflows, growAccounts } from "../../../services/simulation/AccountGrowth";
import { evaluateAllMilestones, isActiveByMilestone, MilestoneContext } from "../../../services/simulation/MilestoneEvaluator";
import { planTaxOptimizedYear, TaxOptimizedYearPlan, AccountBalances, TaxOptimizationSettings, getAcaCliffThreshold } from "../../../services/simulation/TaxOptimizedWithdrawal";
import { ACAOptions, estimateFixedIncomeAtRMD } from "../../../services/simulation/helpers";
import { InvestedAccount, SavedAccount } from "../Accounts/models";
import { estimateWithdrawalTax } from "../../../services/simulation/WithdrawalTaxEstimation";
import { solveYear, YearSolverInput } from "../../../services/simulation/YearSolver";
import { YearPlan } from "../../../services/simulation/types";

// =============================================================================
// NEW ENGINE (V2) - YearSolver-based simulation
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
            logs.push(`[V2] Withdrew $${withdrawal.gross.toLocaleString()} from ${withdrawal.accountName} (${withdrawal.reason})`);
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

            // Add to target (Roth) - will be applied in growAccounts
            conversionDeposits[targetAccount.id] = plan.conversion.netToRoth;

            logs.push(`[V2] Roth conversion: $${plan.conversion.amount.toLocaleString()} from ${sourceAccount.name} → ${targetAccount.name}`);
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
    _baselineProjections?: BaselineProjections
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
    };

    const yearPlan = solveYear(solverInput);

    // Log decisions from solver
    yearPlan.decisions.forEach(d => {
        if (d.category === 'warning') {
            logs.push(`⚠️ ${d.description}`);
        } else if (d.amount) {
            logs.push(`[V2] ${d.category}: $${d.amount.toLocaleString()} - ${d.description}`);
        }
    });

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
        inflowResult.esppLots, inflowResult.deficitDebtPayment, existingDeficitDebt,
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
    // SANKEY CASH ACCOUNTING (Fix A + Fix B)
    // ------------------------------------------------------------------
    // Fix A: Use solver's spendable income (excludes reinvested dividends which aren't cash)
    // Fix B: Subtract bucket allocations (counted separately in Sankey outflows)
    //
    // Sankey equation: inflows = outflows
    //   inflows = spendableIncome + withdrawals
    //   outflows = expenses + taxes + invested + bucketAllocations + discretionary
    //
    // Note: totalGrossIncome includes reinvested dividends which are taxable but NOT cash.
    // The solver's spendable income correctly excludes these.
    const spendableIncome = yearPlan.income.spendable;
    const totalCashAvailable = spendableIncome + withdrawalState.totalWithdrawals;
    const totalBucketAllocationsForSankey = totalSurplusAllocations + inflowResult.totalBucketAllocations;
    const trueUserSaved = totalCashAvailable - totalTax - totalInsuranceCost - totalLivingExpenses - discretionaryCash - totalBucketAllocationsForSankey;

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
            totalExpense: totalLivingExpenses + totalTax + preTaxDeductions + postTaxDeductions,
            livingExpenses: totalLivingExpenses,
            discretionary: discretionaryCash,
            investedUser: trueUserSaved,
            investedMatch: inflowResult.totalEmployerMatch,
            totalInvested: trueUserSaved + inflowResult.totalEmployerMatch,
            bucketAllocations: totalBucketAllocations,
            bucketDetail: mergedBucketDetail,
            withdrawals: withdrawalState.totalWithdrawals,
            withdrawalDetail: withdrawalState.withdrawalDetail,
        },
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
        },
        logs,
        strategyWithdrawal: strategyWithdrawalResult,
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
    baselineProjections?: BaselineProjections
): SimulationYear {
    // ------------------------------------------------------------------
    // V2 ENGINE TOGGLE
    // When useNewEngine is enabled, use the new YearSolver-based engine
    // ------------------------------------------------------------------
    // DEBUG: Trace which engine is used (disabled)
    // if (year === 2027) { console.log(`>>> SimulationEngine year 2027: useNewEngine=${assumptions.simulation?.useNewEngine}`); }
    if (assumptions.simulation?.useNewEngine) {
        return simulateOneYearWithNewEngine(
            year, incomes, expenses, accounts, assumptions, taxState,
            previousSimulation, returnOverride, previousActiveMilestones,
            previousMilestoneReachYears, baselineProjections
        );
    }

    const logs: string[] = [];

    // Calculate current age
    const currentAge = year - getBirthYear(assumptions.milestones);

    // ------------------------------------------------------------------
    // MILESTONE EVALUATION (at start of year)
    // Milestones are evaluated first so we can determine retirement status
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

    // Retirement is determined by whether the RETIRE milestone has been reached
    // This allows retirement to be triggered by age, net worth, or any other condition
    const isRetired = activeMilestoneSet.has(BUILTIN_MILESTONE_IDS.RETIRE);

    // Log newly reached milestones
    milestoneResult.newlyReached.forEach(event => {
        const milestone = assumptions.milestones?.find(m => m.id === event.milestoneId);
        if (milestone) {
            logs.push(`🎯 Milestone reached: "${milestone.name}" at age ${event.ageReached}`);
        }
    });

    // Create set from previous milestones for END filtering
    // (items with end milestones continue through the year the milestone is reached)
    const previousMilestoneSet = new Set(previousActiveMilestones);

    // Filter incomes based on milestone state
    const milestoneFilteredIncomes = incomes.filter(inc => {
        // Check milestone-based filtering first
        // START uses current state, END uses previous state
        if (!isActiveByMilestone(inc.startMilestoneId, inc.endMilestoneId, activeMilestoneSet, previousMilestoneSet)) {
            return false;
        }
        // Safety net: Auto-stop WorkIncome at retirement if no endMilestoneId is set
        // (User-set endMilestoneId takes precedence via the check above)
        if (isRetired && inc instanceof WorkIncome && !inc.endMilestoneId) {
            return false;
        }
        return true;
    });

    // Filter expenses based on milestone state
    // START uses current state, END uses previous state
    const milestoneFilteredExpenses = expenses.filter(exp =>
        isActiveByMilestone(exp.startMilestoneId, exp.endMilestoneId, activeMilestoneSet, previousMilestoneSet)
    );

    // ------------------------------------------------------------------
    // 1. GROW INCOMES (The Physics of Money)
    // ------------------------------------------------------------------
    const incomeResult = projectIncomes(
        year, milestoneFilteredIncomes, accounts, assumptions, previousSimulation,
        currentAge, isRetired, logs
    );
    const { nextIncomes: incomesWithEarningsTest, allIncomes } = incomeResult;

    // ------------------------------------------------------------------
    // LIFESTYLE CREEP
    // ------------------------------------------------------------------
    let nextExpenses = milestoneFilteredExpenses.map(exp => exp.increment(assumptions));
    nextExpenses = applyLifestyleCreep(nextExpenses, milestoneFilteredIncomes, assumptions, year, isRetired, logs);

    // ------------------------------------------------------------------
    // WITHDRAWAL STRATEGY TARGET CALCULATION
    // ------------------------------------------------------------------
    let strategyWithdrawalResult = isRetired
        ? calculateStrategyTarget(accounts, assumptions, previousSimulation, year, currentAge, logs)
        : undefined;

    // ------------------------------------------------------------------
    // 2. TAXES & DEDUCTIONS (The Government)
    // ------------------------------------------------------------------
    let totalGrossIncome = TaxService.getGrossIncome(allIncomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomesWithEarningsTest, year);
    const postTaxDeductions = TaxService.getPostTaxExemptions(incomesWithEarningsTest, year);

    const totalInsuranceCost = incomesWithEarningsTest.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            return sum + inc.getProratedAnnual(inc.insurance, year);
        }
        return sum;
    }, 0);

    // Calculate preliminary living expenses (needed for estimated Traditional withdrawals)
    const preliminaryLivingExpenses = nextExpenses.reduce((sum, exp) => {
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0);

    const preliminaryReinvested = allIncomes
        .filter(inc => inc instanceof PassiveIncome && inc.isReinvested)
        .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

    // FICA tax is calculated on wages only - doesn't depend on withdrawals
    const ficaTax = TaxService.calculateFicaTax(taxState, allIncomes, year, assumptions);

    // Estimate withdrawals by walking the actual withdrawal order
    // This replaces the naive "assume all Traditional" estimate with accurate per-account-type math
    const taxWithoutWithdrawals = TaxService.calculateFederalTaxFromIncomes(taxState, allIncomes, nextExpenses, 0, year, assumptions);
    const preliminaryDeficitWithoutTax = preliminaryLivingExpenses + preliminaryReinvested - totalGrossIncome + preTaxDeductions + postTaxDeductions;
    const preliminaryDeficit = Math.max(0, preliminaryDeficitWithoutTax + taxWithoutWithdrawals);

    // Use actual withdrawal order to estimate tax impact per account type
    const withdrawalTaxEstimate = estimateWithdrawalTax(
        preliminaryDeficit,
        accounts,
        assumptions.withdrawalStrategy,
        currentAge,
        taxState.filingStatus,
        year
    );

    // Only Traditional withdrawals affect ordinary income and SS taxability
    const estimatedTraditionalWithdrawals = withdrawalTaxEstimate.breakdown.traditional;

    // Calculate PRELIMINARY taxes INCLUDING estimated Traditional withdrawals
    // This ensures SS taxability is calculated correctly
    let fedTax = TaxService.calculateFederalTaxFromIncomes(
        taxState, allIncomes, nextExpenses, estimatedTraditionalWithdrawals, year, assumptions
    );
    let stateTax = TaxService.calculateUnifiedStateTax(
        taxState, allIncomes, nextExpenses, estimatedTraditionalWithdrawals, year, assumptions
    );
    let totalTax = fedTax + stateTax + ficaTax;

    // ------------------------------------------------------------------
    // WITHDRAWAL TRACKING STATE
    // ------------------------------------------------------------------
    const withdrawalState: WithdrawalState = {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        withdrawalOrdinaryTaxTotal: 0,   // Tax from Roth earnings (5-year rule), Traditional, HSA non-medical
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome,
        traditionalWithdrawals: 0,       // Will be updated by executeWithdrawals
        longTermCapitalGains: 0,         // Will be updated by executeWithdrawals (brokerage/ESPP sales)
        shortTermCapitalGains: 0,        // Will be updated by executeWithdrawals (brokerage/ESPP sales)
        stateCapitalGainsTax: 0          // Will be updated by executeWithdrawals (state tax on cap gains)
    };

    // ------------------------------------------------------------------
    // REQUIRED MINIMUM DISTRIBUTIONS (before Roth conversions)
    // ------------------------------------------------------------------
    const rmdResult = processRMDs(
        year, accounts, allIncomes, assumptions, taxState,
        previousSimulation, currentAge, totalGrossIncome, preTaxDeductions,
        withdrawalState, logs
    );

    let rmdDetails = rmdResult.rmdDetails;
    const rmdIncomes = rmdResult.rmdIncomes;
    // Note: RMD tax is now handled by unified tax calculation, not incrementally
    totalGrossIncome = withdrawalState.totalGrossIncome;

    // Add RMD incomes to allIncomes so Roth conversion sees them
    allIncomes.push(...rmdIncomes);

    // ------------------------------------------------------------------
    // AUTO ROTH CONVERSIONS (during retirement)
    // When tax optimization is enabled, automatically perform conversions
    // Uses planTaxOptimizedYear to calculate optimal conversion amount
    // ------------------------------------------------------------------
    let rothConversionResult: SimulationYear['rothConversion'] = undefined;
    let conversionDeposits: Record<string, number> = {};
    let taxOptimizedPlan: TaxOptimizedYearPlan | undefined;
    let withdrawalPlan: WithdrawalPlan | undefined;
    // Track conversion tax that's withheld (not paid from cash) - this shouldn't affect discretionaryCash
    let withheldConversionTax = 0;

    // Do Roth conversions when tax optimization is enabled and person is retired
    const doRothConversions = assumptions.investments.taxOptimizationEnabled && isRetired;

    if (doRothConversions) {
        // Calculate preliminary deficit (expenses - income) for tax optimization planning
        const preliminaryLivingExpenses = nextExpenses.reduce((sum, exp) => {
            if (exp instanceof MortgageExpense) {
                return sum + exp.calculateAnnualAmortization(year).totalPayment;
            }
            if (exp instanceof LoanExpense) {
                return sum + exp.calculateAnnualAmortization(year).totalPayment;
            }
            return sum + exp.getAnnualAmount(year);
        }, 0);

        const preliminaryReinvested = allIncomes
            .filter(inc => inc instanceof PassiveIncome && inc.isReinvested)
            .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

        const preliminaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions
            - totalTax - preliminaryLivingExpenses - preliminaryReinvested;

        const deficit = preliminaryCash < 0 ? Math.abs(preliminaryCash) : 0;

        // Gather account balances by type
        const accountBalances: AccountBalances = {
            traditional: 0,
            roth: 0,
            brokerage: 0,
            savings: 0
        };

        for (const acc of accounts) {
            if (acc instanceof InvestedAccount) {
                const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
                const available = acc.amount + Math.min(0, priorOutflow);
                if (available <= 0) continue;

                if (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA') {
                    accountBalances.traditional += available;
                } else if (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA') {
                    accountBalances.roth += available;
                } else if (acc.taxType === 'Brokerage') {
                    accountBalances.brokerage += available;
                }
            } else if (acc instanceof SavedAccount) {
                accountBalances.savings += acc.amount;
            }
        }

        // Get federal tax parameters
        const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);

        // Calculate Social Security income for this year
        const ssIncome = TaxService.getSocialSecurityBenefits(allIncomes, year);

        // LTCG income for this year
        // Bug fix: Use 0 for planning purposes - we haven't decided what to sell yet
        // The actual LTCG will be calculated when we execute brokerage withdrawals
        // Using total unrealized gains was causing the LTCG bump zone to trigger incorrectly
        const ltcgIncome = 0;

        // RMD start age based on birth year (72, 73, or 75 under SECURE 2.0)
        const birthYear = getBirthYear(assumptions.milestones);
        const rmdStartAge = getRMDStartAge(birthYear);

        // Estimate fixed income (SS + pensions) at RMD age
        // This is the FALLBACK when baselineProjections is not available.
        // The function projects current values forward with COLA to RMD age.
        const futureSS = allIncomes.find(inc =>
            'className' in inc && inc.className === 'FutureSocialSecurityIncome'
        ) as { calculatedPIA?: number; claimingAge?: number } | undefined;

        const futureSS_PIA = futureSS?.calculatedPIA ?? 0;
        const ssClaimingAge = futureSS?.claimingAge ?? 67;

        // Current pension income (FERS, CSRS)
        const currentPensionIncome = allIncomes
            .filter(inc => 'className' in inc &&
                (inc.className === 'FERSPensionIncome' || inc.className === 'CSRSPensionIncome'))
            .reduce((sum, inc) => sum + (inc.getAnnualAmount?.(year) || 0), 0);

        // Current passive income (rental, dividends, etc.)
        const currentPassiveIncome = allIncomes
            .filter(inc => inc instanceof PassiveIncome && !inc.isReinvested)
            .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

        // inflationAdjusted=true means apply inflation/COLA effects
        // inflationAdjusted=false means no inflation/COLA (real dollars)
        const ssCola = assumptions.macro.inflationAdjusted
            ? 0.02  // Apply COLA when inflation is on
            : 0;    // No COLA when inflation is off

        const fixedIncomeProjection = estimateFixedIncomeAtRMD(
            ssIncome,
            futureSS_PIA,
            currentPensionIncome,
            currentAge,
            rmdStartAge,
            ssClaimingAge,
            ssCola,
            ssCola,  // Use same COLA for pensions (FERS COLA tracks inflation)
            currentPassiveIncome
        );

        const ssAtRMD = fixedIncomeProjection.ssAtRMD;
        const pensionIncomeAtRMD = fixedIncomeProjection.pensionAtRMD;
        const passiveIncomeAtRMD = fixedIncomeProjection.passiveAtRMD;

        // Tax optimization settings
        const settings: TaxOptimizationSettings = {
            enabled: true,
            acaSubsidyAware: currentAge < 65, // Enable ACA awareness for under-65
        };

        // Growth rate for projections
        const growthRate = (assumptions.investments.returnRates.ror || 6) / 100;

        // Call tax optimization planner
        if (fedParams) {
            // Get state tax parameters for accurate state tax calculations
            const stateParams = TaxService.getTaxParameters(
                year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions
            );

            // Build ACA options for under-65 retirees
            let acaOptions: ACAOptions | undefined;
            if (settings.acaSubsidyAware && currentAge < 65) {
                const filingType = taxState.filingStatus === 'Single' ? 'single' : 'married_filing_jointly';
                acaOptions = {
                    currentAge,
                    acaSubsidyAware: true,
                    acaCliffThreshold: getAcaCliffThreshold(filingType, year),
                    estimatedSubsidyLoss: 8000  // Conservative estimate of subsidy loss at cliff
                };
            }

            taxOptimizedPlan = planTaxOptimizedYear(
                deficit,
                accountBalances,
                currentAge,
                rmdStartAge,
                totalGrossIncome - ssIncome, // AGI excluding SS
                ssIncome,
                ltcgIncome,
                pensionIncomeAtRMD, // Pension income at RMD age (separate from SS)
                ssAtRMD, // SS income at RMD age (separate from pensions)
                passiveIncomeAtRMD, // Passive income at RMD age
                growthRate,
                fedParams,
                taxState,
                settings,
                stateParams,
                acaOptions,
                baselineProjections  // Two-pass optimization: use baseline projections if available
            );

            // Store withdrawal plan for later
            if (taxOptimizedPlan) {
                withdrawalPlan = taxOptimizedPlan.withdrawals;
                if (taxOptimizedPlan.conversionAmount > 0) {
                    logs.push(`📊 Tax Optimization: Phase=${taxOptimizedPlan.phase}, Conversion=$${taxOptimizedPlan.conversionAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
                }
            }
        }

        // Execute Roth conversion with pre-calculated amount from optimizer
        const preCalculatedAmount = taxOptimizedPlan?.conversionAmount;

        const convResult = executeRothConversions({
            accounts, allIncomes, nextExpenses, year, assumptions, taxState,
            previousSimulation, totalGrossIncome, preTaxDeductions, postTaxDeductions,
            totalTax, currentAge, withdrawalState
        }, logs, preCalculatedAmount);

        rothConversionResult = convResult.rothConversionResult;
        conversionDeposits = convResult.conversionDeposits;
        fedTax += convResult.fedTaxIncrease;
        stateTax += convResult.stateTaxIncrease;
        totalTax = fedTax + stateTax + ficaTax;

        // NOTE: We do NOT add conversion amount to totalGrossIncome.
        // Roth conversions are NOT spendable income - they're inter-account transfers.
        // The conversion tax is handled differently based on taxPaymentSource:
        //   - SAVINGS/BROKERAGE: Tax is paid from a withdrawal (included in totalWithdrawals)
        //   - WITHHOLD: Tax is withheld from the conversion itself (not a cash expense)
        // When WITHHOLD, we track the withheld tax to exclude from discretionaryCash.
        if (taxOptimizedPlan?.taxPaymentSource === 'WITHHOLD') {
            withheldConversionTax = convResult.fedTaxIncrease + convResult.stateTaxIncrease;
        }
    }

    // ------------------------------------------------------------------
    // 3. LIVING EXPENSES (The Bills)
    // ------------------------------------------------------------------
    let totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
        if (exp instanceof MortgageExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        if (exp instanceof LoanExpense) {
            return sum + exp.calculateAnnualAmortization(year).totalPayment;
        }
        return sum + exp.getAnnualAmount(year);
    }, 0);

    // 4. CASHFLOW (The Wallet)
    const reinvestedIncome = allIncomes
        .filter(inc => inc instanceof PassiveIncome && inc.isReinvested)
        .reduce((sum, inc) => sum + inc.getAnnualAmount(year), 0);

    // Withheld conversion tax is NOT a cash expense (it's taken from the conversion itself)
    // so we add it back to get the actual cash-based discretionary amount
    let discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome + withheldConversionTax;

    // ------------------------------------------------------------------
    // SPENDING CAPS (all strategies: GK, Fixed Real, Percentage)
    // ------------------------------------------------------------------
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] = undefined;

    if (strategyWithdrawalResult && discretionaryCash < 0) {
        const capResult = enforceSpendingCap(
            nextExpenses, strategyWithdrawalResult, discretionaryCash,
            totalGrossIncome, preTaxDeductions, postTaxDeductions, totalTax, reinvestedIncome,
            year, assumptions, logs
        );
        nextExpenses = capResult.nextExpenses;
        totalLivingExpenses = capResult.totalLivingExpenses;
        discretionaryCash = capResult.discretionaryCash;
        strategyAdjustmentResult = capResult.strategyAdjustmentResult;
    }

    // ------------------------------------------------------------------
    // PROSPERITY SPENDING (Budget Surplus)
    // When budget target exceeds current expenses, increase discretionary spending
    // Only applies to actual strategies (not 'None' or 'Needs Based')
    // Any surplus beyond what we can increase discretionary to flows naturally
    // through positive discretionaryCash to investments.
    // ------------------------------------------------------------------
    if (isRetired && strategyWithdrawalResult && discretionaryCash > 0 &&
        assumptions.investments.withdrawalStrategy !== 'None' &&
        assumptions.investments.withdrawalStrategy !== 'Needs Based') {

        const budgetTarget = strategyWithdrawalResult.amount;
        const prosperityResult = applyProsperitySpending(
            nextExpenses, totalLivingExpenses, budgetTarget, year, logs
        );

        if (prosperityResult.prosperityApplied) {
            nextExpenses = prosperityResult.adjustedExpenses;

            // Recalculate living expenses after prosperity increase
            totalLivingExpenses = nextExpenses.reduce((sum, exp) => {
                if (exp instanceof MortgageExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                if (exp instanceof LoanExpense) {
                    return sum + exp.calculateAnnualAmortization(year).totalPayment;
                }
                return sum + exp.getAnnualAmount(year);
            }, 0);

            // Recalculate discretionary cash with increased expenses
            discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;

            // Track the prosperity adjustment for the UI
            if (!strategyAdjustmentResult) {
                strategyAdjustmentResult = {
                    guardrailTriggered: strategyWithdrawalResult.guardrailTriggered,
                    requiredAdjustment: 0,
                    actualAdjustment: budgetTarget - totalLivingExpenses,
                    discretionaryAvailable: 0,
                };
            }
        }
        // Note: Any surplus beyond discretionary increases (surplusToInvest)
        // flows naturally through positive discretionaryCash to investments.
    }

    // ------------------------------------------------------------------
    // WITHDRAWAL LOGIC (Deficit Manager)
    // If tax optimization provided a withdrawal plan, use it; otherwise use default logic
    // ------------------------------------------------------------------

    const withdrawalResult = executeWithdrawals(
        discretionaryCash, accounts, assumptions, taxState, year, currentAge,
        preTaxDeductions, withdrawalState, rothConversionResult, isRetired, logs,
        withdrawalPlan // Pass tax-optimized withdrawal plan if available
    );
    discretionaryCash = withdrawalResult.discretionaryCash;

    // ------------------------------------------------------------------
    // UNIFIED TAX CALCULATION (after all withdrawals are known)
    // ------------------------------------------------------------------
    //
    // ARCHITECTURAL NOTE: Tax → Withdrawal → LTCG → Tax Circular Dependency
    // =====================================================================
    // There's an inherent circular dependency in tax-aware withdrawals:
    //   1. We need to know tax to determine how much to withdraw
    //   2. Withdrawals (especially from brokerage) generate capital gains
    //   3. Capital gains affect SS taxability and total tax
    //   4. This changes how much we should have withdrawn (go to step 1)
    //
    // The current architecture handles this with a "best effort" approach:
    //   - Preliminary tax estimate uses calculateUnifiedFederalTax (no cap gains)
    //   - Withdrawals are executed with piecemeal cap gains tax for gross-up
    //   - FINAL tax is calculated post-hoc with actual LTCG/STCG via
    //     calculateTotalFederalTax, which is the SOURCE OF TRUTH for federal tax
    //
    // This means:
    //   - The final tax number IS CORRECT for the withdrawals that occurred
    //   - We may have over-withdrawn if preliminary underestimated tax
    //   - We do NOT iterate to convergence (acceptable approximation)
    //
    // FUTURE REWRITE: Use calculateTotalFederalTax from the start with an
    // iterative solver that converges on the correct withdrawal + tax amounts.
    // ------------------------------------------------------------------

    const totalAdditionalOrdinaryIncome =
        withdrawalState.traditionalWithdrawals +           // Traditional IRA/401k withdrawals
        (rothConversionResult?.amount || 0) +              // Roth conversions
        (rmdDetails?.totalWithdrawn || 0);                 // RMD distributions

    // Get base income components for calculateTotalFederalTax
    const baseGrossIncome = TaxService.getGrossIncome(allIncomes, year);
    const ssIncome = TaxService.getSocialSecurityBenefits(allIncomes, year);
    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);

    // Calculate federal tax using calculateTotalFederalTax - the SOURCE OF TRUTH
    // This properly handles:
    //   - SS taxability with LTCG/STCG included in provisional income
    //   - STCG taxed as ordinary income
    //   - LTCG stacked on top of ordinary income for bracket determination
    //   - NIIT (3.8% on investment income above threshold)
    let niitTax = 0;  // Track NIIT separately for reporting (included in fedTax total)
    if (fedParams && taxState.fedOverride === null) {
        // Ordinary income = base income - SS + Traditional withdrawals + Roth conversions + RMDs
        // (SS is passed separately for taxability calculation)
        const ordinaryIncome = baseGrossIncome - ssIncome + totalAdditionalOrdinaryIncome;

        const federalTaxResult = TaxService.calculateTotalFederalTax(
            ordinaryIncome,
            ssIncome,
            withdrawalState.shortTermCapitalGains,
            withdrawalState.longTermCapitalGains,
            preTaxDeductions,
            taxState.filingStatus,
            fedParams
        );

        fedTax = federalTaxResult.totalTax;
        niitTax = federalTaxResult.niitTax;  // Extract for reporting
    } else if (taxState.fedOverride !== null) {
        fedTax = taxState.fedOverride;
    } else {
        // Fallback when no federal params available
        fedTax = TaxService.calculateFederalTaxFromIncomes(
            taxState, allIncomes, nextExpenses, totalAdditionalOrdinaryIncome, year, assumptions
        );
    }

    // State tax: use unified calculation for ordinary income
    // State capital gains tax was calculated during withdrawals and tracked separately
    stateTax = TaxService.calculateUnifiedStateTax(
        taxState, allIncomes, nextExpenses, totalAdditionalOrdinaryIncome, year, assumptions
    );

    // Final tax assembly:
    // - fedTax: from calculateTotalFederalTax (includes ordinary tax + LTCG tax + NIIT)
    // - stateTax: from calculateUnifiedStateTax (ordinary income only)
    // - stateCapitalGainsTax: tracked during withdrawals (state tax on LTCG/STCG)
    // - ficaTax: FICA on wages
    // - withdrawalPenalties: 10% early withdrawal penalty
    //
    // NOTE: We do NOT add withdrawalState.capitalGainsTaxTotal here because:
    //   - Federal portion is now included in fedTax via calculateTotalFederalTax
    //   - State portion is tracked separately in stateCapitalGainsTax
    //   - capitalGainsTaxTotal is retained only for withdrawal gross-up calculations
    totalTax = fedTax + stateTax + withdrawalState.stateCapitalGainsTax + ficaTax + withdrawalState.withdrawalPenalties;

    // Update gross income for tax reporting (includes Traditional withdrawals as taxable income)
    const totalGrossIncomeForTax = TaxService.getGrossIncome(allIncomes, year) + totalAdditionalOrdinaryIncome;

    // For discretionary cash calculation, use ONLY external income sources (not withdrawals from own accounts)
    // Withdrawals are accounted for separately via totalWithdrawals
    // This avoids double-counting Traditional withdrawals which are in BOTH totalAdditionalOrdinaryIncome AND totalWithdrawals
    //
    // IMPORTANT: Roth conversions are NOT spending income - they're just inter-account transfers.
    // The conversion is taxable, but how the tax is paid affects cash flow:
    //   - SAVINGS/BROKERAGE: Tax is paid from a withdrawal (included in totalWithdrawals)
    //   - WITHHOLD: Tax is withheld from the conversion itself (NOT a cash expense)
    // For example with SAVINGS tax source: $60k expenses + $10k conversion tax = $70k needed
    //   - Withdraw $70k from brokerage (goes into totalWithdrawals)
    //   - $60k covers expenses, $10k pays the conversion tax
    //   - discretionaryCash = 0 - 10k - 60k + 70k = 0 (correct)
    // For example with WITHHOLD: $60k expenses, $10k conversion tax withheld
    //   - Withdraw $60k from brokerage (just for expenses)
    //   - discretionaryCash = 0 - 10k - 60k + 60k + 10k = 0 (correct, withheldTax added back)
    const externalIncome = TaxService.getGrossIncome(allIncomes, year);
    discretionaryCash = externalIncome - preTaxDeductions - postTaxDeductions
        - totalTax - totalLivingExpenses - reinvestedIncome
        + withdrawalState.totalWithdrawals  // Add withdrawals (Traditional, Roth, brokerage, savings)
        + withheldConversionTax;  // Withheld tax isn't a cash expense

    // ------------------------------------------------------------------
    // BINARY SEARCH FOR ADDITIONAL WITHDRAWAL (if unified tax created a residual deficit)
    // This handles cases where penalties/taxes in the unified calculation
    // were higher than the preliminary estimate. We binary search for the
    // exact gross withdrawal that nets the residual deficit after taxes/penalties.
    //
    // IMPORTANT: When a tax-optimized plan exists, we respect its withdrawal strategy.
    // - BROKERAGE_AVAILABLE/TRANSITION: Use brokerage (capital gains tax, no 10% penalty)
    // - BROKERAGE_DEPLETED: Use Roth (tax-free)
    // - ROTH_DEPLETED or no plan: Use Traditional (ordinary income + 10% penalty if early)
    // ------------------------------------------------------------------
    if (discretionaryCash < -0.005) {
        const residualDeficit = Math.abs(discretionaryCash);

        // Determine which account type to use for residual withdrawals based on the plan
        // Priority: brokerage > roth > traditional (matching tax optimization phases)
        const useBrokerageForResidual = withdrawalPlan && withdrawalPlan.brokerage > 0 && withdrawalPlan.traditional === 0;
        const useRothForResidual = !useBrokerageForResidual && withdrawalPlan && withdrawalPlan.roth > 0 && withdrawalPlan.traditional === 0;

        // Binary search for the gross withdrawal amount that nets exactly the residual
        // After taxes and penalties, we need: gross - tax(gross) - penalty(gross) = residualDeficit
        let low = residualDeficit;  // Minimum: assumes 0% effective rate
        let high = residualDeficit * 3;  // Maximum: assumes ~67% effective rate (rare edge case)
        let bestGross = residualDeficit;

        // Save current state to restore for each binary search iteration
        const baseTraditionalWithdrawals = withdrawalState.traditionalWithdrawals;
        const baseTotalWithdrawals = withdrawalState.totalWithdrawals;
        const basePenalties = withdrawalState.withdrawalPenalties;
        const baseStateCapGainsTax = withdrawalState.stateCapitalGainsTax;
        const baseLTCG = withdrawalState.longTermCapitalGains;

        // For brokerage, estimate gain ratio from first brokerage account
        let estimatedGainRatio = 0.5;  // Default 50% gains
        if (useBrokerageForResidual) {
            const brokerageAcc = accounts.find(acc =>
                acc instanceof InvestedAccount && acc.taxType === 'Brokerage'
            ) as InvestedAccount | undefined;
            if (brokerageAcc && brokerageAcc.amount > 0) {
                const costBasis = brokerageAcc.costBasis ?? brokerageAcc.amount;
                estimatedGainRatio = Math.max(0, (brokerageAcc.amount - costBasis) / brokerageAcc.amount);
            }
        }

        for (let i = 0; i < 20 && (high - low) > 0.01; i++) {
            const mid = (low + high) / 2;

            // Calculate what the total tax would be if we withdrew 'mid' more
            let testTraditionalWithdrawals = baseTraditionalWithdrawals;
            let testLTCG = baseLTCG;
            let testStateCapGainsTax = baseStateCapGainsTax;
            let testPenalty = 0;

            if (useBrokerageForResidual) {
                // Brokerage withdrawal: generates capital gains, no 10% penalty
                const additionalGains = mid * estimatedGainRatio;
                testLTCG = baseLTCG + additionalGains;
                // Estimate state cap gains tax (typically ~5%)
                testStateCapGainsTax = baseStateCapGainsTax + additionalGains * 0.05;
            } else if (useRothForResidual) {
                // Roth withdrawal: tax-free (contributions and qualified earnings)
                // No additional tax, no penalty (assuming contributions available)
            } else {
                // Traditional withdrawal: ordinary income + 10% penalty if under 59.5
                testTraditionalWithdrawals = baseTraditionalWithdrawals + mid;
                testPenalty = currentAge < 59.5 ? mid * 0.10 : 0;
            }

            const testAdditionalOrdinaryIncome =
                testTraditionalWithdrawals +
                (rothConversionResult?.amount || 0) +
                (rmdDetails?.totalWithdrawn || 0);

            // Calculate federal tax using calculateTotalFederalTax (the source of truth)
            let testFedTax = 0;
            if (fedParams && taxState.fedOverride === null) {
                const testOrdinaryIncome = baseGrossIncome - ssIncome + testAdditionalOrdinaryIncome;
                const testResult = TaxService.calculateTotalFederalTax(
                    testOrdinaryIncome,
                    ssIncome,
                    withdrawalState.shortTermCapitalGains,
                    testLTCG,
                    preTaxDeductions,
                    taxState.filingStatus,
                    fedParams
                );
                testFedTax = testResult.totalTax;
            } else {
                testFedTax = TaxService.calculateFederalTaxFromIncomes(
                    taxState, allIncomes, nextExpenses, testAdditionalOrdinaryIncome, year, assumptions
                );
            }

            const testStateTax = TaxService.calculateUnifiedStateTax(
                taxState, allIncomes, nextExpenses, testAdditionalOrdinaryIncome, year, assumptions
            );

            // Federal tax now includes LTCG tax and NIIT via calculateTotalFederalTax
            const testTotalTax = testFedTax + testStateTax + testStateCapGainsTax + ficaTax + basePenalties + testPenalty;

            // Calculate what discretionary cash would be with this withdrawal
            const testDiscretionaryCash = externalIncome - preTaxDeductions - postTaxDeductions
                - testTotalTax - totalLivingExpenses - reinvestedIncome
                + baseTotalWithdrawals + mid;

            if (Math.abs(testDiscretionaryCash) < 0.005) {
                // Found exact match
                bestGross = mid;
                break;
            }

            if (testDiscretionaryCash < 0) {
                // Still in deficit, need more withdrawal
                low = mid;
            } else {
                // Surplus, need less withdrawal
                high = mid;
                bestGross = mid;
            }
        }

        // Execute the calculated withdrawal with a plan that matches the original strategy
        if (bestGross > 0.01) {
            let residualPlan: WithdrawalPlan | undefined;
            if (useBrokerageForResidual) {
                residualPlan = { traditional: 0, roth: 0, brokerage: bestGross, savings: 0 };
            } else if (useRothForResidual) {
                residualPlan = { traditional: 0, roth: bestGross, brokerage: 0, savings: 0 };
            }
            // Otherwise residualPlan stays undefined → use default (Traditional)

            executeWithdrawals(
                -bestGross, accounts, assumptions, taxState, year, currentAge,
                preTaxDeductions, withdrawalState, rothConversionResult, isRetired, logs,
                residualPlan
            );

            // Recalculate unified tax with final withdrawals
            const finalAdditionalOrdinaryIncome =
                withdrawalState.traditionalWithdrawals +
                (rothConversionResult?.amount || 0) +
                (rmdDetails?.totalWithdrawn || 0);

            // Recalculate federal tax using calculateTotalFederalTax (the source of truth)
            if (fedParams && taxState.fedOverride === null) {
                const finalOrdinaryIncome = baseGrossIncome - ssIncome + finalAdditionalOrdinaryIncome;
                const finalResult = TaxService.calculateTotalFederalTax(
                    finalOrdinaryIncome,
                    ssIncome,
                    withdrawalState.shortTermCapitalGains,
                    withdrawalState.longTermCapitalGains,
                    preTaxDeductions,
                    taxState.filingStatus,
                    fedParams
                );
                fedTax = finalResult.totalTax;
                niitTax = finalResult.niitTax;  // Update for reporting
            } else {
                fedTax = TaxService.calculateFederalTaxFromIncomes(
                    taxState, allIncomes, nextExpenses, finalAdditionalOrdinaryIncome, year, assumptions
                );
            }

            stateTax = TaxService.calculateUnifiedStateTax(
                taxState, allIncomes, nextExpenses, finalAdditionalOrdinaryIncome, year, assumptions
            );
            // Federal tax now includes LTCG tax and NIIT via calculateTotalFederalTax
            totalTax = fedTax + stateTax + withdrawalState.stateCapitalGainsTax + ficaTax + withdrawalState.withdrawalPenalties;

            // Recalculate discretionary cash
            discretionaryCash = externalIncome - preTaxDeductions - postTaxDeductions
                - totalTax - totalLivingExpenses - reinvestedIncome
                + withdrawalState.totalWithdrawals
                + withheldConversionTax;  // Withheld tax isn't a cash expense

            if (bestGross > 1000) {
                logs.push(`[INFO] Binary search withdrawal: $${bestGross.toLocaleString(undefined, { maximumFractionDigits: 0 })} to cover residual deficit`);
            }
        }

        // Clean up any remaining tiny residual (floating point precision)
        if (discretionaryCash < 0 && discretionaryCash > -0.10) {
            discretionaryCash = 0;
        }
    }

    // Update totalGrossIncome for reporting
    totalGrossIncome = totalGrossIncomeForTax;

    // ------------------------------------------------------------------
    // DEFICIT DEBT TRACKING
    // ------------------------------------------------------------------
    const deficitDebtResult = processDeficitDebt(discretionaryCash, accounts, logs);
    const existingDeficitDebt = deficitDebtResult.existingDeficitDebt;
    discretionaryCash = deficitDebtResult.discretionaryCash;

    // ------------------------------------------------------------------
    // 5. INFLOWS & BUCKETS (The Allocation of Surplus)
    // ------------------------------------------------------------------
    const inflowResult = processInflows(
        incomesWithEarningsTest, accounts, assumptions, year, withdrawalState,
        discretionaryCash, existingDeficitDebt, totalLivingExpenses, currentAge, logs
    );
    discretionaryCash = inflowResult.discretionaryCash;

    // ------------------------------------------------------------------
    // 6-7. LINKED DATA & GROW ACCOUNTS (The Compounding)
    // ------------------------------------------------------------------
    const nextAccounts = growAccounts(
        accounts, nextExpenses, withdrawalState, conversionDeposits,
        inflowResult.esppLots, inflowResult.deficitDebtPayment, existingDeficitDebt,
        assumptions, year, returnOverride, logs
    );

    // ------------------------------------------------------------------
    // 8. SUMMARY STATS
    // ------------------------------------------------------------------
    // Note: totalTax already includes unified fed/state tax + capital gains from the unified calculation above
    const trueUserSaved = totalGrossIncome - totalTax - totalInsuranceCost - totalLivingExpenses - discretionaryCash;

    // Filter out RMD incomes from the returned array
    const returnedIncomes = allIncomes.filter(inc =>
        !(inc instanceof PassiveIncome && inc.sourceType === 'RMD')
    );

    return {
        year,
        incomes: returnedIncomes,
        expenses: nextExpenses,
        accounts: nextAccounts,
        cashflow: {
            totalIncome: totalGrossIncome,
            totalExpense: totalLivingExpenses + totalTax + preTaxDeductions + postTaxDeductions,
            livingExpenses: totalLivingExpenses,  // Actual living expenses after spending cap adjustments
            discretionary: discretionaryCash,
            investedUser: trueUserSaved,
            investedMatch: inflowResult.totalEmployerMatch,
            totalInvested: trueUserSaved + inflowResult.totalEmployerMatch,
            bucketAllocations: inflowResult.totalBucketAllocations,
            bucketDetail: inflowResult.bucketDetail,
            withdrawals: withdrawalState.totalWithdrawals,
            withdrawalDetail: withdrawalState.withdrawalDetail
        },
        taxDetails: {
            // fedTax now includes all ordinary income tax from unified calculation
            // Add penalties for early withdrawals (10% before age 59.5)
            fed: fedTax + withdrawalState.withdrawalPenalties,
            state: stateTax,
            fica: ficaTax,
            preTax: preTaxDeductions - totalInsuranceCost,
            insurance: totalInsuranceCost,
            postTax: postTaxDeductions,
            capitalGains: withdrawalState.capitalGainsTaxTotal,
            withdrawalOrdinaryTax: withdrawalState.withdrawalOrdinaryTaxTotal,
            niit: niitTax
        },
        logs,
        strategyWithdrawal: strategyWithdrawalResult,
        strategyAdjustment: strategyAdjustmentResult,
        rothConversion: rothConversionResult,
        rmdDetails: rmdDetails,
        milestoneEvents: milestoneResult.newlyReached,
        activeMilestones: milestoneResult.activeMilestones
    };
}
