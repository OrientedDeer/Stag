/**
 * Withdrawal Tax Estimation Service
 *
 * Estimates the tax impact of withdrawals by walking the withdrawal order
 * and calculating expected tax for each account type.
 *
 * This replaces the naive "assume all Traditional" estimate with exact math:
 * - Savings/Checking: gross = net (no tax)
 * - Brokerage: gross = net / (1 - gain_ratio × ltcg_rate)
 * - Traditional: gross = net / (1 - marginal_rate - penalty_rate)
 * - Roth: gross = net (for contributions)
 */

import { AnyAccount, InvestedAccount, SavedAccount } from '../../components/Objects/Accounts/models';
import { WithdrawalBucket } from '../../components/Objects/Assumptions/AssumptionsContext';
import { getTaxParameters } from '../../components/Objects/Taxes/TaxService';
import { FilingStatus } from '../../data/TaxData';

export interface WithdrawalTaxEstimate {
    /** Total estimated tax across all withdrawal sources */
    estimatedTax: number;
    /** Total gross withdrawal needed to net the deficit after tax */
    estimatedGrossWithdrawal: number;
    /** Early withdrawal penalty (10% for Traditional before 59.5) */
    earlyWithdrawalPenalty: number;
    /** Breakdown by account type */
    breakdown: {
        savings: number;
        brokerage: number;
        traditional: number;
        roth: number;
    };
}

/**
 * Estimate the tax impact of withdrawals by walking the withdrawal order.
 *
 * @param deficit - The net amount needed (expenses - income)
 * @param accounts - All accounts
 * @param withdrawalOrder - The user's withdrawal strategy order
 * @param currentAge - Current age (affects early withdrawal penalty)
 * @param filingStatus - Tax filing status
 * @param year - Tax year
 * @returns Estimated tax and gross withdrawal breakdown
 */
