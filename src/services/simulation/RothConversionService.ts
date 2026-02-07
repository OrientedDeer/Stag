import { AnyAccount, InvestedAccount, SavedAccount } from "../../components/Objects/Accounts/models";
import { AnyExpense, MortgageExpense, LoanExpense } from "../../components/Objects/Expense/models";
import { AnyIncome, PassiveIncome } from "../../components/Objects/Income/models";
import { AssumptionsState, WithdrawalBucket } from "../../components/Objects/Assumptions/AssumptionsContext";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { getIncomeThresholdForRate } from "../TaxOptimizationService";
import { SimulationYear, WithdrawalState } from "./types";
import { calculateEffectiveConversionTax } from "./helpers";
import { TaxParameters, FilingStatus } from "../../data/TaxData";

// =============================================================================
// Shared Helper Functions
// =============================================================================

/**
 * Get Traditional accounts ordered for conversion (withdrawal order first, then others).
 * Returns accounts in the order they should be converted FROM.
 */
export function getTraditionalAccountsForConversion(
    accounts: AnyAccount[],
    withdrawalOrder: WithdrawalBucket[]
): InvestedAccount[] {
    const traditionalAccounts: InvestedAccount[] = [];

    // First, add accounts in withdrawal order
    for (const bucket of withdrawalOrder) {
        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (account instanceof InvestedAccount &&
            (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
            traditionalAccounts.push(account);
        }
    }

    // Then add any not in withdrawal order
    for (const acc of accounts) {
        if (acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA') &&
            !traditionalAccounts.includes(acc)) {
            traditionalAccounts.push(acc);
        }
    }

    return traditionalAccounts;
}

/**
 * Get Roth accounts ordered for conversion (reverse withdrawal order first, then others).
 * Returns accounts in the order they should receive conversion deposits (last withdrawn = first to receive).
 */
export function getRothAccountsForConversion(
    accounts: AnyAccount[],
    withdrawalOrder: WithdrawalBucket[]
): InvestedAccount[] {
    const rothAccounts: InvestedAccount[] = [];

    // First, add accounts in REVERSE withdrawal order (last to withdraw = first to receive)
    for (let i = withdrawalOrder.length - 1; i >= 0; i--) {
        const bucket = withdrawalOrder[i];
        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (account instanceof InvestedAccount &&
            (account.taxType === 'Roth 401k' || account.taxType === 'Roth IRA')) {
            rothAccounts.push(account);
        }
    }

    // Then add any not in withdrawal order
    for (const acc of accounts) {
        if (acc instanceof InvestedAccount &&
            (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA') &&
            !rothAccounts.includes(acc)) {
            rothAccounts.push(acc);
        }
    }

    return rothAccounts;
}

/**
 * Binary search to find optimal Roth conversion amount when SS torpedo affects effective rate.
 * Returns the maximum conversion amount where effective rate stays <= target rate.
 *
 * @param agiExcludingSS - AGI excluding Social Security benefits
 * @param totalSSBenefits - Total Social Security benefits
 * @param maxBracketAmount - Maximum amount based on bracket headroom
 * @param targetRate - Target effective tax rate (e.g., 0.22 for 22%)
 * @param filingStatus - Tax filing status
 * @param fedParams - Federal tax parameters
 * @param tolerance - Convergence tolerance (default $100)
 * @returns Optimal conversion amount
 */
export function findOptimalConversionWithSSTorpedo(
    agiExcludingSS: number,
    totalSSBenefits: number,
    maxBracketAmount: number,
    targetRate: number,
    filingStatus: FilingStatus,
    fedParams: TaxParameters,
    tolerance: number = 100
): number {
    // No SS means no torpedo effect - use full bracket headroom
    if (totalSSBenefits <= 0 || maxBracketAmount <= 0) {
        return maxBracketAmount;
    }

    let low = 0;
    let high = maxBracketAmount;

    while (high - low > tolerance) {
        const mid = (low + high) / 2;
        const midResult = calculateEffectiveConversionTax(
            agiExcludingSS,
            totalSSBenefits,
            0, // ltcgIncome
            mid,
            filingStatus,
            fedParams,
            null // stateParams
        );

        if (midResult.effectiveRate < targetRate) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return Math.floor(low);
}

/**
 * Perform automatic Roth conversions during retirement.
 * Converts from Traditional accounts (in withdrawal order) to Roth accounts (reverse order).
 */
function performAutoRothConversion(
    accounts: AnyAccount[],
    incomes: AnyIncome[],
    _expenses: AnyExpense[],
    year: number,
    assumptions: AssumptionsState,
    taxState: TaxState,
    _previousSimulation: SimulationYear[],
    logs: string[],
    estimatedTraditionalWithdrawal: number = 0,
    priorInflows: Record<string, number> = {}
): SimulationYear['rothConversion'] | undefined {
    const fedParams = TaxService.getTaxParameters(
        year,
        taxState.filingStatus,
        'federal',
        undefined,
        assumptions
    );

    if (!fedParams) return undefined;

    // Calculate current taxable income with proper SS handling
    const grossIncome = TaxService.getGrossIncome(incomes, year);
    const preTaxDeductions = TaxService.getPreTaxExemptions(incomes, year);
    const standardDeduction = fedParams.standardDeduction || 0;

    const totalSSBenefits = TaxService.getSocialSecurityBenefits(incomes, year);
    const nonSSGross = grossIncome - totalSSBenefits;
    const agiExcludingSS = nonSSGross - preTaxDeductions;
    // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
    const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        agiExcludingSS,
        0, // taxExemptInterest - not currently tracked
        taxState.filingStatus
    );

    const adjustedGross = nonSSGross + taxableSSBenefits;
    const taxableIncome = Math.max(0, adjustedGross - preTaxDeductions);

    const retirementTaxRate = assumptions.investments.rothConversionTargetBracket;

    // Check effective rate on a test conversion
    const testAgi = agiExcludingSS + estimatedTraditionalWithdrawal;
    const testConversionAmount = 1000;
    const testEffectiveResult = calculateEffectiveConversionTax(
        testAgi,
        totalSSBenefits,
        0, // ltcgIncome - not tracked here
        testConversionAmount,
        taxState.filingStatus,
        fedParams,
        null // stateParams - not used for rate check
    );

    // Allow conversions at or below the target rate
    // Use > instead of >= to allow conversions exactly at the target rate
    // (e.g., if targeting 22%, conversions at 22% effective rate are still beneficial)
    if (testEffectiveResult.effectiveRate > retirementTaxRate) {
        return undefined;
    }

    // Calculate optimal conversion amount accounting for SS torpedo
    const targetIncomeThreshold = getIncomeThresholdForRate(retirementTaxRate, fedParams);
    const adjustedTaxableIncome = taxableIncome + estimatedTraditionalWithdrawal;
    let maxBracketAmount = Math.max(0, targetIncomeThreshold + standardDeduction - adjustedTaxableIncome);

    if (estimatedTraditionalWithdrawal > 0) {
        logs.push(`  Bracket headroom reduced by estimated expense withdrawal: $${estimatedTraditionalWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    }

    // Find optimal conversion amount accounting for SS torpedo
    const adjustedAgiExcludingSS = agiExcludingSS + estimatedTraditionalWithdrawal;
    const optimalAmount = findOptimalConversionWithSSTorpedo(
        adjustedAgiExcludingSS,
        totalSSBenefits,
        maxBracketAmount,
        retirementTaxRate,
        taxState.filingStatus,
        fedParams
    );

    if (optimalAmount <= 0) return undefined;

    // Get accounts for conversion using shared helpers
    const withdrawalOrder = assumptions.withdrawalStrategy || [];
    const traditionalAccounts = getTraditionalAccountsForConversion(accounts, withdrawalOrder);
    const rothAccounts = getRothAccountsForConversion(accounts, withdrawalOrder);

    // Check if Traditional is essentially depleted (< $100)
    const totalTraditionalBalance = traditionalAccounts.reduce(
        (sum, acc) => sum + Math.max(0, acc.amount + Math.min(0, priorInflows[acc.id] || 0)), 0
    );
    if (totalTraditionalBalance < 100) {
        return undefined; // Traditional depleted, nothing to convert
    }

    if (traditionalAccounts.length === 0 || rothAccounts.length === 0) {
        return undefined;
    }

    // Perform the conversion
    let remainingToConvert = optimalAmount;
    const fromAccounts: Record<string, number> = {};
    const toAccounts: Record<string, number> = {};
    const fromAccountIds: Record<string, number> = {};
    const toAccountIds: Record<string, number> = {};

    for (const tradAccount of traditionalAccounts) {
        if (remainingToConvert <= 0) break;

        const priorOutflow = priorInflows[tradAccount.id] || 0;
        const availableBalance = tradAccount.amount + Math.min(0, priorOutflow);
        if (availableBalance <= 0) continue;

        const convertAmount = Math.min(remainingToConvert, availableBalance);
        fromAccounts[tradAccount.name] = (fromAccounts[tradAccount.name] || 0) + convertAmount;
        fromAccountIds[tradAccount.id] = (fromAccountIds[tradAccount.id] || 0) + convertAmount;
        remainingToConvert -= convertAmount;
    }

    const totalConverted = optimalAmount - remainingToConvert;
    if (totalConverted <= 0) return undefined;

    // Deposit to Roth accounts
    let remainingToDeposit = totalConverted;
    for (const rothAccount of rothAccounts) {
        if (remainingToDeposit <= 0) break;
        toAccounts[rothAccount.name] = (toAccounts[rothAccount.name] || 0) + remainingToDeposit;
        toAccountIds[rothAccount.id] = (toAccountIds[rothAccount.id] || 0) + remainingToDeposit;
        remainingToDeposit = 0;
    }

    // Calculate tax cost on the conversion
    const conversionTaxResult = calculateEffectiveConversionTax(
        agiExcludingSS + estimatedTraditionalWithdrawal,
        totalSSBenefits,
        0, // ltcgIncome
        totalConverted,
        taxState.filingStatus,
        fedParams,
        null // stateParams - state tax handled separately in caller
    );
    const taxCost = conversionTaxResult.taxIncrease;
    const taxAfter = conversionTaxResult.taxAfter;

    logs.push(`  From: ${Object.entries(fromAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);
    logs.push(`  To: ${Object.entries(toAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);

    return {
        amount: totalConverted,
        taxCost,
        taxAfter,
        fromAccounts,
        toAccounts,
        fromAccountIds,
        toAccountIds
    };
}

/**
 * Execute a pre-calculated Roth conversion amount.
 * Used when tax optimization has already determined the optimal conversion.
 * Skips bracket headroom calculation and just executes the conversion.
 */
function executePreCalculatedConversion(
    conversionAmount: number,
    accounts: AnyAccount[],
    allIncomes: AnyIncome[],
    year: number,
    assumptions: AssumptionsState,
    taxState: TaxState,
    totalGrossIncome: number,
    preTaxDeductions: number,
    withdrawalState: WithdrawalState,
    logs: string[]
): RothConversionResult {
    const conversionDeposits: Record<string, number> = {};

    if (conversionAmount <= 0) {
        return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
    }

    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    if (!fedParams) {
        return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
    }

    // Get accounts for conversion using shared helpers
    const withdrawalOrder = assumptions.withdrawalStrategy || [];
    const traditionalAccounts = getTraditionalAccountsForConversion(accounts, withdrawalOrder);
    const rothAccounts = getRothAccountsForConversion(accounts, withdrawalOrder);

    if (traditionalAccounts.length === 0 || rothAccounts.length === 0) {
        return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
    }

    // Check total available Traditional balance
    const totalTraditionalBalance = traditionalAccounts.reduce(
        (sum, acc) => sum + Math.max(0, acc.amount + Math.min(0, withdrawalState.userInflows[acc.id] || 0)), 0
    );
    if (totalTraditionalBalance < 100) {
        return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
    }

    // Cap conversion at available balance
    const actualConversion = Math.min(conversionAmount, totalTraditionalBalance);

    // Perform the conversion
    let remainingToConvert = actualConversion;
    const fromAccounts: Record<string, number> = {};
    const toAccounts: Record<string, number> = {};
    const fromAccountIds: Record<string, number> = {};
    const toAccountIds: Record<string, number> = {};

    for (const tradAccount of traditionalAccounts) {
        if (remainingToConvert <= 0) break;

        const priorOutflow = withdrawalState.userInflows[tradAccount.id] || 0;
        const availableBalance = tradAccount.amount + Math.min(0, priorOutflow);
        if (availableBalance <= 0) continue;

        const convertAmount = Math.min(remainingToConvert, availableBalance);
        fromAccounts[tradAccount.name] = (fromAccounts[tradAccount.name] || 0) + convertAmount;
        fromAccountIds[tradAccount.id] = (fromAccountIds[tradAccount.id] || 0) + convertAmount;
        remainingToConvert -= convertAmount;
    }

    const totalConverted = actualConversion - remainingToConvert;
    if (totalConverted <= 0) {
        return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
    }

    // Deposit to Roth accounts
    let remainingToDeposit = totalConverted;
    for (const rothAccount of rothAccounts) {
        if (remainingToDeposit <= 0) break;
        toAccounts[rothAccount.name] = (toAccounts[rothAccount.name] || 0) + remainingToDeposit;
        toAccountIds[rothAccount.id] = (toAccountIds[rothAccount.id] || 0) + remainingToDeposit;
        remainingToDeposit = 0;
    }

    // Calculate federal tax on the conversion
    const totalSSBenefits = TaxService.getSocialSecurityBenefits(allIncomes, year);
    const nonSSGross = totalGrossIncome - totalSSBenefits;
    const agiExcludingSS = nonSSGross - preTaxDeductions;

    const conversionTaxResult = calculateEffectiveConversionTax(
        agiExcludingSS,
        totalSSBenefits,
        0, // ltcgIncome
        totalConverted,
        taxState.filingStatus,
        fedParams,
        null // stateParams - state tax handled separately below
    );
    const taxCost = conversionTaxResult.taxIncrease;
    const taxAfter = conversionTaxResult.taxAfter;

    // Calculate state tax on conversion
    let stateTaxIncrease = 0;
    const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);
    if (stateParams) {
        let stateBaseIncome = totalGrossIncome - preTaxDeductions;
        if (totalSSBenefits > 0) {
            const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
            if (ssTreatment === 'taxable') {
                // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
                const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(totalSSBenefits, agiExcludingSS, 0, taxState.filingStatus);
                stateBaseIncome = totalGrossIncome - totalSSBenefits + taxableSSBenefits - preTaxDeductions;
            } else {
                // 'exempt' or 'income-based' - exclude SS benefits entirely (income-based TODO: implement phaseout)
                stateBaseIncome = totalGrossIncome - totalSSBenefits - preTaxDeductions;
            }
        }
        const stateStdDed = stateParams.standardDeduction || 0;
        const stateApplied = { ...stateParams, standardDeduction: stateStdDed };

        const stateBaseTax = TaxService.calculateTax(stateBaseIncome, 0, stateApplied);
        const stateNewTax = TaxService.calculateTax(stateBaseIncome + totalConverted, 0, stateApplied);
        stateTaxIncrease = stateNewTax - stateBaseTax;
    }

    logs.push(`🔄 Tax-Optimized Roth Conversion: $${totalConverted.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    logs.push(`  From: ${Object.entries(fromAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);
    logs.push(`  To: ${Object.entries(toAccounts).map(([name, amt]) => `${name}: $${amt.toLocaleString(undefined, { maximumFractionDigits: 0 })}`).join(', ')}`);
    logs.push(`  Tax cost: $${taxCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

    // Apply Roth conversion flows
    for (const [accountId, amount] of Object.entries(fromAccountIds)) {
        withdrawalState.userInflows[accountId] = (withdrawalState.userInflows[accountId] || 0) - amount;
    }
    for (const [accountId, amount] of Object.entries(toAccountIds)) {
        withdrawalState.userInflows[accountId] = (withdrawalState.userInflows[accountId] || 0) + amount;
        conversionDeposits[accountId] = (conversionDeposits[accountId] || 0) + amount;
    }

    const conversionResult: SimulationYear['rothConversion'] = {
        amount: totalConverted,
        taxCost,
        taxAfter,
        fromAccounts,
        toAccounts,
        fromAccountIds,
        toAccountIds
    };

    return { rothConversionResult: conversionResult, conversionDeposits, fedTaxIncrease: taxCost, stateTaxIncrease, logs };
}

export interface RothConversionInput {
    accounts: AnyAccount[];
    allIncomes: AnyIncome[];
    nextExpenses: AnyExpense[];
    year: number;
    assumptions: AssumptionsState;
    taxState: TaxState;
    previousSimulation: SimulationYear[];
    totalGrossIncome: number;
    preTaxDeductions: number;
    postTaxDeductions: number;
    totalTax: number;
    currentAge: number;
    withdrawalState: WithdrawalState;
}

export interface RothConversionResult {
    rothConversionResult: SimulationYear['rothConversion'];
    conversionDeposits: Record<string, number>;
    fedTaxIncrease: number;
    stateTaxIncrease: number;
    logs: string[];
}

/**
 * Execute auto Roth conversions during retirement.
 * Handles all logic including preliminary deficit calculation, skip conditions,
 * and tax recalculation after conversion.
 *
 * @param input - Conversion input parameters
 * @param logs - Array for logging messages
 * @param preCalculatedAmount - Optional: If provided, use this exact conversion amount
 *                              instead of calculating bracket headroom. Used when
 *                              tax optimization is providing a pre-planned amount.
 */
export function executeRothConversions(
    input: RothConversionInput,
    logs: string[],
    preCalculatedAmount?: number
): RothConversionResult {
    const {
        accounts, allIncomes, nextExpenses, year, assumptions, taxState,
        previousSimulation, totalGrossIncome, preTaxDeductions, postTaxDeductions,
        totalTax, currentAge, withdrawalState
    } = input;

    const conversionDeposits: Record<string, number> = {};

    // Note: The decision to call this function is made by shouldDoAutoRothConversions()
    // in the SimulationEngine. Roth conversions only happen when tax optimization is enabled.

    // If a pre-calculated amount is provided (from tax optimization), use it directly
    if (preCalculatedAmount !== undefined && preCalculatedAmount > 0) {
        return executePreCalculatedConversion(
            preCalculatedAmount, accounts, allIncomes, year, assumptions, taxState,
            totalGrossIncome, preTaxDeductions, withdrawalState, logs
        );
    }

    // If pre-calculated amount is 0 or not provided with 0, skip conversion
    if (preCalculatedAmount === 0) {
        return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
    }

    // Calculate preliminary cash flow to check if we can afford conversions
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

    // Skip conversion if under 59.5 and deficit would require early Roth EARNINGS (penalty)
    // We include Traditional as a valid source because:
    // 1. Traditional withdrawals have 10% penalty but are still preferable to tapping Roth earnings
    // 2. For early retirees, we want to do conversions AND use Traditional for spending at low brackets
    // 3. The 10% penalty on Traditional is often worth it to avoid higher taxes later
    let skipConversion = false;
    if (currentAge < 59.5 && preliminaryCash < 0) {
        const deficit = Math.abs(preliminaryCash);
        const availableSources = accounts.reduce((sum, acc) => {
            const priorOutflow = Math.min(0, withdrawalState.userInflows[acc.id] || 0);
            const available = acc.amount + priorOutflow;
            if (available <= 0) return sum;
            if (acc instanceof SavedAccount) return sum + available;
            if (acc instanceof InvestedAccount) {
                if (acc.taxType === 'Brokerage') return sum + available;
                // Traditional can cover deficit (with 10% penalty, but still valid)
                if (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA') {
                    return sum + available;
                }
                // For Roth, only regular contributions are fully penalty-free before 59.5
                // (conversions have 5-year rule, earnings have penalty)
                if (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA') {
                    return sum + Math.min(available, acc.regularContributions);
                }
            }
            return sum;
        }, 0);
        if (deficit > availableSources) {
            skipConversion = true;
            logs.push(`[SKIP] No conversion: deficit $${deficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} exceeds available sources $${availableSources.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    const conversionResult = skipConversion ? undefined : performAutoRothConversion(
        accounts,
        allIncomes,
        nextExpenses,
        year,
        assumptions,
        taxState,
        previousSimulation,
        logs,
        0, // Simplified: don't try to coordinate with withdrawals
        withdrawalState.userInflows
    );

    let fedTaxIncrease = 0;
    let stateTaxIncrease = 0;

    if (conversionResult && conversionResult.amount > 0) {
        fedTaxIncrease = conversionResult.taxCost;

        // State tax on conversion
        const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);
        if (stateParams) {
            const totalSSBenefits = TaxService.getSocialSecurityBenefits(allIncomes, year);
            let stateBaseIncome = totalGrossIncome - preTaxDeductions;
            if (totalSSBenefits > 0) {
                const ssTreatment = stateParams.socialSecurityTreatment ?? 'exempt';
                if (ssTreatment === 'taxable') {
                    const agiExcludingSS = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                    // TODO: Verify all income types are included (LTCG, STCG, dividends, etc.)
                    const taxableSSBenefits = TaxService.getTaxableSocialSecurityBenefits(totalSSBenefits, agiExcludingSS, 0, taxState.filingStatus);
                    stateBaseIncome = totalGrossIncome - totalSSBenefits + taxableSSBenefits - preTaxDeductions;
                } else {
                    // 'exempt' or 'income-based' - exclude SS benefits entirely (income-based TODO: implement phaseout)
                    stateBaseIncome = totalGrossIncome - totalSSBenefits - preTaxDeductions;
                }
            }
            const stateStdDed = stateParams.standardDeduction || 0;
            const stateApplied = { ...stateParams, standardDeduction: stateStdDed };

            const stateBaseTax = TaxService.calculateTax(stateBaseIncome, 0, stateApplied);
            const stateNewTax = TaxService.calculateTax(stateBaseIncome + conversionResult.amount, 0, stateApplied);
            stateTaxIncrease = stateNewTax - stateBaseTax;
        }

        logs.push(`🔄 Auto Roth Conversion: $${conversionResult.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        logs.push(`  Tax cost: $${conversionResult.taxCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

        // Apply Roth conversion flows
        for (const [accountId, amount] of Object.entries(conversionResult.fromAccountIds)) {
            withdrawalState.userInflows[accountId] = (withdrawalState.userInflows[accountId] || 0) - amount;
        }
        for (const [accountId, amount] of Object.entries(conversionResult.toAccountIds)) {
            withdrawalState.userInflows[accountId] = (withdrawalState.userInflows[accountId] || 0) + amount;
            conversionDeposits[accountId] = (conversionDeposits[accountId] || 0) + amount;
        }

        return { rothConversionResult: conversionResult, conversionDeposits, fedTaxIncrease, stateTaxIncrease, logs };
    }

    return { rothConversionResult: undefined, conversionDeposits, fedTaxIncrease: 0, stateTaxIncrease: 0, logs };
}
