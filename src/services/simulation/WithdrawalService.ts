import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, DeficitDebtAccount, getESPPLotOrder } from "../../components/Objects/Accounts/models";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { SimulationYear, WithdrawalState } from "./types";

/**
 * ARCHITECTURAL NOTE: Tax Calculation in Withdrawal Service
 * =========================================================
 *
 * This service calculates capital gains tax during withdrawal execution for two purposes:
 *   1. Gross-up calculation: Determine how much to withdraw to net a target amount
 *   2. Tracking: Accumulate tax amounts in WithdrawalState
 *
 * IMPORTANT: The tax calculated here is for gross-up purposes only. The FINAL federal
 * tax (including LTCG, NIIT, and SS taxability effects) is calculated post-hoc in
 * SimulationEngine using TaxService.calculateTotalFederalTax().
 *
 * Why this matters:
 *   - Capital gains affect SS taxability (LTCG counts toward provisional income)
 *   - This creates a circular dependency: withdraw → tax → withdraw more
 *   - We break the cycle by calculating tax twice:
 *     1. Here: Approximate tax for gross-up (may underestimate if LTCG affects SS)
 *     2. SimulationEngine: Final correct tax via calculateTotalFederalTax
 *
 * The result is:
 *   - Final tax number IS CORRECT for the withdrawals that occurred
 *   - We may have slightly over-withdrawn if we underestimated tax during gross-up
 *   - This is an acceptable approximation (no iteration to convergence)
 *
 * Tracking fields in WithdrawalState:
 *   - capitalGainsTaxTotal: Fed + State cap gains tax (for gross-up, NOT added to final tax)
 *   - stateCapitalGainsTax: State portion only (added to final tax in SimulationEngine)
 *   - longTermCapitalGains/shortTermCapitalGains: Actual gains for post-hoc federal tax
 *
 * FUTURE REWRITE: Use calculateTotalFederalTax throughout with an iterative solver.
 */

export interface WithdrawalResult {
    discretionaryCash: number;
    withdrawalState: WithdrawalState;
    rothConversionResult: SimulationYear['rothConversion'] | undefined;
    logs: string[];
}

export interface DeficitDebtResult {
    existingDeficitDebt: DeficitDebtAccount | undefined;
    deficitDebtPayment: number;
    discretionaryCash: number;
    logs: string[];
}

/**
 * Withdrawal plan from tax optimization (amounts by account type)
 */
export interface WithdrawalPlan {
    traditional: number;
    roth: number;
    brokerage: number;
    savings: number;
}

/**
 * Execute withdrawals to cover expense deficits.
 * Walks through the withdrawal strategy order, applying tax scenarios per account type.
 *
 * @param withdrawalPlan - Optional: If provided by tax optimizer, use these exact amounts
 *                         instead of the normal order-based logic.
 */