export function estimateWithdrawalTax(
    deficit: number,
    accounts: AnyAccount[],
    withdrawalOrder: WithdrawalBucket[],
    currentAge: number,
    filingStatus: FilingStatus,
    year: number
): WithdrawalTaxEstimate {
    if (deficit <= 0) {
        return {
            estimatedTax: 0,
            estimatedGrossWithdrawal: 0,
            earlyWithdrawalPenalty: 0,
            breakdown: { savings: 0, brokerage: 0, traditional: 0, roth: 0 }
        };
    }

    let remainingDeficit = deficit;
    let totalTax = 0;
    let totalPenalty = 0;
    let totalGross = 0;
    const breakdown = { savings: 0, brokerage: 0, traditional: 0, roth: 0 };

    // Track cumulative ordinary income for marginal rate calculation
    let cumulativeOrdinaryIncome = 0;

    // Get tax parameters for marginal rate calculations
    const fedParams = getTaxParameters(year, filingStatus, 'federal', undefined, undefined);
    const standardDeduction = fedParams?.standardDeduction || 14600;

    const isEarlyWithdrawal = currentAge < 59.5;

    // Walk the withdrawal order
    for (const bucket of withdrawalOrder) {
        if (remainingDeficit <= 0) break;

        const account = accounts.find(a => a.id === bucket.accountId);
        if (!account || account.amount <= 0) continue;

        const available = account.amount;

        if (account instanceof SavedAccount) {
            // Savings: no tax
            const withdrawAmount = Math.min(remainingDeficit, available);
            breakdown.savings += withdrawAmount;
            totalGross += withdrawAmount;
            remainingDeficit -= withdrawAmount;

        } else if (account instanceof InvestedAccount) {
            const taxType = account.taxType;

            if (taxType === 'Brokerage') {
                // Brokerage: capital gains tax on gains portion
                const gainRatio = account.amount > 0
                    ? Math.max(0, account.unrealizedGains) / account.amount
                    : 0;

                // Estimate LTCG rate based on income
                // Under standard deduction: 0%
                // Up to ~$44k taxable: 0%
                // $44k - $492k: 15%
                // Above: 20%
                const taxableIncome = Math.max(0, cumulativeOrdinaryIncome - standardDeduction);
                let ltcgRate = 0;
                if (taxableIncome > 492300) {
                    ltcgRate = 0.20;
                } else if (taxableIncome > 44625) {
                    ltcgRate = 0.15;
                } else {
                    ltcgRate = 0; // 0% bracket
                }

                // Also consider state tax (~5% average)
                const stateRate = 0.05;
                const effectiveTaxRate = gainRatio * (ltcgRate + stateRate);

                // gross = net / (1 - effectiveTaxRate)
                const grossNeeded = effectiveTaxRate < 1
                    ? remainingDeficit / (1 - effectiveTaxRate)
                    : remainingDeficit;

                const withdrawAmount = Math.min(grossNeeded, available);
                const taxOnWithdrawal = withdrawAmount * gainRatio * (ltcgRate + stateRate);

                breakdown.brokerage += withdrawAmount;
                totalGross += withdrawAmount;
                totalTax += taxOnWithdrawal;
                remainingDeficit -= (withdrawAmount - taxOnWithdrawal);

            } else if (taxType === 'Traditional 401k' || taxType === 'Traditional IRA') {
                // Traditional: ordinary income tax + possible 10% penalty
                // Estimate marginal rate based on cumulative income
                const taxableBeforeWithdrawal = Math.max(0, cumulativeOrdinaryIncome - standardDeduction);

                // Simple marginal rate estimation (2024 brackets, single)
                let marginalRate = 0.10;
                if (taxableBeforeWithdrawal > 609350) marginalRate = 0.37;
                else if (taxableBeforeWithdrawal > 243725) marginalRate = 0.35;
                else if (taxableBeforeWithdrawal > 191950) marginalRate = 0.32;
                else if (taxableBeforeWithdrawal > 100525) marginalRate = 0.24;
                else if (taxableBeforeWithdrawal > 47150) marginalRate = 0.22;
                else if (taxableBeforeWithdrawal > 11600) marginalRate = 0.12;

                // Add state tax estimate (~5%)
                const stateRate = 0.05;
                const penaltyRate = isEarlyWithdrawal ? 0.10 : 0;
                const effectiveRate = marginalRate + stateRate + penaltyRate;

                // gross = net / (1 - effectiveRate)
                const grossNeeded = effectiveRate < 1
                    ? remainingDeficit / (1 - effectiveRate)
                    : remainingDeficit * 2; // Safety fallback

                const withdrawAmount = Math.min(grossNeeded, available);
                const taxOnWithdrawal = withdrawAmount * (marginalRate + stateRate);
                const penaltyOnWithdrawal = isEarlyWithdrawal ? withdrawAmount * 0.10 : 0;

                breakdown.traditional += withdrawAmount;
                totalGross += withdrawAmount;
                totalTax += taxOnWithdrawal;
                totalPenalty += penaltyOnWithdrawal;
                cumulativeOrdinaryIncome += withdrawAmount;
                remainingDeficit -= (withdrawAmount - taxOnWithdrawal - penaltyOnWithdrawal);

            } else if (taxType === 'Roth 401k' || taxType === 'Roth IRA') {
                // Roth: contributions are tax-free, earnings may be taxed if early
                const contributions = account.regularContributions || 0;

                if (isEarlyWithdrawal) {
                    // IRS ordering rules: contributions first (tax-free)
                    const taxFreeAmount = Math.min(remainingDeficit, contributions, available);
                    if (taxFreeAmount > 0) {
                        breakdown.roth += taxFreeAmount;
                        totalGross += taxFreeAmount;
                        remainingDeficit -= taxFreeAmount;
                    }

                    // If still need more, earnings are taxed + 10% penalty
                    if (remainingDeficit > 0 && available > contributions) {
                        const earningsAvailable = available - contributions;
                        const marginalRate = 0.12; // Conservative estimate
                        const effectiveRate = marginalRate + 0.05 + 0.10; // Fed + state + penalty

                        const grossNeeded = remainingDeficit / (1 - effectiveRate);
                        const withdrawAmount = Math.min(grossNeeded, earningsAvailable);
                        const taxOnWithdrawal = withdrawAmount * (marginalRate + 0.05);
                        const penaltyOnWithdrawal = withdrawAmount * 0.10;

                        breakdown.roth += withdrawAmount;
                        totalGross += withdrawAmount;
                        totalTax += taxOnWithdrawal;
                        totalPenalty += penaltyOnWithdrawal;
                        remainingDeficit -= (withdrawAmount - taxOnWithdrawal - penaltyOnWithdrawal);
                    }
                } else {
                    // After 59.5 and 5-year rule: all tax-free
                    const withdrawAmount = Math.min(remainingDeficit, available);
                    breakdown.roth += withdrawAmount;
                    totalGross += withdrawAmount;
                    remainingDeficit -= withdrawAmount;
                }

            } else if (taxType === 'HSA') {
                // HSA: tax-free for qualified medical expenses
                // For general retirement, treat as Traditional
                const marginalRate = 0.12;
                const penaltyRate = isEarlyWithdrawal && currentAge < 65 ? 0.20 : 0;
                const effectiveRate = marginalRate + 0.05 + penaltyRate;

                const grossNeeded = remainingDeficit / (1 - effectiveRate);
                const withdrawAmount = Math.min(grossNeeded, available);
                const taxOnWithdrawal = withdrawAmount * (marginalRate + 0.05);
                const penaltyOnWithdrawal = withdrawAmount * penaltyRate;

                breakdown.traditional += withdrawAmount; // Treat as traditional for breakdown
                totalGross += withdrawAmount;
                totalTax += taxOnWithdrawal;
                totalPenalty += penaltyOnWithdrawal;
                remainingDeficit -= (withdrawAmount - taxOnWithdrawal - penaltyOnWithdrawal);
            }
        }
    }

    return {
        estimatedTax: totalTax,
        estimatedGrossWithdrawal: totalGross,
        earlyWithdrawalPenalty: totalPenalty,
        breakdown
    };
}
