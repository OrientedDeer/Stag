/**
 * WithdrawalPlanner.ts
 *
 * Unified withdrawal planning for the SimulationEngine rewrite.
 *
 * Design Principles:
 * 1. Single code path - both basic and tax-optimized modes use this
 * 2. Algebraic gross-up - solves single-source withdrawals in 1 pass
 * 3. Account drain - withdraws entire balance when insufficient
 * 4. Savings preservation - savings moved to end of non-penalized accounts
 *
 * CRITICAL: Uses BASE deficit (expenses + ordinaryTax + FICA - income - RMD).
 * LTCG tax is NOT included in the deficit before grossing up - that causes double-counting.
 */

import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount } from "../../components/Objects/Accounts/models";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
import {
    PlannedWithdrawal,
    AccountBalanceSnapshot,
    WithdrawalAccountType,
    DecisionLogEntry,
} from "./types";
import * as TaxService from "../../components/Objects/Taxes/TaxService";

// =============================================================================
// CONSTANTS
// =============================================================================

const EARLY_WITHDRAWAL_AGE = 59.5;
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;

// =============================================================================
// TYPES
// =============================================================================

export interface WithdrawalPlanResult {
    withdrawals: PlannedWithdrawal[];
    totalGross: number;
    totalNet: number;
    totalTax: number;
    totalPenalties: number;
    totalLTCG: number;
    totalSTCG: number;
    remainingDeficit: number;
    decisions: DecisionLogEntry[];
}

// AccountWithdrawalContext interface removed - was unused

// =============================================================================
// ACCOUNT CLASSIFICATION
// =============================================================================

/**
 * Classify an account's tax type for withdrawal ordering.
 */
export function classifyAccount(account: AnyAccount): WithdrawalAccountType {
    if (account instanceof SavedAccount) return 'savings';
    if (account instanceof ESPPAccount) return 'espp';
    if (account instanceof InvestedAccount) {
        switch (account.taxType) {
            case 'Traditional 401k': return 'traditional_401k';
            case 'Traditional IRA': return 'traditional_ira';
            case 'Roth 401k': return 'roth_401k';
            case 'Roth IRA': return 'roth_ira';
            case 'HSA': return 'hsa';
            case 'Brokerage':
            default:
                return 'brokerage';
        }
    }
    return 'savings';
}

/**
 * Check if account type incurs early withdrawal penalty.
 */
export function hasEarlyWithdrawalPenalty(
    accountType: WithdrawalAccountType,
    age: number,
    isEarnings: boolean = false
): boolean {
    if (age >= EARLY_WITHDRAWAL_AGE) return false;

    switch (accountType) {
        case 'traditional_401k':
        case 'traditional_ira':
            return true;
        case 'roth_401k':
        case 'roth_ira':
            // Only earnings have penalty; contributions are penalty-free
            return isEarnings;
        case 'hsa':
            // HSA has penalty for non-medical withdrawals before 65
            return true;
        default:
            return false;
    }
}

// =============================================================================
// ACCOUNT SNAPSHOTTING
// =============================================================================

/**
 * Create a balance snapshot from an account.
 */
