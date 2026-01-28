import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount } from "../../components/Objects/Accounts/models";
import { FilingStatus, TaxParameters } from "../../data/TaxData";
import * as TaxService from "../../components/Objects/Taxes/TaxService";

export type TaxCategory = 'tax-deferred' | 'tax-free' | 'taxable' | 'mixed';

/**
 * Classify an account by its tax treatment for withdrawal ordering.
 */
export function classifyAccountTaxCategory(account: AnyAccount): TaxCategory {
    if (account instanceof SavedAccount) return 'tax-free';
    if (account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Traditional 401k':
            case 'Traditional IRA':
                return 'tax-deferred';
            case 'Roth 401k':
            case 'Roth IRA':
            case 'HSA':
                return 'tax-free';
            case 'Brokerage':
            default:
                return 'taxable';
        }
    }
    if (account instanceof ESPPAccount) return 'mixed';
    return 'taxable';
}

/**
 * Calculate the effective tax cost of a Roth conversion, including the SS "tax torpedo" effect.
 *
 * When you do a Roth conversion, you not only pay tax on the conversion itself,
 * but the additional income can push more of your Social Security benefits into
 * taxable territory. This creates an effective marginal rate higher than the
 * stated bracket rate.
 */
export function calculateEffectiveConversionTax(
    nonSSIncome: number,
    totalSSBenefits: number,
    conversionAmount: number,
    filingStatus: FilingStatus,
    fedParams: TaxParameters
): { taxBefore: number; taxAfter: number; taxIncrease: number; effectiveRate: number } {
    // Calculate tax WITHOUT conversion
    const taxableSSBefore = TaxService.getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        nonSSIncome,
        filingStatus
    );
    const grossIncomeBefore = nonSSIncome + taxableSSBefore;
    const taxBefore = TaxService.calculateTax(grossIncomeBefore, 0, fedParams);

    // Calculate tax WITH conversion
    const newNonSSIncome = nonSSIncome + conversionAmount;
    const taxableSSAfter = TaxService.getTaxableSocialSecurityBenefits(
        totalSSBenefits,
        newNonSSIncome,
        filingStatus
    );
    const grossIncomeAfter = newNonSSIncome + taxableSSAfter;
    const taxAfter = TaxService.calculateTax(grossIncomeAfter, 0, fedParams);

    const taxIncrease = taxAfter - taxBefore;
    const effectiveRate = conversionAmount > 0 ? taxIncrease / conversionAmount : 0;

    return {
        taxBefore,
        taxAfter,
        taxIncrease,
        effectiveRate
    };
}

/**
 * Estimate the gross Traditional withdrawal needed to cover an expense deficit.
 * Used to reduce Roth conversion bracket headroom to avoid over-conversion.
 *
 * When smart withdrawals are enabled (taxOptimizationEnabled + early retiree + brokerage depleted),
 * Traditional withdrawals are limited to bracket headroom, with Roth covering the rest.
 * This function needs to account for that to avoid over-estimating Traditional usage.
 *
 * @param preliminaryCash - Cash available after income/expenses (negative = deficit)
 * @param accounts - All accounts
 * @param withdrawalStrategy - User's withdrawal order
 * @param bracketHeadroom - Optional: max Traditional withdrawal due to bracket-filling logic
 *                          If provided, caps the estimate at this amount.
 */
export function estimateTraditionalWithdrawalForExpenses(
    preliminaryCash: number,
    accounts: AnyAccount[],
    withdrawalStrategy: { accountId: string }[],
    bracketHeadroom?: number
): number {
    // No deficit means no Traditional withdrawal needed
    if (preliminaryCash >= 0) return 0;

    const deficit = Math.abs(preliminaryCash);
    let estimatedTraditionalWithdrawal = 0;
    let remainingDeficit = deficit;

    // Walk through withdrawal strategy order
    for (const bucket of withdrawalStrategy) {
        if (remainingDeficit <= 0) break;

        const account = accounts.find(acc => acc.id === bucket.accountId);
        if (!account) continue;

        // Only estimate for Traditional accounts
        const isTraditional = account instanceof InvestedAccount &&
            (account.taxType === 'Traditional 401k' || account.taxType === 'Traditional IRA');

        if (isTraditional) {
            const availableBalance = (account as InvestedAccount).vestedAmount;
            if (availableBalance <= 0) continue;

            // Use conservative 25% effective tax rate for estimation
            const ESTIMATED_TAX_RATE = 0.25;
            const grossNeeded = remainingDeficit / (1 - ESTIMATED_TAX_RATE);

            // Cap at available balance
            let grossWithdrawal = Math.min(grossNeeded, availableBalance);

            // If bracket headroom is provided (smart withdrawals), cap at that amount
            // Smart withdrawals only use Traditional to fill low brackets, rest from Roth
            if (bracketHeadroom !== undefined) {
                grossWithdrawal = Math.min(grossWithdrawal, bracketHeadroom - estimatedTraditionalWithdrawal);
                if (grossWithdrawal <= 0) {
                    // Bracket is full, remaining will come from Roth (tax-free)
                    break;
                }
            }

            estimatedTraditionalWithdrawal += grossWithdrawal;

            // Estimate net received from this withdrawal
            const netReceived = grossWithdrawal * (1 - ESTIMATED_TAX_RATE);
            remainingDeficit -= netReceived;
        } else {
            // Non-Traditional accounts - estimate net received 1:1
            let availableBalance = account.amount;
            if (account instanceof InvestedAccount) {
                availableBalance = account.vestedAmount;
            }
            const withdrawal = Math.min(remainingDeficit, availableBalance);
            remainingDeficit -= withdrawal;
        }
    }

    return estimatedTraditionalWithdrawal;
}
