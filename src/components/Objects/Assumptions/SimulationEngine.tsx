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
import { SimulationYear, WithdrawalState } from "../../../services/simulation/types";

// Re-export helper for external consumers (e.g., RothConversionService tests)
export { calculateEffectiveConversionTax } from "../../../services/simulation/helpers";

// Import service modules
import { projectIncomes } from "../../../services/simulation/IncomeProjection";
import { processRMDs } from "../../../services/simulation/RMDService";
import { executeRothConversions } from "../../../services/simulation/RothConversionService";
import { applyLifestyleCreep, calculateGKTarget, calculateNonGKTarget, enforceGKSpendingCap, enforceStrategySpendingCap } from "../../../services/simulation/SpendingStrategy";
import { executeWithdrawals, processDeficitDebt } from "../../../services/simulation/WithdrawalService";
import { processInflows, growAccounts } from "../../../services/simulation/AccountGrowth";
import { evaluateAllMilestones, isActiveByMilestone, MilestoneContext } from "../../../services/simulation/MilestoneEvaluator";

/**
 * Runs the simulation for a single timestep (1 year).
 * Takes "Year N" data and returns "Year N+1" data.
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
    previousMilestoneReachYears: Map<string, number> = new Map()
): SimulationYear {
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
    // GUYTON-KLINGER TARGET CALCULATION
    // ------------------------------------------------------------------
    let strategyWithdrawalResult = isRetired && assumptions.investments.withdrawalStrategy === 'Guyton Klinger'
        ? calculateGKTarget(accounts, assumptions, previousSimulation, year, currentAge, logs)
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

    let fedTax = TaxService.calculateFederalTax(taxState, allIncomes, nextExpenses, year, assumptions);
    let stateTax = TaxService.calculateStateTax(taxState, allIncomes, nextExpenses, year, assumptions);
    const ficaTax = TaxService.calculateFicaTax(taxState, allIncomes, year, assumptions);
    let totalTax = fedTax + stateTax + ficaTax;

    // ------------------------------------------------------------------
    // WITHDRAWAL TRACKING STATE
    // ------------------------------------------------------------------
    const withdrawalState: WithdrawalState = {
        userInflows: {},
        employerInflows: {},
        withdrawalTaxes: 0,
        capitalGainsTaxTotal: 0,
        strategyWithdrawalExecuted: 0,
        totalWithdrawals: 0,
        withdrawalDetail: {},
        withdrawalPenalties: 0,
        totalGrossIncome
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
    fedTax += rmdResult.fedTaxIncrease;
    stateTax += rmdResult.stateTaxIncrease;
    totalTax = fedTax + stateTax + ficaTax;
    totalGrossIncome = withdrawalState.totalGrossIncome;

    // Add RMD incomes to allIncomes so Roth conversion sees them
    allIncomes.push(...rmdIncomes);

    // ------------------------------------------------------------------
    // AUTO ROTH CONVERSIONS (during retirement)
    // When tax optimization is enabled, automatically perform conversions
    // For early retirees (FIRE), conversions are skipped - they benefit more
    // from drawing down Traditional at naturally low tax rates.
    // ------------------------------------------------------------------
    let rothConversionResult: SimulationYear['rothConversion'] = undefined;
    let conversionDeposits: Record<string, number> = {};

    // Do Roth conversions when tax optimization is enabled and person is retired
    const doRothConversions = assumptions.investments.taxOptimizationEnabled && isRetired;

    if (doRothConversions) {
        const convResult = executeRothConversions({
            accounts, allIncomes, nextExpenses, year, assumptions, taxState,
            previousSimulation, totalGrossIncome, preTaxDeductions, postTaxDeductions,
            totalTax, currentAge, withdrawalState
        }, logs);

        rothConversionResult = convResult.rothConversionResult;
        conversionDeposits = convResult.conversionDeposits;
        fedTax += convResult.fedTaxIncrease;
        stateTax += convResult.stateTaxIncrease;
        totalTax = fedTax + stateTax + ficaTax;
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

    let discretionaryCash = totalGrossIncome - preTaxDeductions - postTaxDeductions - totalTax - totalLivingExpenses - reinvestedIncome;

    // ------------------------------------------------------------------
    // SPENDING CAPS (GK and Fixed Real / Percentage)
    // ------------------------------------------------------------------
    let strategyAdjustmentResult: SimulationYear['strategyAdjustment'] = undefined;

    if (strategyWithdrawalResult && assumptions.investments.withdrawalStrategy === 'Guyton Klinger' && discretionaryCash < 0) {
        const capResult = enforceGKSpendingCap(
            nextExpenses, strategyWithdrawalResult, discretionaryCash,
            totalGrossIncome, preTaxDeductions, postTaxDeductions, totalTax, reinvestedIncome,
            year, assumptions, logs
        );
        nextExpenses = capResult.nextExpenses;
        totalLivingExpenses = capResult.totalLivingExpenses;
        discretionaryCash = capResult.discretionaryCash;
        strategyAdjustmentResult = capResult.strategyAdjustmentResult;
    }

    // Non-GK strategy target
    if (isRetired && assumptions.investments.withdrawalStrategy !== 'Guyton Klinger' && assumptions.investments.withdrawalStrategy !== 'None') {
        strategyWithdrawalResult = calculateNonGKTarget(accounts, assumptions, previousSimulation, year, logs);
    }

    // Non-GK spending cap
    if (strategyWithdrawalResult && assumptions.investments.withdrawalStrategy !== 'Guyton Klinger' && assumptions.investments.withdrawalStrategy !== 'None' && discretionaryCash < 0) {
        const capResult = enforceStrategySpendingCap(
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
    // WITHDRAWAL LOGIC (Deficit Manager)
    // ------------------------------------------------------------------
    const withdrawalResult = executeWithdrawals(
        discretionaryCash, accounts, assumptions, taxState, year, currentAge,
        preTaxDeductions, withdrawalState, rothConversionResult, isRetired, logs
    );
    discretionaryCash = withdrawalResult.discretionaryCash;

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
    totalTax += withdrawalState.withdrawalTaxes + withdrawalState.capitalGainsTaxTotal;
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
            fed: fedTax + withdrawalState.withdrawalTaxes + withdrawalState.withdrawalPenalties,
            state: stateTax,
            fica: ficaTax,
            preTax: preTaxDeductions - totalInsuranceCost,
            insurance: totalInsuranceCost,
            postTax: postTaxDeductions,
            capitalGains: withdrawalState.capitalGainsTaxTotal
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