export function createAccountSnapshot(account: AnyAccount, snapshotDate?: Date): AccountBalanceSnapshot {
    const accountType = classifyAccount(account);

    let vestedBalance = account.amount;
    let gainRatio = 0;
    let rothContributions: number | undefined;
    let conversionHistory: { year: number; amount: number }[] | undefined;
    let esppLots: AccountBalanceSnapshot['esppLots'];

    if (account instanceof ESPPAccount) {
        // ESPP: pre-compute per-lot disposition data using existing functions
        const saleDate = snapshotDate ?? new Date();
        const sharePrice = account.currentSharePrice ?? (account.amount / Math.max(1, account.totalShares));

        esppLots = account.lots.map(lot => {
            const dispositionType = account.calculateDispositionType(lot, saleDate);

            // Use calculateSaleTax to get proper tax breakdown for this lot
            const taxResult = account.calculateSaleTax(
                lot.shares,
                sharePrice,
                saleDate,
                'fifo',
                [lot] // Just this lot
            );

            const ordinaryIncomePerShare = lot.shares > 0 ? taxResult.ordinaryIncome / lot.shares : 0;
            const ltcgPerShare = lot.shares > 0 ? taxResult.longTermGains / lot.shares : 0;
            const totalValue = lot.shares * sharePrice;

            return {
                lotId: lot.id,
                shares: lot.shares,
                currentValuePerShare: sharePrice,
                purchasePricePerShare: lot.purchasePrice,
                dispositionType,
                ordinaryIncomePerShare,
                ltcgPerShare,
                totalValue,
            };
        });

        // Calculate gain ratio for ESPP using lot data (totalCost may not be set)
        const totalCostBasis = account.lots.reduce((sum, lot) => {
            // Use totalCost if available, otherwise compute from purchasePrice × shares
            const lotCost = lot.totalCost ?? (lot.purchasePrice * lot.shares);
            return sum + lotCost;
        }, 0);
        const unrealizedGains = Math.max(0, account.amount - totalCostBasis);
        gainRatio = account.amount > 0 ? unrealizedGains / account.amount : 0;
    } else if (account instanceof InvestedAccount) {
        vestedBalance = account.vestedAmount;

        // Calculate gain ratio for brokerage accounts
        if (accountType === 'brokerage') {
            const unrealizedGains = account.amount - account.costBasis;
            gainRatio = account.amount > 0 ? Math.max(0, unrealizedGains / account.amount) : 0;
        }

        // Track Roth contribution basis
        if (accountType === 'roth_ira' || accountType === 'roth_401k') {
            rothContributions = account.regularContributions ?? 0;
            conversionHistory = account.conversionHistory ?? [];
        }
    }

    return {
        accountId: account.id,
        accountName: account.name,
        accountType,
        balance: account.amount,
        vestedBalance,
        gainRatio,
        rothContributions,
        conversionHistory,
        esppLots,
    };
}

/**
 * Create snapshots for all accounts in withdrawal order.
 * Savings is moved to end of non-penalized accounts.
 */
export function createOrderedSnapshots(
    accounts: AnyAccount[],
    withdrawalOrder: { accountId: string }[],
    currentAge: number,
    year?: number
): AccountBalanceSnapshot[] {
    const snapshots: AccountBalanceSnapshot[] = [];
    const savingsSnapshots: AccountBalanceSnapshot[] = [];
    const penalizedSnapshots: AccountBalanceSnapshot[] = [];

    // Use mid-year date for ESPP disposition calculations
    const snapshotDate = year ? new Date(year, 5, 15) : undefined;

    // Process in user's configured order
    for (const bucket of withdrawalOrder) {
        const account = accounts.find(a => a.id === bucket.accountId);
        if (!account) continue;

        const snapshot = createAccountSnapshot(account, snapshotDate);

        // Separate into categories
        if (snapshot.accountType === 'savings') {
            savingsSnapshots.push(snapshot);
        } else if (hasEarlyWithdrawalPenalty(snapshot.accountType, currentAge)) {
            penalizedSnapshots.push(snapshot);
        } else {
            snapshots.push(snapshot);
        }
    }

    // Final order: non-penalized → savings → penalized
    return [...snapshots, ...savingsSnapshots, ...penalizedSnapshots];
}

// =============================================================================
// GROSS-UP FORMULAS
// =============================================================================

/**
 * Calculate gross withdrawal needed for a given net from savings.
 * No tax, no penalty.
 */
function grossUpSavings(netNeeded: number): { gross: number; tax: number; penalty: number } {
    return { gross: netNeeded, tax: 0, penalty: 0 };
}

/**
 * Calculate gross withdrawal needed for a given net from brokerage.
 * Uses algebraic formula: gross = net / (1 - gainRatio × ltcgRate)
 */
function grossUpBrokerage(
    netNeeded: number,
    gainRatio: number,
    ltcgRate: number
): { gross: number; tax: number; ltcg: number } {
    if (gainRatio <= 0) {
        // No gains - no tax
        return { gross: netNeeded, tax: 0, ltcg: 0 };
    }

    const effectiveRate = gainRatio * ltcgRate;
    const gross = netNeeded / (1 - effectiveRate);
    const ltcg = gross * gainRatio;
    const tax = ltcg * ltcgRate;

    return { gross, tax, ltcg };
}

/**
 * Calculate gross withdrawal needed for a given net from Traditional accounts.
 * Uses algebraic formula: gross = net / (1 - marginalRate - penaltyRate)
 */
function grossUpTraditional(
    netNeeded: number,
    marginalRate: number,
    age: number
): { gross: number; tax: number; penalty: number } {
    const penaltyRate = age < EARLY_WITHDRAWAL_AGE ? EARLY_WITHDRAWAL_PENALTY_RATE : 0;
    const effectiveRate = marginalRate + penaltyRate;

    // Guard against division by zero or negative rates
    if (effectiveRate >= 1) {
        // This shouldn't happen, but guard against it
        return { gross: netNeeded * 2, tax: netNeeded * marginalRate * 2, penalty: netNeeded * penaltyRate * 2 };
    }

    const gross = netNeeded / (1 - effectiveRate);
    const tax = gross * marginalRate;
    const penalty = gross * penaltyRate;

    return { gross, tax, penalty };
}