export function executeWithdrawals(
    discretionaryCash: number,
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    taxState: TaxState,
    year: number,
    currentAge: number,
    preTaxDeductions: number,
    withdrawalState: WithdrawalState,
    _rothConversionResult: SimulationYear['rothConversion'] | undefined,
    isRetired: boolean,
    logs: string[],
    withdrawalPlan?: WithdrawalPlan
): { discretionaryCash: number; logs: string[] } {
    // If a withdrawal plan is provided, execute it directly
    if (withdrawalPlan) {
        return executeWithdrawalPlan(
            discretionaryCash, accounts, assumptions, withdrawalState, withdrawalPlan, logs
        );
    }
    const deficitAmount = discretionaryCash < 0 ? Math.abs(discretionaryCash) : 0;
    let amountToWithdraw = deficitAmount;

    if (amountToWithdraw <= 0) return { discretionaryCash, logs };

    let deficit = amountToWithdraw;

    // Use user-defined drag-and-drop withdrawal order
    const strategy = assumptions.withdrawalStrategy || [];
    const withdrawalBuckets: { accountId: string; name: string; id: string; cappedTraditional: boolean; maxAmount?: number }[] =
        strategy.map(b => ({ ...b, cappedTraditional: false }));

    const isEarly = currentAge < 59.5;

    for (const bucket of withdrawalBuckets) {
        if (deficit <= 0.01) break;

        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (!account) continue;

        let availableBalance = account.amount;
        if (account instanceof InvestedAccount) {
            availableBalance = account.vestedAmount;
        }
        const priorOutflow = withdrawalState.userInflows[account.id] || 0;
        if (priorOutflow < 0) {
            availableBalance += priorOutflow;
        }
        if (availableBalance <= 0) continue;

        // When using smart order, cap Traditional withdrawals at the calculated optimal amount
        // This preserves Traditional balance for RMD optimization instead of draining it
        // For brokerage accounts, don't cap - the iterative solver will find the correct
        // gross withdrawal to cover the net deficit (accounting for taxes)
        const isTraditional = account instanceof InvestedAccount &&
            (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA');
        if (bucket.maxAmount !== undefined && bucket.maxAmount < availableBalance && isTraditional) {
            availableBalance = bucket.maxAmount;
        }

        let withdrawAmount = 0;
        let taxHit = 0;

        // SCENARIO 1: Tax-Free (or partially tax-free for Roth early withdrawal)
        const isRoth = account instanceof InvestedAccount && (account.taxType === 'Roth 401k' || account.taxType === 'Roth IRA');
        const isHSA = account instanceof InvestedAccount && account.taxType === 'HSA';
        const isSaved = account instanceof SavedAccount;
        const isTaxFree = isSaved || isRoth || isHSA;

        if (isTaxFree) {
            if (isRoth && isEarly && account instanceof InvestedAccount) {
                // IRS Roth ordering rules (before 59.5)
                const regularContribs = account.regularContributions;
                const accountGains = account.unrealizedGains;
                let usedFromBalance = 0;

                // Step 1: Regular contributions (penalty-free, tax-free)
                const step1Amount = Math.min(deficit, regularContribs, availableBalance);
                deficit -= step1Amount;
                usedFromBalance += step1Amount;

                // Step 2: Conversions (FIFO, oldest first)
                if (deficit > 0 && account.conversionHistory.length > 0) {
                    const sortedConversions = [...account.conversionHistory].sort((a, b) => a.year - b.year);
                    let conversionPenalty = 0;

                    for (const conversion of sortedConversions) {
                        if (deficit <= 0) break;
                        if (conversion.amount <= 0) continue;

                        const convWithdraw = Math.min(deficit, conversion.amount, availableBalance - usedFromBalance);
                        if (convWithdraw <= 0) break;

                        if ((year - conversion.year) < 5) {
                            conversionPenalty += convWithdraw * 0.10;
                        }

                        deficit -= convWithdraw;
                        usedFromBalance += convWithdraw;
                    }

                    if (conversionPenalty > 0) {
                        withdrawalState.withdrawalPenalties += conversionPenalty;
                        deficit += conversionPenalty;
                        logs.push(`[WARN] Roth 5-year rule: 10% penalty on $${(conversionPenalty / 0.10).toLocaleString(undefined, { maximumFractionDigits: 0 })} converted funds withdrawn early`);
                    }
                }

                // Step 3: Earnings — taxable income + 10% penalty
                if (deficit > 0 && accountGains > 0) {
                    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                    const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                    const currentFedIncome = withdrawalState.totalGrossIncome - preTaxDeductions;
                    const currentStateIncome = withdrawalState.totalGrossIncome - preTaxDeductions;
                    const stdDedFed = fedParams?.standardDeduction || 12950;
                    const stdDedState = stateParams?.standardDeduction || 0;
                    const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                    const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;

                    const gainsResult = TaxService.calculateGrossWithdrawal(
                        deficit,
                        currentFedIncome,
                        currentFedDeduction,
                        currentStateIncome,
                        currentStateDeduction,
                        taxState,
                        year,
                        assumptions,
                        0.10
                    );

                    const grossGainsWithdrawal = Math.min(gainsResult.grossWithdrawn, accountGains, availableBalance - usedFromBalance);

                    const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                    const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                    const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                    const fedNew = TaxService.calculateTax(currentFedIncome + grossGainsWithdrawal, 0, fedApplied);
                    const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                    const stateNew = TaxService.calculateTax(currentStateIncome + grossGainsWithdrawal, 0, stateApplied);

                    const taxOnGains = (fedNew - fedBase) + (stateNew - stateBase);
                    const earlyPenalty = grossGainsWithdrawal * 0.10;

                    withdrawalState.withdrawalTaxes += taxOnGains;
                    withdrawalState.withdrawalPenalties += earlyPenalty;
                    withdrawalState.totalGrossIncome += grossGainsWithdrawal;

                    logs.push(`[WARN] Early Roth withdrawal: $${grossGainsWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} earnings taxed + 10% penalty`);

                    usedFromBalance += grossGainsWithdrawal;
                    const netFromGains = grossGainsWithdrawal - taxOnGains - earlyPenalty;
                    deficit -= netFromGains;
                }

                withdrawAmount = usedFromBalance;
            } else {
                // Normal tax-free withdrawal
                withdrawAmount = Math.min(deficit, availableBalance);
                deficit -= withdrawAmount;
            }
        }
        // SCENARIO 2: Pre-Tax (Traditional 401k/IRA)
        // Tax on Traditional withdrawals is now handled by unified tax calculation in SimulationEngine
        // Here we just track the withdrawal amount and apply early withdrawal penalty gross-up
        else if (account instanceof InvestedAccount && (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
            const penaltyRate = isEarly ? 0.10 : 0;

            // Gross up for early withdrawal penalty (need to withdraw more to net the same after penalty)
            // If penalty is 10%, we need to withdraw deficit / 0.9 to have deficit left after penalty
            const grossNeeded = penaltyRate > 0 ? deficit / (1 - penaltyRate) : deficit;
            withdrawAmount = Math.min(grossNeeded, availableBalance);

            // Track early withdrawal penalty (10% before age 59.5)
            const actualPenalty = withdrawAmount * penaltyRate;
            withdrawalState.withdrawalPenalties += actualPenalty;

            // Update gross income for tracking (used by unified tax calculation)
            withdrawalState.totalGrossIncome += withdrawAmount;

            // Track Traditional withdrawals separately for unified tax calculation
            withdrawalState.traditionalWithdrawals += withdrawAmount;

            // Reduce deficit by net amount (withdrawal minus penalty)
            // Tax is handled separately by unified calculation in SimulationEngine
            deficit -= (withdrawAmount - actualPenalty);
        }
        // SCENARIO 3: Brokerage (Capital Gains Tax with lot-aware short/long-term split)
        else if (account instanceof InvestedAccount && account.taxType === 'Brokerage') {
            const gainsPortion = account.unrealizedGains / account.amount;

            const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
            const currentFedIncome = withdrawalState.totalGrossIncome - preTaxDeductions;
            const stdDedFed = fedParams?.standardDeduction || 12950;
            const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
            const ordinaryTaxableIncome = Math.max(0, currentFedIncome - currentFedDeduction);

            const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);
            const stdDedState = stateParams?.standardDeduction || 0;
            const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;
            const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };
            const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
            const currentStateIncome = withdrawalState.totalGrossIncome - preTaxDeductions;

            // Iterative approach to find gross withdrawal needed
            let grossWithdrawal = deficit / (1 - gainsPortion * 0.15);

            for (let i = 0; i < 10; i++) {
                const testWithdrawal = Math.min(grossWithdrawal, availableBalance);
                const lotResult = account.calculateLotAwareWithdrawal(testWithdrawal, year);

                // Short-term gains taxed at ordinary income rates
                let testShortTermTax = 0;
                if (lotResult.shortTermGains > 0) {
                    const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                    const fedNew = TaxService.calculateTax(currentFedIncome + lotResult.shortTermGains, 0, fedApplied);
                    const stBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                    const stNew = TaxService.calculateTax(currentStateIncome + lotResult.shortTermGains, 0, stateApplied);
                    testShortTermTax = (fedNew - fedBase) + (stNew - stBase);
                }

                // Long-term gains at capital gains rates
                const testCapGainsTax = TaxService.calculateCapitalGainsTax(
                    lotResult.longTermGains,
                    ordinaryTaxableIncome + lotResult.shortTermGains,
                    taxState,
                    year,
                    assumptions
                );

                // State tax on long-term gains
                const stateBase = TaxService.calculateTax(currentStateIncome + lotResult.shortTermGains, 0, stateApplied);
                const stateNew = TaxService.calculateTax(currentStateIncome + lotResult.shortTermGains + lotResult.longTermGains, 0, stateApplied);
                const testStateCapGainsTax = stateNew - stateBase;

                const testTotalTax = testShortTermTax + testCapGainsTax + testStateCapGainsTax;
                const testNetReceived = testWithdrawal - testTotalTax;

                if (Math.abs(testNetReceived - deficit) < 1) {
                    grossWithdrawal = testWithdrawal;
                    break;
                }

                if (testWithdrawal >= availableBalance) {
                    grossWithdrawal = availableBalance;
                    break;
                }

                grossWithdrawal = testWithdrawal * (deficit / testNetReceived);
            }

            grossWithdrawal = Math.min(grossWithdrawal, availableBalance);
            const lotAllocation = account.calculateLotAwareWithdrawal(grossWithdrawal, year);

            // Final tax calculation
            let shortTermTax = 0;
            if (lotAllocation.shortTermGains > 0) {
                const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                const fedNew = TaxService.calculateTax(currentFedIncome + lotAllocation.shortTermGains, 0, fedApplied);
                const stBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                const stNew = TaxService.calculateTax(currentStateIncome + lotAllocation.shortTermGains, 0, stateApplied);
                shortTermTax = (fedNew - fedBase) + (stNew - stBase);
            }

            const capitalGainsTax = TaxService.calculateCapitalGainsTax(
                lotAllocation.longTermGains,
                ordinaryTaxableIncome + lotAllocation.shortTermGains,
                taxState,
                year,
                assumptions
            );

            const stateBase = TaxService.calculateTax(currentStateIncome + lotAllocation.shortTermGains, 0, stateApplied);
            const stateNew = TaxService.calculateTax(currentStateIncome + lotAllocation.shortTermGains + lotAllocation.longTermGains, 0, stateApplied);
            const stateCapGainsTax = stateNew - stateBase;

            taxHit = shortTermTax + capitalGainsTax + stateCapGainsTax;
            withdrawAmount = grossWithdrawal;

            const netReceived = grossWithdrawal - taxHit;
            deficit -= netReceived;

            // Short-term gains are taxed as ordinary income, track in withdrawalTaxes
            withdrawalState.withdrawalTaxes += shortTermTax;
            withdrawalState.totalGrossIncome += lotAllocation.shortTermGains;
            // Capital gains tax tracking:
            // - capitalGainsTaxTotal: used for withdrawal gross-up calculations (includes fed+state)
            // - stateCapitalGainsTax: state portion tracked separately for final tax assembly
            // - Federal LTCG+NIIT is calculated post-hoc via calculateTotalFederalTax
            withdrawalState.capitalGainsTaxTotal += capitalGainsTax + stateCapGainsTax;
            withdrawalState.stateCapitalGainsTax += stateCapGainsTax;
            // Track actual gains amounts for post-hoc federal tax calculation
            withdrawalState.longTermCapitalGains += lotAllocation.longTermGains;
            withdrawalState.shortTermCapitalGains += lotAllocation.shortTermGains;

            const totalGains = lotAllocation.shortTermGains + lotAllocation.longTermGains;
            if (totalGains > 0 || taxHit > 0) {
                logs.push(`[FLOW] Brokerage withdrawal: $${grossWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
                    `(Basis: $${lotAllocation.basisReturn.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                    `ST Gains: $${lotAllocation.shortTermGains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                    `LT Gains: $${lotAllocation.longTermGains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                    `Tax: $${taxHit.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
            }
        }
        // SCENARIO 4: ESPP Account
        else if (account instanceof ESPPAccount) {
            const saleDate = new Date(year, 6, 1);

            if (account.withdrawalPreference === 'dont_sell_until_qualifying') {
                const eligibleLots = account.getEligibleLots(saleDate);
                const hasQualifying = eligibleLots.some(lot => account.calculateDispositionType(lot, saleDate) === 'qualifying');
                if (!hasQualifying) {
                    logs.push(`[SKIP] ESPP ${account.name}: Skipping (no qualifying lots, preference set to wait)`);
                    continue;
                }
            }

            const eligibleLots = account.getEligibleLots(saleDate);
            const eligibleShares = eligibleLots.reduce((sum, lot) => sum + lot.shares, 0);

            if (eligibleShares === 0 && account.minimumHoldingDays > 0) {
                logs.push(`[SKIP] ESPP ${account.name}: Skipping (no lots meet ${account.minimumHoldingDays}-day holding requirement)`);
                continue;
            }

            if (account.totalShares === 0) {
                withdrawAmount = Math.min(deficit, availableBalance);
                deficit -= withdrawAmount;
                logs.push(`[FLOW] ESPP withdrawal (no lots): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
            } else {
                const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
                const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

                const currentFedIncome = withdrawalState.totalGrossIncome - preTaxDeductions;
                const stdDedFed = fedParams?.standardDeduction || 12950;
                const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
                const ordinaryTaxableIncome = Math.max(0, currentFedIncome - currentFedDeduction);

                const currentStateIncome = withdrawalState.totalGrossIncome - preTaxDeductions;
                const stdDedState = stateParams?.standardDeduction || 0;
                const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;
                const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                const lotOrder = getESPPLotOrder(account.withdrawalPreference);

                const currentPrice = account.amount / account.totalShares;
                const eligibleBalance = eligibleShares > 0 ? eligibleShares * currentPrice : availableBalance;
                const effectiveAvailableBalance = account.minimumHoldingDays > 0 ? Math.min(availableBalance, eligibleBalance) : availableBalance;

                let grossWithdrawal = deficit / 0.8;

                for (let i = 0; i < 10; i++) {
                    const testWithdrawal = Math.min(grossWithdrawal, effectiveAvailableBalance);
                    const sharesToSell = testWithdrawal / currentPrice;

                    const taxResult = account.calculateSaleTax(sharesToSell, currentPrice, saleDate, lotOrder, account.minimumHoldingDays > 0 ? eligibleLots : undefined);
                    const totalCapGains = taxResult.shortTermGains + taxResult.longTermGains;

                    const fedBase = TaxService.calculateTax(currentFedIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const fedNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const ordinaryTax = fedNew - fedBase;

                    const stateOrdBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                    const stateOrdNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                    const stateOrdinaryTax = stateOrdNew - stateOrdBase;

                    const capGainsTax = TaxService.calculateCapitalGainsTax(
                        taxResult.longTermGains,
                        ordinaryTaxableIncome + taxResult.ordinaryIncome + taxResult.shortTermGains,
                        taxState,
                        year,
                        assumptions
                    );

                    const fedShortBase = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const fedShortNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome + taxResult.shortTermGains, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                    const shortTermTax = fedShortNew - fedShortBase;

                    const stateCapBase = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                    const stateCapNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome + totalCapGains, 0, stateApplied);
                    const stateCapGainsTax = stateCapNew - stateCapBase;

                    const testTotalTax = ordinaryTax + stateOrdinaryTax + capGainsTax + shortTermTax + stateCapGainsTax;
                    const testNetReceived = testWithdrawal - testTotalTax;

                    if (Math.abs(testNetReceived - deficit) < 1) {
                        grossWithdrawal = testWithdrawal;
                        break;
                    }

                    if (testNetReceived > deficit) {
                        grossWithdrawal = testWithdrawal - (testNetReceived - deficit) * 0.8;
                    } else {
                        grossWithdrawal = testWithdrawal + (deficit - testNetReceived) * 1.2;
                    }
                }

                grossWithdrawal = Math.min(grossWithdrawal, effectiveAvailableBalance);
                const sharesToSell = grossWithdrawal / currentPrice;
                const taxResult = account.calculateSaleTax(sharesToSell, currentPrice, saleDate, lotOrder, account.minimumHoldingDays > 0 ? eligibleLots : undefined);
                const totalCapGains = taxResult.shortTermGains + taxResult.longTermGains;

                const fedBase = TaxService.calculateTax(currentFedIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                const fedNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                const ordinaryTax = fedNew - fedBase;

                const stateOrdBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                const stateOrdNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                const stateOrdinaryTax = stateOrdNew - stateOrdBase;

                const capGainsTax = TaxService.calculateCapitalGainsTax(
                    taxResult.longTermGains,
                    ordinaryTaxableIncome + taxResult.ordinaryIncome + taxResult.shortTermGains,
                    taxState,
                    year,
                    assumptions
                );

                const fedShortBase = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                const fedShortNew = TaxService.calculateTax(currentFedIncome + taxResult.ordinaryIncome + taxResult.shortTermGains, 0, { ...fedParams!, standardDeduction: currentFedDeduction });
                const shortTermTax = fedShortNew - fedShortBase;

                const stateCapBase = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome, 0, stateApplied);
                const stateCapNew = TaxService.calculateTax(currentStateIncome + taxResult.ordinaryIncome + totalCapGains, 0, stateApplied);
                const stateCapGainsTax = stateCapNew - stateCapBase;

                taxHit = ordinaryTax + stateOrdinaryTax + capGainsTax + shortTermTax + stateCapGainsTax;
                withdrawAmount = grossWithdrawal;

                const netReceived = grossWithdrawal - taxHit;
                deficit -= netReceived;

                withdrawalState.withdrawalTaxes += ordinaryTax + stateOrdinaryTax + shortTermTax;
                // Capital gains tax tracking (see brokerage section for architecture notes)
                withdrawalState.capitalGainsTaxTotal += capGainsTax + stateCapGainsTax;
                withdrawalState.stateCapitalGainsTax += stateCapGainsTax;
                withdrawalState.totalGrossIncome += taxResult.ordinaryIncome + taxResult.shortTermGains;
                // Track actual gains amounts for post-hoc federal tax calculation
                withdrawalState.longTermCapitalGains += taxResult.longTermGains;
                withdrawalState.shortTermCapitalGains += taxResult.shortTermGains;

                logs.push(`[FLOW] ESPP withdrawal: $${grossWithdrawal.toLocaleString(undefined, { maximumFractionDigits: 0 })} ` +
                    `(Ordinary: $${taxResult.ordinaryIncome.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                    `ST Gains: $${taxResult.shortTermGains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                    `LT Gains: $${taxResult.longTermGains.toLocaleString(undefined, { maximumFractionDigits: 0 })}, ` +
                    `Tax: $${taxHit.toLocaleString(undefined, { maximumFractionDigits: 0 })})`);
            }
        }
        // SCENARIO 5: Fallback
        else {
            withdrawAmount = Math.min(deficit, availableBalance);
            deficit -= withdrawAmount;
            logs.push(`[WARN] Fallback withdrawal from ${account.name}: ${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }

        // Apply Withdrawal
        withdrawalState.userInflows[account.id] = (withdrawalState.userInflows[account.id] || 0) - withdrawAmount;

        if (withdrawAmount > 0) {
            withdrawalState.totalWithdrawals += withdrawAmount;
            withdrawalState.withdrawalDetail[account.name] = (withdrawalState.withdrawalDetail[account.name] || 0) + withdrawAmount;
        }
    }

    // Final Adjustments
    withdrawalState.strategyWithdrawalExecuted = amountToWithdraw - deficit;

    // Floating point cleanup
    if (Math.abs(deficit) < 0.005) {
        deficit = 0;
    }

    discretionaryCash = -deficit;

    // Clean up small positive surplus from withdrawal solver rounding
    if (discretionaryCash > 0 && discretionaryCash < 2) {
        discretionaryCash = 0;
    }

    if (isRetired && withdrawalState.strategyWithdrawalExecuted > 0) {
        logs.push(`💰 Strategy withdrawal executed: $${withdrawalState.strategyWithdrawalExecuted.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
    }

    return { discretionaryCash, logs };
}

/**
 * Track deficit debt: if there's still an uncovered deficit after all withdrawals.
 */
export function processDeficitDebt(
    discretionaryCash: number,
    accounts: AnyAccount[],
    logs: string[]
): DeficitDebtResult {
    const DEFICIT_DEBT_ID = 'system-deficit-debt';
    const DEFICIT_DEBT_NAME = 'Uncovered Deficit';
    let deficitDebtPayment = 0;

    let existingDeficitDebt = accounts.find(
        acc => acc instanceof DeficitDebtAccount && acc.id === DEFICIT_DEBT_ID
    ) as DeficitDebtAccount | undefined;

    // Only create deficit debt for deficits > $0.005 (ignore small rounding errors)
    if (discretionaryCash < -0.005) {
        const uncoveredDeficit = Math.abs(discretionaryCash);

        if (existingDeficitDebt) {
            existingDeficitDebt = new DeficitDebtAccount(
                DEFICIT_DEBT_ID,
                DEFICIT_DEBT_NAME,
                existingDeficitDebt.amount + uncoveredDeficit
            );
        } else {
            existingDeficitDebt = new DeficitDebtAccount(
                DEFICIT_DEBT_ID,
                DEFICIT_DEBT_NAME,
                uncoveredDeficit
            );
        }

        logs.push(`[WARN] Uncovered deficit of $${uncoveredDeficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} added to deficit debt`);
        logs.push(`  Total deficit debt: $${existingDeficitDebt.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

        discretionaryCash = 0;
    }

    return { existingDeficitDebt, deficitDebtPayment, discretionaryCash, logs };
}

/**
 * Execute a pre-planned withdrawal allocation.
 * Used when tax optimization has already determined the optimal withdrawal mix.
 */
function executeWithdrawalPlan(
    discretionaryCash: number,
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    withdrawalState: WithdrawalState,
    plan: WithdrawalPlan,
    logs: string[]
): { discretionaryCash: number; logs: string[] } {
    let cash = discretionaryCash;

    // DEBUG: Log plan execution start (disabled - uncomment to enable)
    // console.log(`[executeWithdrawalPlan] Starting:`, {
    //     discretionaryCash,
    //     plan,
    //     existingWithdrawals: { ...withdrawalState.withdrawalDetail }
    // });

    logs.push(`📋 Executing tax-optimized withdrawal plan:`);

    // Withdraw from Traditional accounts
    // Tax on Traditional withdrawals is handled by unified tax calculation in SimulationEngine
    if (plan.traditional > 0) {
        const tradAccounts = accounts.filter(
            acc => acc instanceof InvestedAccount &&
            (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')
        ) as InvestedAccount[];

        let remaining = plan.traditional;
        for (const acc of tradAccounts) {
            if (remaining <= 0) break;
            const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
            const available = acc.amount + Math.min(0, priorOutflow);
            if (available <= 0) continue;

            const withdrawAmount = Math.min(remaining, available);
            withdrawalState.userInflows[acc.id] = (withdrawalState.userInflows[acc.id] || 0) - withdrawAmount;
            withdrawalState.totalWithdrawals += withdrawAmount;
            withdrawalState.withdrawalDetail[acc.name] = (withdrawalState.withdrawalDetail[acc.name] || 0) + withdrawAmount;
            withdrawalState.totalGrossIncome += withdrawAmount;  // Add to gross income for tax calc
            withdrawalState.traditionalWithdrawals += withdrawAmount;  // Track for unified tax calc
            cash += withdrawAmount;
            remaining -= withdrawAmount;
            logs.push(`  Traditional (${acc.name}): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // Withdraw from Roth accounts
    if (plan.roth > 0) {
        const rothAccounts = accounts.filter(
            acc => acc instanceof InvestedAccount &&
            (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA')
        ) as InvestedAccount[];

        let remaining = plan.roth;
        for (const acc of rothAccounts) {
            if (remaining <= 0) break;
            const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
            const available = acc.amount + Math.min(0, priorOutflow);
            if (available <= 0) continue;

            const withdrawAmount = Math.min(remaining, available);
            withdrawalState.userInflows[acc.id] = (withdrawalState.userInflows[acc.id] || 0) - withdrawAmount;
            withdrawalState.totalWithdrawals += withdrawAmount;
            withdrawalState.withdrawalDetail[acc.name] = (withdrawalState.withdrawalDetail[acc.name] || 0) + withdrawAmount;
            cash += withdrawAmount;
            remaining -= withdrawAmount;
            logs.push(`  Roth (${acc.name}): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // Withdraw from Brokerage accounts
    if (plan.brokerage > 0) {
        const brokerageAccounts = accounts.filter(
            acc => acc instanceof InvestedAccount && acc.taxType === 'Brokerage'
        ) as InvestedAccount[];

        let remaining = plan.brokerage;
        for (const acc of brokerageAccounts) {
            if (remaining <= 0) break;
            const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
            const available = acc.amount + Math.min(0, priorOutflow);
            if (available <= 0) continue;

            const withdrawAmount = Math.min(remaining, available);
            withdrawalState.userInflows[acc.id] = (withdrawalState.userInflows[acc.id] || 0) - withdrawAmount;
            withdrawalState.totalWithdrawals += withdrawAmount;
            withdrawalState.withdrawalDetail[acc.name] = (withdrawalState.withdrawalDetail[acc.name] || 0) + withdrawAmount;
            cash += withdrawAmount;
            remaining -= withdrawAmount;
            logs.push(`  Brokerage (${acc.name}): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // Withdraw from Savings accounts
    if (plan.savings > 0) {
        const savingsAccounts = accounts.filter(acc => acc instanceof SavedAccount);

        let remaining = plan.savings;
        for (const acc of savingsAccounts) {
            if (remaining <= 0) break;
            const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
            const available = acc.amount + Math.min(0, priorOutflow);
            if (available <= 0) continue;

            const withdrawAmount = Math.min(remaining, available);
            withdrawalState.userInflows[acc.id] = (withdrawalState.userInflows[acc.id] || 0) - withdrawAmount;
            withdrawalState.totalWithdrawals += withdrawAmount;
            withdrawalState.withdrawalDetail[acc.name] = (withdrawalState.withdrawalDetail[acc.name] || 0) + withdrawAmount;
            cash += withdrawAmount;
            remaining -= withdrawAmount;
            logs.push(`  Savings (${acc.name}): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }
    }

    // Fallback: If the plan couldn't cover the deficit (accounts depleted),
    // try to withdraw from any available account using the user's withdrawal strategy order
    if (cash < 0) {
        const remainingDeficit = Math.abs(cash);
        logs.push(`  ⚠️ Plan shortfall: $${remainingDeficit.toLocaleString(undefined, { maximumFractionDigits: 0 })} still needed, trying fallback`);

        // Use user's withdrawal strategy order for fallback (respects their preferences)
        const userStrategy = assumptions.withdrawalStrategy || [];
        const usedAccountIds = new Set<string>();

        let deficit = remainingDeficit;

        // First, try accounts in user's withdrawal strategy order
        for (const bucket of userStrategy) {
            if (deficit <= 0.01) break;
            const acc = accounts.find(a => a.id === bucket.accountId);
            if (!acc) continue;
            usedAccountIds.add(acc.id);

            const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
            const available = acc.amount + Math.min(0, priorOutflow);
            if (available <= 0) continue;

            const withdrawAmount = Math.min(deficit, available);
            withdrawalState.userInflows[acc.id] = (withdrawalState.userInflows[acc.id] || 0) - withdrawAmount;
            withdrawalState.totalWithdrawals += withdrawAmount;
            withdrawalState.withdrawalDetail[acc.name] = (withdrawalState.withdrawalDetail[acc.name] || 0) + withdrawAmount;

            // Track Traditional withdrawals for tax calculation
            if (acc instanceof InvestedAccount &&
                (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')) {
                withdrawalState.traditionalWithdrawals += withdrawAmount;
                withdrawalState.totalGrossIncome += withdrawAmount;
            }

            cash += withdrawAmount;
            deficit -= withdrawAmount;
            logs.push(`  Fallback (${acc.name}): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
        }

        // Then, try any remaining accounts not in the strategy (safety net)
        if (deficit > 0.01) {
            for (const acc of accounts) {
                if (deficit <= 0.01) break;
                if (usedAccountIds.has(acc.id)) continue;

                const priorOutflow = withdrawalState.userInflows[acc.id] || 0;
                const available = acc.amount + Math.min(0, priorOutflow);
                if (available <= 0) continue;

                const withdrawAmount = Math.min(deficit, available);
                withdrawalState.userInflows[acc.id] = (withdrawalState.userInflows[acc.id] || 0) - withdrawAmount;
                withdrawalState.totalWithdrawals += withdrawAmount;
                withdrawalState.withdrawalDetail[acc.name] = (withdrawalState.withdrawalDetail[acc.name] || 0) + withdrawAmount;

                // Track Traditional withdrawals for tax calculation
                if (acc instanceof InvestedAccount &&
                    (acc.taxType === 'Traditional 401k' || acc.taxType === 'Traditional IRA')) {
                    withdrawalState.traditionalWithdrawals += withdrawAmount;
                    withdrawalState.totalGrossIncome += withdrawAmount;
                }

                cash += withdrawAmount;
                deficit -= withdrawAmount;
                logs.push(`  Fallback (${acc.name}): $${withdrawAmount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
            }
        }
    }

    // DEBUG: Log final state (disabled - uncomment to enable)
    // console.log(`[executeWithdrawalPlan] Finished:`, {
    //     finalCash: cash,
    //     withdrawalDetail: { ...withdrawalState.withdrawalDetail }
    // });

    return { discretionaryCash: cash, logs };
}
