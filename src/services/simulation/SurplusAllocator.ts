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

import { AnyAccount, SavedAccount, InvestedAccount, DeficitDebtAccount, DebtAccount } from "../../components/Objects/Accounts/models";
import { PlannedSurplusAllocation, DecisionLogEntry } from "./types";
import { CapType, getBucketTargetBalance } from "../../components/Objects/Assumptions/AssumptionsContext";

// =============================================================================
// DEBT-PAYDOWN ELIGIBILITY (#60 C) — single source of truth
// =============================================================================

/**
 * Sub-cent balances are treated as paid off ([5]): a loan amortized to a float
 * residual (e.g. $0.0001) must NOT be a fundable paydown — that would emit a $0
 * paydown line and a spurious Sankey edge.
 */
export const DEBT_PAYOFF_EPSILON = 0.005;

/**
 * Is this account a user debt the user may ADD as a surplus-paydown priority?
 * This is the OFFERING predicate — it does NOT check the balance, so a debt the
 * user keeps stays addable/listable even at a $0 balance (the balance fluctuates
 * over the projection; the engine just won't pay a $0 debt at sim time).
 *
 * #60 (linked-debt rework): a surplus paydown works by reducing the linked
 * LoanExpense's balance (the authoritative figure — see the engine apply in
 * SimulationEngine). So eligibility REQUIRES a backing loan ([1]:
 * `linkedAccountId` set). Every REAL debt is a LoanExpense↔DebtAccount pair, so
 * this offers exactly the payable debts and excludes a legacy/imported UNLINKED
 * DebtAccount (which the solver builds no cap for → would be offered but never
 * paid). The system DeficitDebtAccount (overdraft, paid in step 1) is excluded.
 */
export function isOfferableDebt(account: AnyAccount | undefined | null): account is DebtAccount {
    return account instanceof DebtAccount
        && !(account instanceof DeficitDebtAccount)
        && !!account.linkedAccountId;
}

/**
 * Is this an offerable debt that ALSO has a real (above sub-cent, [5]) balance to
 * pay down RIGHT NOW? A $0/near-$0 debt is offerable but not paid. (The real
 * per-year cap is the linked LoanExpense's post-amortization balance, supplied by
 * the solver via settings.debtPaydownCaps.)
 */
export function isSurplusPaydownDebt(account: AnyAccount | undefined | null): account is DebtAccount {
    return isOfferableDebt(account) && account.amount > DEBT_PAYOFF_EPSILON;
}

/**
 * The POST-interest balance the engine must fund to clear a debt to $0 this
 * year. AccountGrowth grows an unlinked debt by APR and THEN subtracts the
 * paydown inflow, so the amount that actually zeroes it is amount*(1+apr/100).
 * Shared so the waterfall preview ([4]) sizes the same figure the engine spends.
 */