/**
 * Calculate gross withdrawal needed for Roth accounts.
 * Follows IRS ordering: contributions → conversions → earnings.
 */
function grossUpRoth(
    netNeeded: number,
    contributionBasis: number,
    conversionHistory: { year: number; amount: number }[],
    currentYear: number,
    age: number,
    marginalRate: number
): { gross: number; tax: number; penalty: number; fromContributions: number; fromConversions: number; fromEarnings: number } {
    let remaining = netNeeded;
    let fromContributions = 0;
    let fromConversions = 0;
    let fromEarnings = 0;
    let tax = 0;
    let penalty = 0;

    // 1. Contributions first - tax-free, penalty-free
    if (contributionBasis > 0 && remaining > 0) {
        const fromContrib = Math.min(remaining, contributionBasis);
        fromContributions = fromContrib;
        remaining -= fromContrib;
    }

    // 2. Conversions second - FIFO by year, 5-year rule for penalty
    if (remaining > 0 && conversionHistory.length > 0) {
        // Sort by year (oldest first)
        const sortedConversions = [...conversionHistory].sort((a, b) => a.year - b.year);

        for (const conv of sortedConversions) {
            if (remaining <= 0) break;

            const yearsHeld = currentYear - conv.year;
            const penaltyApplies = age < EARLY_WITHDRAWAL_AGE && yearsHeld < 5;

            const fromThisConv = Math.min(remaining, conv.amount);
            fromConversions += fromThisConv;

            if (penaltyApplies) {
                // Need to gross up for penalty
                const penaltyOnConv = fromThisConv * EARLY_WITHDRAWAL_PENALTY_RATE;
                penalty += penaltyOnConv;
            }

            remaining -= fromThisConv;
        }
    }

    // 3. Earnings last - tax + penalty if under 59.5
    if (remaining > 0) {
        if (age < EARLY_WITHDRAWAL_AGE) {
            // Earnings are taxed as ordinary income + 10% penalty
            const penaltyRate = EARLY_WITHDRAWAL_PENALTY_RATE;
            const effectiveRate = marginalRate + penaltyRate;

            // Gross up the remaining need
            const grossEarnings = remaining / (1 - effectiveRate);
            fromEarnings = grossEarnings;
            tax = grossEarnings * marginalRate;
            penalty += grossEarnings * penaltyRate;
        } else {
            // After 59.5, earnings are tax-free too (qualified distribution)
            fromEarnings = remaining;
        }
    }

    const gross = fromContributions + fromConversions + fromEarnings;

    return { gross, tax, penalty, fromContributions, fromConversions, fromEarnings };
}

// =============================================================================
// MAIN PLANNING FUNCTION
// =============================================================================

/**
 * Plan withdrawals to cover a net deficit.
 *
 * @param netNeeded - Net amount needed after all taxes
 * @param accountOrder - Ordered list of accounts to tap
 * @param currentAge - Current age for penalty calculations
 * @param year - Current simulation year
 * @param taxState - Tax state for rate lookups
 * @param currentOrdinaryIncome - Current ordinary income (for marginal rate)
 * @param assumptions - Simulation assumptions
 * @param reason - Reason for withdrawal (for logging)
 * @returns Withdrawal plan with all details
 */
