/**
 * SurplusAllocator.ts
 *
 * Handles surplus allocation after all expenses and taxes are covered.
 *
 * Surplus occurs when:
 * - RMDs exceed spending needs
 * - Pension + SS fully covers expenses
 * - Working year with excess income
 *
 * Allocation Priority (reuses paycheck allocator logic):
 * 1. Pay down DeficitDebt first (if any exists)
 * 2. Follow user's priority bucket order
 * 3. Any remaining: Brokerage (default catch-all)
 */

import { AnyAccount, SavedAccount, InvestedAccount, DeficitDebtAccount } from "../../components/Objects/Accounts/models";
import { PlannedSurplusAllocation, DecisionLogEntry } from "./types";

// =============================================================================
// TYPES
// =============================================================================

export interface SurplusAllocationResult {
    allocations: PlannedSurplusAllocation[];
    decisions: DecisionLogEntry[];
    /** Amount allocated to pay down deficit debt */
    deficitDebtPayment: number;
    /** Amount that couldn't be allocated (shouldn't happen) */
    unallocated: number;
}

export interface SurplusAllocationSettings {
    /** Target emergency fund balance */
    emergencyFundTarget: number;
    /** Whether Roth IRA contributions are enabled in priority buckets */
    rothIRAContributionEnabled: boolean;
    /** Annual Roth IRA contribution limit */
    rothIRALimit: number;
    /** Amount already contributed to Roth IRA this year */
    rothIRAContributedThisYear: number;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Allocate surplus cash according to priority rules.
 *
 * @param surplus - Amount of surplus cash to allocate
 * @param accounts - All accounts (for finding targets)
 * @param priorityBuckets - User's priority bucket order (account IDs)
 * @param earnedIncome - Earned income this year (for Roth IRA eligibility)
 * @param settings - Allocation settings
 * @returns Allocation plan
 */
export function allocateSurplus(
    surplus: number,
    accounts: AnyAccount[],
    priorityBuckets: { accountId: string; priority: number }[],
    earnedIncome: number,
    settings: SurplusAllocationSettings
): SurplusAllocationResult {
    const allocations: PlannedSurplusAllocation[] = [];
    const decisions: DecisionLogEntry[] = [];
    let remaining = surplus;
    let deficitDebtPayment = 0;

    // DEBUG: Log allocator input (disabled - uncomment to enable)
    // console.log('ALLOCATOR input surplus:', surplus);

    if (surplus <= 0) {
        return { allocations, decisions, deficitDebtPayment: 0, unallocated: 0 };
    }

    // 1. Pay down DeficitDebt first
    const deficitDebt = accounts.find(a => a instanceof DeficitDebtAccount) as DeficitDebtAccount | undefined;
    if (deficitDebt && deficitDebt.amount > 0) {
        const payment = Math.min(remaining, deficitDebt.amount);
        deficitDebtPayment = payment;
        remaining -= payment;

        allocations.push({
            accountId: deficitDebt.id,
            amount: payment,
            reason: `Paying down deficit debt balance of $${deficitDebt.amount.toLocaleString()}`,
        });

        decisions.push({
            category: 'surplus',
            account: 'DeficitDebt',
            amount: payment,
            description: `Paid down $${payment.toLocaleString()} of deficit debt.`,
        });

        if (remaining <= 0) {
            return { allocations, decisions, deficitDebtPayment, unallocated: 0 };
        }
    }

    // 2. Follow priority bucket order (or use smart defaults if no priorities configured)
    const sortedBuckets = [...priorityBuckets].sort((a, b) => a.priority - b.priority);

    // If no explicit priorities, use smart defaults: Emergency → Roth IRA → Brokerage
    if (sortedBuckets.length === 0) {
        // 2a. Find and fill emergency fund (SavedAccount) to target
        const emergencyFund = accounts.find(a => a instanceof SavedAccount) as SavedAccount | undefined;
        if (emergencyFund && emergencyFund.amount < settings.emergencyFundTarget) {
            const gap = settings.emergencyFundTarget - emergencyFund.amount;
            const toAdd = Math.min(remaining, gap);

            if (toAdd > 0) {
                allocations.push({
                    accountId: emergencyFund.id,
                    amount: toAdd,
                    reason: `Emergency fund contribution (target: $${settings.emergencyFundTarget.toLocaleString()}, current: $${emergencyFund.amount.toLocaleString()})`,
                });

                decisions.push({
                    category: 'surplus',
                    account: emergencyFund.name,
                    amount: toAdd,
                    description: `Allocated $${toAdd.toLocaleString()} to emergency fund (${emergencyFund.name}).`,
                });

                remaining -= toAdd;
            }
        }

        // 2b. Find and contribute to Roth IRA (if eligible)
        if (remaining > 0 && settings.rothIRAContributionEnabled && earnedIncome > 0) {
            const rothIRA = accounts.find(a =>
                a instanceof InvestedAccount && a.taxType === 'Roth IRA'
            ) as InvestedAccount | undefined;

            if (rothIRA) {
                const contributionRoom = Math.max(0, settings.rothIRALimit - settings.rothIRAContributedThisYear);
                const maxContribution = Math.min(remaining, earnedIncome, contributionRoom);

                if (maxContribution > 0) {
                    allocations.push({
                        accountId: rothIRA.id,
                        amount: maxContribution,
                        reason: `Roth IRA contribution (earned income: $${earnedIncome.toLocaleString()}, room: $${contributionRoom.toLocaleString()})`,
                    });

                    decisions.push({
                        category: 'surplus',
                        account: rothIRA.name,
                        amount: maxContribution,
                        description: `Contributed $${maxContribution.toLocaleString()} to Roth IRA.`,
                    });

                    remaining -= maxContribution;
                }
            }
        }

        // 2c. Put remainder in brokerage (handled by step 3 below)
    }

    for (const bucket of sortedBuckets) {
        if (remaining <= 0) break;

        const account = accounts.find(a => a.id === bucket.accountId);
        if (!account) continue;

        // Handle different account types
        if (account instanceof SavedAccount) {
            // Emergency fund / savings - fill up to target
            const currentBalance = account.amount;
            const target = settings.emergencyFundTarget;

            if (currentBalance < target) {
                const toAdd = Math.min(remaining, target - currentBalance);

                allocations.push({
                    accountId: account.id,
                    amount: toAdd,
                    reason: `Emergency fund contribution (target: $${target.toLocaleString()}, current: $${currentBalance.toLocaleString()})`,
                });

                decisions.push({
                    category: 'surplus',
                    account: account.name,
                    amount: toAdd,
                    description: `Allocated $${toAdd.toLocaleString()} to emergency fund (${account.name}).`,
                });

                remaining -= toAdd;
            }
        } else if (account instanceof InvestedAccount) {
            // Check if it's a Roth IRA
            if (account.taxType === 'Roth IRA') {
                // Can only contribute if there's earned income
                if (!settings.rothIRAContributionEnabled) {
                    decisions.push({
                        category: 'surplus',
                        account: account.name,
                        description: `Skipped Roth IRA contribution: contributions not enabled in settings.`,
                    });
                    continue;
                }

                if (earnedIncome <= 0) {
                    decisions.push({
                        category: 'surplus',
                        account: account.name,
                        description: `Skipped Roth IRA contribution: no earned income this year.`,
                    });
                    continue;
                }

                // Calculate available contribution room
                const contributionRoom = Math.max(0, settings.rothIRALimit - settings.rothIRAContributedThisYear);
                const maxContribution = Math.min(remaining, earnedIncome, contributionRoom);

                if (maxContribution > 0) {
                    allocations.push({
                        accountId: account.id,
                        amount: maxContribution,
                        reason: `Roth IRA contribution (earned income: $${earnedIncome.toLocaleString()}, room: $${contributionRoom.toLocaleString()})`,
                    });

                    decisions.push({
                        category: 'surplus',
                        account: account.name,
                        amount: maxContribution,
                        description: `Contributed $${maxContribution.toLocaleString()} to Roth IRA.`,
                    });

                    remaining -= maxContribution;
                } else if (contributionRoom <= 0) {
                    decisions.push({
                        category: 'surplus',
                        account: account.name,
                        description: `Skipped Roth IRA contribution: annual limit reached.`,
                    });
                }
            } else if (account.taxType === 'Brokerage') {
                // Brokerage - catch-all, takes all remaining
                allocations.push({
                    accountId: account.id,
                    amount: remaining,
                    reason: `Brokerage investment (surplus remainder)`,
                });

                decisions.push({
                    category: 'surplus',
                    account: account.name,
                    amount: remaining,
                    description: `Invested $${remaining.toLocaleString()} surplus in brokerage.`,
                });

                remaining = 0;
            }
            // Skip other account types (Traditional, etc.) for surplus allocation
        }
    }

    // 3. If there's still remaining surplus, find any brokerage account
    if (remaining > 0) {
        const brokerage = accounts.find(a =>
            a instanceof InvestedAccount && a.taxType === 'Brokerage'
        );

        if (brokerage) {
            allocations.push({
                accountId: brokerage.id,
                amount: remaining,
                reason: `Brokerage investment (default catch-all)`,
            });

            decisions.push({
                category: 'surplus',
                account: brokerage.name,
                amount: remaining,
                description: `Invested remaining $${remaining.toLocaleString()} surplus in brokerage (default).`,
            });

            remaining = 0;
        }
    }

    // 4. If STILL remaining (no brokerage account), find any savings account
    if (remaining > 0) {
        const savings = accounts.find(a => a instanceof SavedAccount);

        if (savings) {
            allocations.push({
                accountId: savings.id,
                amount: remaining,
                reason: `Savings (no brokerage available)`,
            });

            decisions.push({
                category: 'surplus',
                account: savings.name,
                amount: remaining,
                description: `Deposited remaining $${remaining.toLocaleString()} surplus in savings (no brokerage available).`,
            });

            remaining = 0;
        }
    }

    const result = {
        allocations,
        decisions,
        deficitDebtPayment,
        unallocated: remaining,
    };
    // DEBUG: Log allocator output (disabled - uncomment to enable)
    // console.log('ALLOCATOR output allocations:', JSON.stringify(result.allocations));
    return result;
}

/**
 * Get default surplus allocation settings.
 */
export function getDefaultSurplusSettings(year: number): SurplusAllocationSettings {
    // Roth IRA limits increase over time
    // 2024: $7,000 (under 50), $8,000 (50+)
    // Assume inflation adjustment of ~$500 every few years
    const baseYear = 2024;
    const baseLimit = 7000;
    const yearsFromBase = Math.max(0, year - baseYear);
    const inflationAdjustments = Math.floor(yearsFromBase / 3) * 500;

    return {
        emergencyFundTarget: 30000, // Default 6 months of expenses
        rothIRAContributionEnabled: true,
        rothIRALimit: baseLimit + inflationAdjustments,
        rothIRAContributedThisYear: 0,
    };
}