export function postInterestDebtBalance(debt: DebtAccount): number {
    return debt.amount * (1 + debt.apr / 100);
}

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
    /** Monthly expenses (used for the MULTIPLE_OF_EXPENSES balance-target cap type; TARGET doesn't need it) */
    monthlyExpenses?: number;
    /**
     * Accounts reserved for a dedicated purpose (goal sinking funds) that the
     * smart-default path must never pick as a general savings target.
     */
    reservedAccountIds?: Set<string>;
    /**
     * #60 (linked-debt rework): per-debt-account paydown cap = the linked
     * LoanExpense's POST-amortization balance this year (the authoritative figure
     * the engine will actually reduce). Keyed by DebtAccount id. A debt bucket is
     * paid min(remaining, cap); any excess flows to lower buckets via the normal
     * capped-bucket waterfall. Absent/0 ⇒ nothing to pay (no linked loan or
     * already $0), so surplus passes the bucket by. Supplied by the solver, which
     * is the only place the post-amortization expense balance is visible.
     */
    debtPaydownCaps?: Record<string, number>;
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

    // (#60 C). User-orderable debt paydown is handled INSIDE the priority-bucket
    // loop below: an unlinked DebtAccount placed in the priority list is paid
    // down when the waterfall reaches its rank (see the DebtAccount branch in
    // the bucket loop). There is no separate hardcoded debt step — the order is
    // 100% user-decided. The system DeficitDebt paydown (step 1) stays first.

    // 2. Follow priority bucket order (or use smart defaults if no priorities configured)
    const sortedBuckets = [...priorityBuckets].sort((a, b) => a.priority - b.priority);

    // If no explicit priorities, use smart defaults: Emergency → Roth IRA → Brokerage
    if (sortedBuckets.length === 0) {
        // 2a. Find and fill emergency fund (SavedAccount) to target — skipping
        // reserved accounts (goal sinking funds), which are funded directly by
        // the engine and must not absorb general surplus.
        const emergencyFund = accounts.find(a =>
            a instanceof SavedAccount && !settings.reservedAccountIds?.has(a.id)
        ) as SavedAccount | undefined;
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

    // [0] Running total paid to each debt across ALL buckets in this pass. The cap
    // (the loan balance) is fixed for the year, so a debt appearing in TWO buckets
    // would otherwise allocate up-to-cap TWICE and over-consume `remaining` (the
    // engine clamps the 2nd paydown to $0, so that surplus would silently VANISH
    // instead of flowing to lower buckets). Decrementing the cap by what's already
    // been allocated makes the 2nd occurrence see ~0 cap and allocate nothing.
    const debtPaidSoFar: Record<string, number> = {};

    for (const bucket of sortedBuckets) {
        if (remaining <= 0) break;

        const account = accounts.find(a => a.id === bucket.accountId);
        if (!account) continue;

        // (#60 linked-debt rework) Debt-paydown bucket. A DebtAccount placed in
        // the priority list is paid down when the waterfall reaches its rank. Its
        // cap is the linked LoanExpense's POST-amortization balance for the year,
        // supplied by the solver in settings.debtPaydownCaps (the only place that
        // figure is visible). The engine applies the paydown by reducing that
        // LoanExpense's balance (NOT the account mirror — see SimulationEngine),
        // so this allocation just records WHO and HOW MUCH; the allocation's
        // accountId is the DebtAccount id.
        //
        // Excess (surplus beyond the cap) is left in `remaining` and flows to the
        // lower priority buckets via the normal capped-bucket waterfall — no
        // post-hoc refund needed. Deficit is handled in step 1.
        if (account instanceof DebtAccount) {
            // [0]/[1] Gate on the LOAN-derived cap, NOT the DebtAccount MIRROR.
            // isOfferableDebt excludes the system deficit + requires a backing loan
            // but does NOT read account.amount — so a stale/$0 mirror with an owing
            // loan still pays down (the cap, built from the loan balance, decides
            // how much). The previous isSurplusPaydownDebt(account) gate read the
            // mirror and dropped the paydown in that case.
            if (!isOfferableDebt(account)) continue;

            // Cap = linked loan's post-amortization balance (solver-supplied),
            // LESS anything already allocated to this same debt earlier in the
            // pass ([0] — so a debt in two buckets never over-consumes `remaining`
            // and leaks surplus). Absent/0 ⇒ no linked loan or already paid ⇒ skip.
            const debtCap = settings.debtPaydownCaps?.[account.id] ?? 0;
            const remainingCap = Math.max(0, debtCap - (debtPaidSoFar[account.id] ?? 0));
            // [5] Treat a sub-cent remaining cap as paid off so a float residue
            // (debtCap − debtPaidSoFar ≈ 1e-9) doesn't emit a microscopic "$0 paid"
            // allocation + Sankey artifact.
            const payment = Math.min(remaining, remainingCap);
            if (payment <= DEBT_PAYOFF_EPSILON) continue;

            const paidDisplay = Math.round(payment).toLocaleString();
            const balanceDisplay = Math.round(debtCap).toLocaleString();

            allocations.push({
                accountId: account.id,
                amount: payment,
                reason: `Paying down $${paidDisplay} of ${account.name} ($${balanceDisplay} balance, ${account.apr}% APR)`,
            });
            decisions.push({
                category: 'surplus',
                account: account.name,
                amount: payment,
                description: `Paid down $${paidDisplay} of ${account.name} (${account.apr}% APR).`,
            });

            debtPaidSoFar[account.id] = (debtPaidSoFar[account.id] ?? 0) + payment;
            remaining -= payment;
            continue;
        }

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
            case 'TARGET':
            case 'MULTIPLE_OF_EXPENSES': {
                // Balance target → fund the gap to the desired END balance
                // (TARGET: capValue dollars; MULTIPLE_OF_EXPENSES: months ×
                // expenses — see getBucketTargetBalance).
                // Subtract not just the start-of-year balance but also surplus
                // already routed to this account earlier in this pass, so we
                // don't overshoot the target balance.
                // NOTE: payroll/other same-year contributions applied elsewhere
                // are NOT visible here; fully closing that gap would require the
                // caller to pass a projected-contributions figure per account.
                const targetBalance = getBucketTargetBalance(
                    { capType, capValue },
                    settings.monthlyExpenses ?? 0
                )!;
                const alreadyAllocatedThisAccount = allocations
                    .filter(a => a.accountId === account.id)
                    .reduce((sum, a) => sum + a.amount, 0);
                bucketCap = Math.max(0,
                    targetBalance
                    - account.amount
                    - alreadyAllocatedThisAccount
                );
                break;
            }
            case 'REMAINDER':
                bucketCap = Infinity;
                break;
            default: {
                // Exhaustiveness guard: a forgotten CapType would otherwise
                // fail dangerous-open (Infinity cap swallows all surplus).
                const _exhaustive: never = capType;
                throw new Error(`Unhandled capType: ${_exhaustive as string}`);
            }
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
    //    (skip accounts already in a priority bucket, and reserved goal funds
    //    which are funded directly by the engine)
    if (remaining > 0) {
        const savings = accounts.find(a => a instanceof SavedAccount
            && !bucketAccountIds.has(a.id)
            && !settings.reservedAccountIds?.has(a.id));

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