export function planWithdrawals(
    netNeeded: number,
    accountOrder: AccountBalanceSnapshot[],
    currentAge: number,
    year: number,
    taxState: TaxState,
    currentOrdinaryIncome: number,
    assumptions: AssumptionsState | undefined,
    reason: PlannedWithdrawal['reason'] = 'Spending deficit',
    acaWithdrawalOptions?: { acaCliffThreshold: number; currentMAGI: number }
): WithdrawalPlanResult {
    const withdrawals: PlannedWithdrawal[] = [];
    const decisions: DecisionLogEntry[] = [];

    let remainingNetNeeded = netNeeded;
    let totalGross = 0;
    let totalNet = 0;
    let totalTax = 0;
    let totalPenalties = 0;
    let totalLTCG = 0;
    let totalSTCG = 0;
    let cumulativeLTCG = 0; // Tracks LTCG from brokerage/ESPP for ACA MAGI headroom
    let runningOrdinaryIncome = currentOrdinaryIncome;

    // Get tax parameters
    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

    // Get LTCG rate based on current ordinary income
    const getLTCGRate = (ordinaryIncome: number): number => {
        if (!fedParams?.capitalGainsBrackets) return 0.15;

        // Find applicable rate based on ordinary income
        const brackets = fedParams.capitalGainsBrackets;
        for (let i = brackets.length - 1; i >= 0; i--) {
            if (ordinaryIncome >= brackets[i].threshold) {
                return brackets[i].rate;
            }
        }
        return brackets[0]?.rate ?? 0;
    };

    // Get marginal ordinary rate
    const getMarginalRate = (ordinaryIncome: number): number => {
        if (!fedParams) return 0.22; // Default to 22%

        const result = TaxService.getMarginalTaxRate(
            Math.max(0, ordinaryIncome - fedParams.standardDeduction),
            fedParams
        );
        return result.rate;
    };

    // Get state marginal rate
    const getStateRate = (): number => {
        if (!stateParams) return 0;
        const result = TaxService.getMarginalTaxRate(
            Math.max(0, currentOrdinaryIncome - stateParams.standardDeduction),
            stateParams
        );
        return result.rate;
    };

    const stateRate = getStateRate();

    // DEBUG: Log withdrawal planning (disabled - uncomment to enable)
    // console.log('\n--- WITHDRAWAL PLANNER ---');
    // console.log('netNeeded:', netNeeded);
    // console.log('accounts in order:');
    // for (const s of accountOrder) {
    //     console.log(`  ${s.accountName} (${s.accountType}): vestedBalance=$${s.vestedBalance.toFixed(2)}`);
    // }

    // Process each account in order
    for (const snapshot of accountOrder) {
        if (remainingNetNeeded <= 0) break;
        if (snapshot.vestedBalance <= 0) continue;

        const ltcgRate = getLTCGRate(runningOrdinaryIncome);
        const marginalRate = getMarginalRate(runningOrdinaryIncome) + stateRate;

        let withdrawal: PlannedWithdrawal;

        switch (snapshot.accountType) {
            case 'savings': {
                const result = grossUpSavings(remainingNetNeeded);
                const grossToWithdraw = Math.min(result.gross, snapshot.vestedBalance);
                const netReceived = grossToWithdraw;

                withdrawal = {
                    source: 'savings',
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    penalty: 0,
                    tax: 0,
                    reason,
                };

                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                break;
            }

            case 'brokerage': {
                const result = grossUpBrokerage(remainingNetNeeded, snapshot.gainRatio, ltcgRate);
                const grossToWithdraw = Math.min(result.gross, snapshot.vestedBalance);

                // Recalculate for actual amount if capped
                const actualGainRatio = snapshot.gainRatio;
                const actualLTCG = grossToWithdraw * actualGainRatio;
                const actualTax = actualLTCG * ltcgRate;
                const netReceived = grossToWithdraw - actualTax;

                withdrawal = {
                    source: 'brokerage',
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    capitalGains: { shortTerm: 0, longTerm: actualLTCG },
                    penalty: 0,
                    tax: actualTax,
                    reason,
                };

                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                totalTax += actualTax;
                totalLTCG += actualLTCG;
                break;
            }

            case 'traditional_401k':
            case 'traditional_ira': {
                const result = grossUpTraditional(remainingNetNeeded, marginalRate, currentAge);
                const grossToWithdraw = Math.min(result.gross, snapshot.vestedBalance);

                // Recalculate for actual amount if capped
                const penaltyRate = currentAge < EARLY_WITHDRAWAL_AGE ? EARLY_WITHDRAWAL_PENALTY_RATE : 0;
                const actualPenalty = grossToWithdraw * penaltyRate;
                const actualTax = grossToWithdraw * marginalRate;
                const netReceived = grossToWithdraw - actualTax - actualPenalty;

                withdrawal = {
                    source: snapshot.accountType,
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    penalty: actualPenalty,
                    tax: actualTax,
                    reason,
                };

                // Traditional withdrawal adds to ordinary income
                runningOrdinaryIncome += grossToWithdraw;

                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                totalTax += actualTax;
                totalPenalties += actualPenalty;

                if (actualPenalty > 0) {
                    decisions.push({
                        category: 'withdrawal',
                        account: snapshot.accountName,
                        amount: actualPenalty,
                        description: `Early withdrawal penalty of $${actualPenalty.toFixed(0)} on Traditional withdrawal.`,
                    });
                }
                break;
            }

            case 'roth_401k':
            case 'roth_ira': {
                const result = grossUpRoth(
                    remainingNetNeeded,
                    snapshot.rothContributions ?? 0,
                    snapshot.conversionHistory ?? [],
                    year,
                    currentAge,
                    marginalRate
                );
                const grossToWithdraw = Math.min(result.gross, snapshot.vestedBalance);

                // For simplicity, if we can't withdraw the full gross, pro-rate the components
                const ratio = grossToWithdraw / result.gross;
                const actualTax = result.tax * ratio;
                const actualPenalty = result.penalty * ratio;
                const netReceived = grossToWithdraw - actualTax - actualPenalty;

                withdrawal = {
                    source: snapshot.accountType,
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    penalty: actualPenalty,
                    tax: actualTax,
                    reason,
                };

                // Roth earnings (if any) add to ordinary income
                if (result.fromEarnings > 0 && currentAge < EARLY_WITHDRAWAL_AGE) {
                    runningOrdinaryIncome += result.fromEarnings * ratio;
                }

                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                totalTax += actualTax;
                totalPenalties += actualPenalty;

                if (actualPenalty > 0) {
                    decisions.push({
                        category: 'withdrawal',
                        account: snapshot.accountName,
                        amount: actualPenalty,
                        description: `Early withdrawal penalty of $${actualPenalty.toFixed(0)} on Roth withdrawal (5-year rule).`,
                    });
                }
                break;
            }

            case 'hsa': {
                // HSA withdrawals for non-healthcare are taxed as ordinary + 20% penalty before 65
                const penaltyRate = currentAge < 65 ? 0.20 : 0;
                const effectiveRate = marginalRate + penaltyRate;
                const gross = remainingNetNeeded / (1 - effectiveRate);
                const grossToWithdraw = Math.min(gross, snapshot.vestedBalance);

                const actualPenalty = grossToWithdraw * penaltyRate;
                const actualTax = grossToWithdraw * marginalRate;
                const netReceived = grossToWithdraw - actualTax - actualPenalty;

                withdrawal = {
                    source: 'hsa',
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    penalty: actualPenalty,
                    tax: actualTax,
                    reason,
                };

                runningOrdinaryIncome += grossToWithdraw;
                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                totalTax += actualTax;
                totalPenalties += actualPenalty;

                if (actualPenalty > 0) {
                    decisions.push({
                        category: 'warning',
                        account: snapshot.accountName,
                        amount: actualPenalty,
                        description: `HSA withdrawal for non-healthcare incurs 20% penalty of $${actualPenalty.toFixed(0)}.`,
                    });
                }
                break;
            }

            case 'espp': {
                const esppLots = snapshot.esppLots;

                // Use pre-computed lot data if available
                if (esppLots && esppLots.length > 0) {
                    // Estimate gross needed
                    const estimatedGross = Math.min(
                        remainingNetNeeded / (1 - snapshot.gainRatio * ltcgRate),
                        snapshot.vestedBalance
                    );

                    // Walk lots in order, consuming shares until we have enough
                    let grossToWithdraw = 0;
                    let esppOrdinaryIncome = 0;
                    let esppLTCG = 0;
                    let remainingGrossNeeded = estimatedGross;

                    for (const lot of esppLots) {
                        if (remainingGrossNeeded <= 0) break;

                        const lotValue = lot.totalValue;
                        const valueToUse = Math.min(lotValue, remainingGrossNeeded);
                        const shareRatio = lotValue > 0 ? valueToUse / lotValue : 0;
                        const sharesUsed = lot.shares * shareRatio;

                        grossToWithdraw += valueToUse;
                        esppOrdinaryIncome += sharesUsed * lot.ordinaryIncomePerShare;
                        esppLTCG += sharesUsed * lot.ltcgPerShare;
                        remainingGrossNeeded -= valueToUse;
                    }

                    if (grossToWithdraw <= 0) {
                        continue; // Skip to next account if no value to withdraw
                    }

                    // Calculate taxes: ordinary income at marginal rate, LTCG at cap gains rate
                    const marginalRate = getMarginalRate(runningOrdinaryIncome);
                    const stateRate = getStateRate();
                    const combinedOrdinaryRate = marginalRate + stateRate;

                    const ordinaryTax = esppOrdinaryIncome * combinedOrdinaryRate;
                    const ltcgTax = esppLTCG * ltcgRate;
                    const actualTax = ordinaryTax + ltcgTax;

                    const netReceived = grossToWithdraw - actualTax;

                    withdrawal = {
                        source: 'espp',
                        accountId: snapshot.accountId,
                        accountName: snapshot.accountName,
                        gross: grossToWithdraw,
                        net: netReceived,
                        capitalGains: { shortTerm: 0, longTerm: esppLTCG },
                        penalty: 0,
                        tax: actualTax,
                        reason,
                    };

                    // ESPP ordinary income affects tax bracket
                    runningOrdinaryIncome += esppOrdinaryIncome;

                    remainingNetNeeded -= netReceived;
                    totalNet += netReceived;
                    totalGross += grossToWithdraw;
                    totalTax += actualTax;
                    totalLTCG += esppLTCG;

                    // Log ESPP ordinary income decision
                    if (esppOrdinaryIncome > 0) {
                        const dispositionTypes = [...new Set(esppLots.map(l => l.dispositionType))].join('/');
                        decisions.push({
                            category: 'tax',
                            account: snapshot.accountName,
                            amount: esppOrdinaryIncome,
                            description: `ESPP withdrawal: $${esppOrdinaryIncome.toLocaleString()} ordinary income (${dispositionTypes} disposition), $${esppLTCG.toLocaleString()} LTCG.`,
                        });
                    }
                } else {
                    // Fallback: treat like brokerage if no ESPP lot data
                    const result = grossUpBrokerage(remainingNetNeeded, snapshot.gainRatio, ltcgRate);
                    const grossToWithdraw = Math.min(result.gross, snapshot.vestedBalance);

                    const actualLTCG = grossToWithdraw * snapshot.gainRatio;
                    const actualTax = actualLTCG * ltcgRate;
                    const netReceived = grossToWithdraw - actualTax;

                    withdrawal = {
                        source: 'espp',
                        accountId: snapshot.accountId,
                        accountName: snapshot.accountName,
                        gross: grossToWithdraw,
                        net: netReceived,
                        capitalGains: { shortTerm: 0, longTerm: actualLTCG },
                        penalty: 0,
                        tax: actualTax,
                        reason,
                    };

                    remainingNetNeeded -= netReceived;
                    totalNet += netReceived;
                    totalGross += grossToWithdraw;
                    totalTax += actualTax;
                    totalLTCG += actualLTCG;
                }
                break;
            }

            default:
                continue;
        }

        withdrawals.push(withdrawal);

        // DEBUG: Log each withdrawal (disabled - uncomment to enable)
        // console.log(`  -> ${snapshot.accountName}: gross=$${withdrawal.gross.toFixed(2)}, net=$${withdrawal.net.toFixed(2)}, remainingNeeded=$${remainingNetNeeded.toFixed(2)}`);

        // Log the withdrawal
        decisions.push({
            category: 'withdrawal',
            account: snapshot.accountName,
            amount: withdrawal.gross,
            description: `Withdrew $${withdrawal.gross.toLocaleString()} from ${snapshot.accountName} (net: $${withdrawal.net.toLocaleString()}).`,
        });
    }

    // DEBUG: Final state (disabled - uncomment to enable)
    // console.log(`  RESULT: totalNet=$${totalNet.toFixed(2)}, remainingDeficit=$${Math.max(0, remainingNetNeeded).toFixed(2)}`);
    // console.log('--- END WITHDRAWAL PLANNER ---\n');

    // Log if there's remaining deficit
    if (remainingNetNeeded > 0) {
        decisions.push({
            category: 'warning',
            amount: remainingNetNeeded,
            description: `Unfunded deficit of $${remainingNetNeeded.toLocaleString()}. All accounts exhausted.`,
        });
    }

    return {
        withdrawals,
        totalGross,
        totalNet,
        totalTax,
        totalPenalties,
        totalLTCG,
        totalSTCG,
        remainingDeficit: Math.max(0, remainingNetNeeded),
        decisions,
    };
}

/**
 * Plan withdrawals for RMD satisfaction.
 * RMDs are gross = net (no tax withheld at withdrawal time).
 */
export function planRMDWithdrawal(
    rmdAmount: number,
    accountId: string,
    accountName: string
): PlannedWithdrawal {
    return {
        source: 'traditional_ira', // or traditional_401k
        accountId,
        accountName,
        gross: rmdAmount,
        net: rmdAmount, // RMD is not net-of-tax - the tax is paid separately
        penalty: 0,
        tax: 0, // Tax is calculated on the income, not withheld from withdrawal
        reason: 'Required Minimum Distribution',
    };
}
