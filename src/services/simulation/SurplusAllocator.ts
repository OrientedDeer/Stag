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
import { CapType } from "../../components/Objects/Assumptions/AssumptionsContext";

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
    /** Monthly expenses (used for MULTIPLE_OF_EXPENSES cap type) */
    monthlyExpenses?: number;
}

// =============================================================================
// MAIN FUNCTION
// =============================================================================

/**
 * Allocate surplus cash according to priority rules.
 *
 * @param surplus - Amount of surplus cash to allocate
 * @param accounts - All accounts (for finding targets)
 * @param priorityBuckets - User's priority bucket order with cap settings
 * @param earnedIncome - Earned income this year (for Roth IRA eligibility)
 * @param settings - Allocation settings
 * @returns Allocation plan
 */
export function allocateSurplus(
    surplus: number,
    accounts: AnyAccount[],
    priorityBuckets: { accountId: string; priority: number; capType?: CapType; capValue?: number }[],
    earnedIncome: number,
    settings: SurplusAllocationSettings
): SurplusAllocationResult {
    const allocations: PlannedSurplusAllocation[] = [];
    const decisions: DecisionLogEntry[] = [];
    let remaining = surplus;
    let deficitDebtPayment = 0;

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

    // Running total of Roth IRA contributions across ALL buckets in this pass.
    // settings.rothIRAContributedThisYear is a fixed snapshot (caller passes 0)
    // and is never mutated, so without this accumulator each Roth IRA bucket
    // would independently see the full annual limit as available room.
    let rothIRAContributedSoFar = settings.rothIRAContributedThisYear ?? 0;

    for (const bucket of sortedBuckets) {
        if (remaining <= 0) break;

        const account = accounts.find(a => a.id === bucket.accountId);
        if (!account) continue;

        // Determine cap for this bucket
        const capType = bucket.capType ?? 'REMAINDER';
        const capValue = bucket.capValue ?? 0;
        let bucketCap: number;

        switch (capType) {
            case 'FIXED':
                // capValue is monthly amount → annual
                bucketCap = capValue * 12;
                break;
            case 'MAX':
                // capValue is max annual allocation
                bucketCap = capValue;
                break;
            case 'MULTIPLE_OF_EXPENSES': {
                // capValue is number of months of expenses → desired END balance.
                // Subtract not just the start-of-year balance but also surplus
                // already routed to this account earlier in this pass, so we
                // don't overshoot the target balance.
                // NOTE: payroll/other same-year contributions applied elsewhere
                // are NOT visible here; fully closing that gap would require the
                // caller to pass a projected-contributions figure per account.
                const alreadyAllocatedThisAccount = allocations
                    .filter(a => a.accountId === account.id)
                    .reduce((sum, a) => sum + a.amount, 0);
                bucketCap = Math.max(0,
                    (settings.monthlyExpenses ?? 0) * capValue
                    - account.amount
                    - alreadyAllocatedThisAccount
                );
                break;
            }
            case 'REMAINDER':
            default:
                bucketCap = Infinity;
                break;
        }

        // Apply cap to what we can allocate from remaining surplus
        const maxForBucket = Math.min(remaining, bucketCap);
        if (maxForBucket <= 0) continue;

        // Handle different account types
        if (account instanceof SavedAccount) {
            const toAdd = maxForBucket;

            allocations.push({
                accountId: account.id,
                amount: toAdd,
                reason: capType === 'REMAINDER'
                    ? `Savings contribution (remainder)`
                    : `Savings contribution (${capType} cap: $${bucketCap.toLocaleString()})`,
            });

            decisions.push({
                category: 'surplus',
                account: account.name,
                amount: toAdd,
                description: `Allocated $${toAdd.toLocaleString()} to savings (${account.name}).`,
            });

            remaining -= toAdd;
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

                // Calculate available contribution room against the running
                // total so multiple Roth IRA buckets share the per-person limit.
                const contributionRoom = Math.max(0, settings.rothIRALimit - rothIRAContributedSoFar);
                const maxContribution = Math.min(maxForBucket, earnedIncome, contributionRoom);

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
                    rothIRAContributedSoFar += maxContribution;
                } else if (contributionRoom <= 0) {
                    decisions.push({
                        category: 'surplus',
                        account: account.name,
                        description: `Skipped Roth IRA contribution: annual limit reached.`,
                    });
                }
            } else if (account.taxType === 'Brokerage') {
                // Brokerage - allocate up to cap (or all remaining for REMAINDER)
                const toAdd = maxForBucket;

                allocations.push({
                    accountId: account.id,
                    amount: toAdd,
                    reason: capType === 'REMAINDER'
                        ? `Brokerage investment (surplus remainder)`
                        : `Brokerage investment (${capType} cap: $${bucketCap.toLocaleString()})`,
                });

                decisions.push({
                    category: 'surplus',
                    account: account.name,
                    amount: toAdd,
                    description: `Invested $${toAdd.toLocaleString()} surplus in brokerage.`,
                });

                remaining -= toAdd;
            }
            // Skip other account types (Traditional, etc.) for surplus allocation
        }
    }

    // Collect account IDs already allocated via priority buckets so catch-all
    // doesn't deposit additional surplus into a capped account.
    const bucketAccountIds = new Set(sortedBuckets.map(b => b.accountId));

    // 3. If there's still remaining surplus, find any brokerage account
    //    (skip accounts already in a priority bucket)
    if (remaining > 0) {
        const brokerage = accounts.find(a =>
            a instanceof InvestedAccount && a.taxType === 'Brokerage'
            && !bucketAccountIds.has(a.id)
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
    //    (skip accounts already in a priority bucket)
    if (remaining > 0) {
        const savings = accounts.find(a => a instanceof SavedAccount
            && !bucketAccountIds.has(a.id));

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

    // NOTE (review #2): surplus that exceeds every priority cap with no uncapped
    // destination is intentionally NOT force-deposited. A cap paces how much of
    // income is *saved*; the remainder is discretionary spending, not lost wealth
    // (force-filling a capped bucket would break FIXED/MAX caps and sinking-fund
    // reservations — see GoalSinkingFund). It is surfaced as `unallocated` below.
    const result = {
        allocations,
        decisions,
        deficitDebtPayment,
        unallocated: remaining,
    };
    return result;
}

