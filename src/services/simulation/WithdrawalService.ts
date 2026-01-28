import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, DeficitDebtAccount, getESPPLotOrder } from "../../components/Objects/Accounts/models";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { SimulationYear, WithdrawalState } from "./types";

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
 * Execute withdrawals to cover expense deficits.
 * Walks through the withdrawal strategy order, applying tax scenarios per account type.
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
    logs: string[]
): { discretionaryCash: number; logs: string[] } {
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
        else if (account instanceof InvestedAccount && (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA')) {
            const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
            const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

            const currentFedIncome = withdrawalState.totalGrossIncome - preTaxDeductions;
            const currentStateIncome = withdrawalState.totalGrossIncome - preTaxDeductions;

            const stdDedFed = fedParams?.standardDeduction || 12950;
            const stdDedState = stateParams?.standardDeduction || 0;
            const currentFedDeduction = taxState.deductionMethod === 'Standard' ? stdDedFed : 0;
            const currentStateDeduction = taxState.deductionMethod === 'Standard' ? stdDedState : 0;

            const penaltyRate = isEarly ? 0.10 : 0;
            const result = TaxService.calculateGrossWithdrawal(
                Math.min(deficit, availableBalance),
                currentFedIncome,
                currentFedDeduction,
                currentStateIncome,
                currentStateDeduction,
                taxState,
                year,
                assumptions,
                penaltyRate
            );

            if (result.grossWithdrawn > availableBalance) {
                withdrawAmount = availableBalance;

                const fedApplied = { ...fedParams!, standardDeduction: currentFedDeduction };
                const stateApplied = { ...stateParams!, standardDeduction: currentStateDeduction };

                const fedBase = TaxService.calculateTax(currentFedIncome, 0, fedApplied);
                const fedNew = TaxService.calculateTax(currentFedIncome + withdrawAmount, 0, fedApplied);
                const stateBase = TaxService.calculateTax(currentStateIncome, 0, stateApplied);
                const stateNew = TaxService.calculateTax(currentStateIncome + withdrawAmount, 0, stateApplied);

                taxHit = (fedNew - fedBase) + (stateNew - stateBase);
                const actualPenalty = withdrawAmount * penaltyRate;
                withdrawalState.withdrawalPenalties += actualPenalty;
                deficit -= (withdrawAmount - taxHit - actualPenalty);
            } else {
                withdrawAmount = result.grossWithdrawn;
                taxHit = result.totalTax;
                withdrawalState.withdrawalPenalties += result.penalty;
                deficit -= deficit; // Fully covered
            }

            withdrawalState.totalGrossIncome += withdrawAmount;
            withdrawalState.withdrawalTaxes += taxHit;
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
            // Long-term gains tracked in capitalGainsTaxTotal
            withdrawalState.capitalGainsTaxTotal += capitalGainsTax + stateCapGainsTax;

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
                withdrawalState.capitalGainsTaxTotal += capGainsTax + stateCapGainsTax;
                withdrawalState.totalGrossIncome += taxResult.ordinaryIncome + taxResult.shortTermGains;

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

    if (discretionaryCash < 0) {
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
