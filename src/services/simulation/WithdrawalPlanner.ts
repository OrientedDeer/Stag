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

import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, RSUAccount } from "../../components/Objects/Accounts/models";
import { TaxState } from "../../components/Objects/Taxes/TaxContext";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
import {
    PlannedWithdrawal,
    AccountBalanceSnapshot,
    WithdrawalAccountType,
    DecisionLogEntry,
} from "./types";
import * as TaxService from "../../components/Objects/Taxes/TaxService";
import { getLTCGRate as getLTCGRateForIncome } from "../../components/Objects/Taxes/taxService/capitalGainsTax";
import { TaxBracket } from "../../data/TaxData";

// =============================================================================
// CONSTANTS
// =============================================================================

const EARLY_WITHDRAWAL_AGE = 59.5;
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;

// IRS annual limit on a net capital loss deductible against ordinary income
// (§1211(b)). Used to cap the tax benefit of selling underwater RSU lots so an
// uncapped loss can't refund unlimited tax or push net proceeds above gross.
// (Carry-forward of the disallowed excess is not modeled.)
const ANNUAL_CAPITAL_LOSS_LIMIT = 3000;

// BUG #14 FIX: gross-up divides by (1 - effectiveRate). If a combined
// marginal+penalty rate reaches or exceeds 1, the denominator is <= 0 and the
// gross-up returns Infinity/NaN, which then propagates into the plan totals.
// Clamp the divisor to a small positive floor so the output stays finite (and
// conservatively large) instead of exploding. 0.01 mirrors the ESPP guard below.
const MIN_GROSSUP_DENOMINATOR = 0.01;
export function grossUpDivisor(effectiveRate: number): number {
    return Math.max(MIN_GROSSUP_DENOMINATOR, 1 - effectiveRate);
}

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
function classifyAccount(account: AnyAccount): WithdrawalAccountType {
    if (account instanceof SavedAccount) return 'savings';
    if (account instanceof ESPPAccount) return 'espp';
    if (account instanceof RSUAccount) return 'rsu';
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
function hasEarlyWithdrawalPenalty(
    accountType: WithdrawalAccountType,
    age: number,
    isEarnings: boolean = false
): boolean {
    // HSA non-medical withdrawals are penalized (20%) until age 65, not 59.5.
    if (accountType === 'hsa') return age < 65;

    if (age >= EARLY_WITHDRAWAL_AGE) return false;

    switch (accountType) {
        case 'traditional_401k':
        case 'traditional_ira':
            return true;
        case 'roth_401k':
        case 'roth_ira':
            // Only earnings have penalty; contributions are penalty-free
            return isEarnings;
        // 'hsa' is handled above (penalized until 65, not 59.5).
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
    let rsuLots: AccountBalanceSnapshot['rsuLots'];
    let brokerageLots: AccountBalanceSnapshot['brokerageLots'];

    if (account instanceof RSUAccount) {
        // RSU: pre-compute per-lot capital-gains data. RSU shares were already
        // taxed as ordinary income at vest, so a sale only realizes capital
        // gains/losses (sale - fmvAtVest basis), short- or long-term by hold time.
        const saleDate = snapshotDate ?? new Date();
        const sharePrice = account.currentSharePrice ?? (account.amount / Math.max(1, account.totalShares));

        // Only lots past minimumHoldingDays are sellable, and walk them in the
        // account's configured withdrawalPreference order so the planner's tax
        // estimate matches the lots growAccounts/removeSoldShares actually
        // removes (which sorts by the same preference).
        const eligibleLots = account.getEligibleLots(saleDate);
        const orderedEligibleLots = account.orderLotsForSale(eligibleLots, saleDate);

        rsuLots = orderedEligibleLots.map(lot => ({
            lotId: lot.id,
            shares: lot.shares,
            currentValuePerShare: sharePrice,
            gainPerShare: sharePrice - lot.fmvAtVest,
            isLongTerm: account.isLongTerm(lot, saleDate),
            totalValue: lot.shares * sharePrice,
        }));

        // Cap sellable value at the eligible lots only (ineligible lots are not
        // liquid). vestedBalance is what the planner is allowed to draw against.
        vestedBalance = orderedEligibleLots.reduce((sum, lot) => sum + lot.shares * sharePrice, 0);

        const unrealizedGains = Math.max(0, account.amount - account.totalCostBasis);
        gainRatio = account.amount > 0 ? unrealizedGains / account.amount : 0;
    } else if (account instanceof ESPPAccount) {
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

            // Per-lot holding-period split (#75). FIFO order (oldest purchaseYear
            // first) matches the model's actual lot removal. Long-term iff held
            // >= 2 calendar years — the same year-granularity convention as
            // calculateLotAwareWithdrawal (models.tsx): >= 1 would misclassify a
            // Dec→Jan (~1-month) hold as long-term, AND would make the feature
            // inert, since withdrawals are planned before the current-year lot is
            // appended so the newest plan-time lot is purchaseYear = currentYear-1.
            // Absent → planner falls back to the proportional gainRatio (all LTCG).
            if (account.lots && account.lots.length > 0) {
                const currentYear = (snapshotDate ?? new Date()).getFullYear();
                brokerageLots = [...account.lots]
                    .sort((a, b) => a.purchaseYear - b.purchaseYear)
                    .map(lot => ({
                        purchaseYear: lot.purchaseYear,
                        totalValue: lot.currentValue,
                        gain: Math.max(0, lot.currentValue - lot.costBasis),
                        isLongTerm: currentYear - lot.purchaseYear >= 2,
                    }));
            }
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
        rsuLots,
        brokerageLots,
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
export function grossUpBrokerage(
    netNeeded: number,
    gainRatio: number,
    ltcgRate: number
): { gross: number; tax: number; ltcg: number } {
    if (gainRatio <= 0) {
        // No gains - no tax
        return { gross: netNeeded, tax: 0, ltcg: 0 };
    }

    // Floor the divisor (mirrors the Roth/HSA/ESPP gross-ups) so a pathological
    // ~100% effective rate can't divide by zero / explode. No-op for real rates.
    const effectiveRate = gainRatio * ltcgRate;
    const gross = netNeeded / grossUpDivisor(effectiveRate);
    const ltcg = gross * gainRatio;
    const tax = ltcg * ltcgRate;

    return { gross, tax, ltcg };
}

/**
 * Normalized lot shape shared by the brokerage / ESPP / RSU lot-sale path (#90).
 * Every equity-comp source maps onto these four fields:
 *  - value:          gross market value sellable from the lot (the cash raised).
 *  - ordinaryIncome: ordinary income realized on sale (ESPP bargain element).
 *                    Brokerage and RSU sales realize none (0).
 *  - gain:           capital gain/loss, short- or long-term per `isLongTerm`.
 *                    Brokerage lots are floored at 0; RSU lots may be negative
 *                    (underwater); ESPP carries only its LTCG appreciation here.
 *  - isLongTerm:     long-term iff true, else short-term (taxed at ordinary).
 */
export interface NormalizedLot {
    value: number;
    ordinaryIncome: number;
    gain: number;
    isLongTerm: boolean;
}

export interface LotSaleRates {
    /** Ordinary marginal rate (federal + state) for STCG and bargain-element income. */
    ordinaryRate: number;
    /** Long-term capital-gains rate. */
    ltcgRate: number;
}

export interface LotSaleResult {
    gross: number;
    stcg: number;
    ltcg: number;
    ordinaryIncome: number;
    /** Total tax on the sale (STCG + LTCG + bargain-element ordinary), floored so
     *  losses never refund cash into the sale net. */
    tax: number;
    /** Ordinary tax on the STCG bucket (floored when floorLossTax), already
     *  included in `tax`; surfaced so callers can populate the withdrawal's
     *  ordinaryTax field without recomputing. */
    stcgTax: number;
}

/**
 * Unified lot-sale routine for brokerage / ESPP / RSU withdrawals (#90).
 *
 * Walks FIFO / preference-ordered `lots` up to `targetGross` (the blended-rate
 * gross estimate, already clamped to the account's sellable balance), splitting
 * the realized gain short- vs long-term and accumulating any bargain-element
 * ordinary income. Reproduces the three former per-case routines exactly:
 *  - gross is reported as `targetGross` (brokerage sized gross from balance and
 *    reported it directly; RSU/ESPP clamp `targetGross` to the lot-value sum
 *    before the call, so for them `targetGross` already equals the walked sum).
 *  - bargain-element ordinary income (ESPP) is taxed at `ordinaryRate`; brokerage
 *    and RSU carry none.
 *  - `floorLossTax` controls underwater handling and is the ONE behavioral knob
 *    that differs across the three sources:
 *      • true  (RSU): STCG tax is floored at 0 and a net long-term LOSS contributes
 *        no negative tax — so an underwater lot can't refund cash into the sale
 *        net. (§1211(b) is applied once on the year's aggregate by the caller.)
 *      • false (brokerage / ESPP): STCG/LTCG tax is linear and signed. Brokerage
 *        gains are floored ≥ 0 at snapshot time so the sign never matters there;
 *        ESPP LTCG can be negative (a disqualifying-disposition loss) and was
 *        always allowed to reduce the sale's tax — preserved here.
 *
 * Returns raw (unfloored) realized gains/losses; only the *tax* obeys the floor.
 */
function sellLotsWithGainSplit(
    lots: NormalizedLot[],
    targetGross: number,
    rates: LotSaleRates,
    floorLossTax: boolean = false,
): LotSaleResult {
    let remaining = targetGross;
    let stcg = 0;
    let ltcg = 0;
    let ordinaryIncome = 0;
    for (const lot of lots) {
        if (remaining <= 0) break;
        const valueToUse = Math.min(lot.value, remaining);
        const ratio = lot.value > 0 ? valueToUse / lot.value : 0;
        const gain = lot.gain * ratio;
        if (lot.isLongTerm) ltcg += gain;
        else stcg += gain;
        ordinaryIncome += lot.ordinaryIncome * ratio;
        remaining -= valueToUse;
    }

    // Tax: STCG + bargain-element income at the ordinary rate, LTCG at the LTCG
    // rate. With floorLossTax (RSU), the STCG tax floors at 0 and a net LT loss
    // contributes no tax so a loss never refunds cash into the sale net; otherwise
    // (brokerage/ESPP) the cap-gains tax is signed and a loss reduces tax linearly.
    const rawStcgTax = stcg * rates.ordinaryRate;
    const stcgTax = floorLossTax ? Math.max(0, rawStcgTax) : rawStcgTax;
    const ltcgTax = floorLossTax ? (ltcg > 0 ? ltcg * rates.ltcgRate : 0) : ltcg * rates.ltcgRate;
    const ordinaryTax = ordinaryIncome * rates.ordinaryRate;
    const tax = stcgTax + ltcgTax + ordinaryTax;

    return { gross: targetGross, stcg, ltcg, ordinaryIncome, tax, stcgTax };
}

/**
 * Blended effective tax-per-gross-dollar across a normalized lot pool, used to
 * size the gross-up: gross ≈ net / (1 - effectiveRate). Mirrors the per-case
 * sizing the three equity-comp blocks used before #90 unified them — each lot's
 * gain is taxed at its own ST/LT rate, plus any bargain-element ordinary income.
 */
function blendedLotRate(lots: NormalizedLot[], rates: LotSaleRates): number {
    let poolValue = 0;
    let poolTax = 0;
    for (const lot of lots) {
        poolValue += lot.value;
        poolTax += lot.gain * (lot.isLongTerm ? rates.ltcgRate : rates.ordinaryRate);
        poolTax += lot.ordinaryIncome * rates.ordinaryRate;
    }
    return poolValue > 0 ? poolTax / poolValue : 0;
}

/**
 * Largest gross brokerage sale (FIFO) whose realized gain stays within
 * `gainBudget`. Sizes the ACA-cliff cap consistently with the FIFO realization —
 * sizing from the aggregate gain ratio understates how much gain the oldest
 * (higher-ratio) lots realize, which would breach the cliff the cap protects (#75).
 */
function grossForGainBudget(
    gainBudget: number,
    lots: NonNullable<AccountBalanceSnapshot['brokerageLots']>,
): number {
    let gross = 0;
    let gainSoFar = 0;
    for (const lot of lots) {
        const lotGainRatio = lot.totalValue > 0 ? lot.gain / lot.totalValue : 0;
        if (lotGainRatio <= 0) {
            gross += lot.totalValue; // no gain → free to sell, no MAGI impact
            continue;
        }
        const remaining = gainBudget - gainSoFar;
        if (remaining <= 0) break;
        if (lot.gain <= remaining) {
            gross += lot.totalValue;
            gainSoFar += lot.gain;
        } else {
            gross += remaining / lotGainRatio;
            break;
        }
    }
    return gross;
}

/**
 * Compute piecewise tax on a known gross Traditional withdrawal.
 * Walks federal and state brackets stacked on current taxable income positions.
 */
function computeTaxOnGross(
    grossAmount: number,
    fedTaxableIncome: number,
    stateTaxableIncome: number,
    fedBrackets: TaxBracket[],
    stateBrackets: TaxBracket[] | null,
    remainingFedStdDedSpace: number,
    remainingStateStdDedSpace: number
): { fedTax: number; stateTax: number; totalTax: number } {
    // Federal: tax applies to amount above std deduction space
    const fedTaxableWithdrawal = Math.max(0, grossAmount - remainingFedStdDedSpace);
    let fedTax = 0;
    if (fedTaxableWithdrawal > 0 && fedBrackets.length > 0) {
        let remaining = fedTaxableWithdrawal;
        let incomePos = fedTaxableIncome;
        for (let i = 0; i < fedBrackets.length && remaining > 0; i++) {
            const bracket = fedBrackets[i];
            const nextThreshold = fedBrackets[i + 1]?.threshold ?? Infinity;
            if (incomePos >= nextThreshold) continue;
            const floor = Math.max(incomePos, bracket.threshold);
            const room = nextThreshold - floor;
            const inBracket = Math.min(remaining, room);
            fedTax += inBracket * bracket.rate;
            incomePos += inBracket;
            remaining -= inBracket;
        }
    }

    // State: same approach
    let stateTax = 0;
    if (stateBrackets && stateBrackets.length > 0) {
        const stateTaxableWithdrawal = Math.max(0, grossAmount - remainingStateStdDedSpace);
        if (stateTaxableWithdrawal > 0) {
            let remaining = stateTaxableWithdrawal;
            let incomePos = stateTaxableIncome;
            for (let i = 0; i < stateBrackets.length && remaining > 0; i++) {
                const bracket = stateBrackets[i];
                const nextThreshold = stateBrackets[i + 1]?.threshold ?? Infinity;
                if (incomePos >= nextThreshold) continue;
                const floor = Math.max(incomePos, bracket.threshold);
                const room = nextThreshold - floor;
                const inBracket = Math.min(remaining, room);
                stateTax += inBracket * bracket.rate;
                incomePos += inBracket;
                remaining -= inBracket;
            }
        }
    }

    return { fedTax, stateTax, totalTax: fedTax + stateTax };
}


/**
 * Calculate gross withdrawal needed for a given net from Traditional accounts.
 * Uses binary search over computeTaxOnGross to correctly handle separate
 * federal and state standard deduction spaces and bracket positions.
 */
function grossUpTraditional(
    netNeeded: number,
    age: number,
    fedTaxableIncome: number,
    stateTaxableIncome: number,
    fedBrackets: TaxBracket[],
    stateBrackets: TaxBracket[] | null,
    remainingFedStdDedSpace: number,
    remainingStateStdDedSpace: number
): { gross: number; tax: number; penalty: number } {
    if (netNeeded <= 0) {
        return { gross: 0, tax: 0, penalty: 0 };
    }

    const penaltyRate = age < EARLY_WITHDRAWAL_AGE ? EARLY_WITHDRAWAL_PENALTY_RATE : 0;

    // Helper: net delivered by a given gross withdrawal (tax + penalty subtracted).
    const netAtGross = (gross: number): number => {
        const t = computeTaxOnGross(
            gross, fedTaxableIncome, stateTaxableIncome,
            fedBrackets, stateBrackets,
            remainingFedStdDedSpace, remainingStateStdDedSpace
        );
        return gross - t.totalTax - gross * penaltyRate;
    };

    // Binary search: find gross such that gross - tax(gross) - penalty(gross) = netNeeded
    let lo = netNeeded;
    let hi = netNeeded * 3;

    // When the combined fed+state+penalty rate exceeds ~66.7%, even gross = 3×netNeeded
    // nets less than netNeeded, so [lo, hi] never brackets the target and the search
    // silently under-funds the deficit. Grow hi (capped) until net(hi) >= netNeeded.
    const maxHi = netNeeded * 20;
    while (hi < maxHi && netAtGross(hi) < netNeeded) {
        hi = Math.min(hi * 2, maxHi);
    }

    let bestGross = netNeeded;
    let bestTax = 0;

    for (let iter = 0; iter < 60; iter++) {
        const mid = (lo + hi) / 2;
        const taxResult = computeTaxOnGross(
            mid, fedTaxableIncome, stateTaxableIncome,
            fedBrackets, stateBrackets,
            remainingFedStdDedSpace, remainingStateStdDedSpace
        );
        const penalty = mid * penaltyRate;
        const net = mid - taxResult.totalTax - penalty;

        bestGross = mid;
        bestTax = taxResult.totalTax;

        if (Math.abs(net - netNeeded) < 0.0001) break;

        if (net < netNeeded) {
            lo = mid;
        } else {
            hi = mid;
        }
    }

    return { gross: bestGross, tax: bestTax, penalty: bestGross * penaltyRate };
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
    marginalRate: number,
    maxGross: number = Infinity
): { gross: number; tax: number; penalty: number; fromContributions: number; fromConversions: number; fromEarnings: number } {
    let remaining = netNeeded;
    let fromContributions = 0;
    let fromConversions = 0;
    let fromEarnings = 0;
    let tax = 0;
    let penalty = 0;
    let grossUsed = 0;

    // 1. Contributions first - tax-free, penalty-free
    if (contributionBasis > 0 && remaining > 0 && grossUsed < maxGross) {
        const fromContrib = Math.min(remaining, contributionBasis, maxGross - grossUsed);
        fromContributions = fromContrib;
        grossUsed += fromContrib;
        remaining -= fromContrib;
    }

    // 2. Conversions second - FIFO by year, 5-year rule for penalty.
    // Caller passes a pre-sorted (oldest first) array; we mutate entry amounts
    // in place so a shared pool can be drained across multiple withdrawals
    // within the same year.
    if (remaining > 0 && grossUsed < maxGross && conversionHistory.length > 0) {
        for (const conv of conversionHistory) {
            if (remaining <= 0 || grossUsed >= maxGross) break;
            if (conv.amount <= 0) continue;

            const yearsHeld = currentYear - conv.year;
            const penaltyApplies = age < EARLY_WITHDRAWAL_AGE && yearsHeld < 5;

            const fromThisConv = Math.min(remaining, conv.amount, maxGross - grossUsed);
            fromConversions += fromThisConv;
            grossUsed += fromThisConv;
            conv.amount -= fromThisConv;

            if (penaltyApplies) {
                const penaltyOnConv = fromThisConv * EARLY_WITHDRAWAL_PENALTY_RATE;
                penalty += penaltyOnConv;
            }

            remaining -= fromThisConv;
        }
    }

    // 3. Earnings last - tax + penalty if under 59.5
    if (remaining > 0 && grossUsed < maxGross) {
        const grossRoom = maxGross - grossUsed;
        if (age < EARLY_WITHDRAWAL_AGE) {
            // Earnings are taxed as ordinary income + 10% penalty
            const penaltyRate = EARLY_WITHDRAWAL_PENALTY_RATE;
            const effectiveRate = marginalRate + penaltyRate;

            // Gross up the remaining need, capped by available room.
            // BUG #14 FIX: guard the divisor so a >= 1 effective rate (marginal +
            // 10% penalty) can't produce Infinity/NaN.
            const grossEarnings = Math.min(remaining / grossUpDivisor(effectiveRate), grossRoom);
            fromEarnings = grossEarnings;
            tax = grossEarnings * marginalRate;
            penalty += grossEarnings * penaltyRate;
        } else {
            // After 59.5, earnings are tax-free too (qualified distribution)
            fromEarnings = Math.min(remaining, grossRoom);
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
    acaWithdrawalOptions?: { acaCliffThreshold: number; currentMAGI: number },
    /** Income included in currentOrdinaryIncome for federal brackets but exempt from state tax
     *  (e.g., taxable Social Security for DC and most states that exempt SS). */
    stateExemptIncome: number = 0
): WithdrawalPlanResult {
    const withdrawals: PlannedWithdrawal[] = [];
    const decisions: DecisionLogEntry[] = [];

    let remainingNetNeeded = netNeeded;
    let totalGross = 0;
    let totalNet = 0;
    let totalTax = 0;
    let totalPenalties = 0;
    let totalLTCG = 0;
    // STCG was historically always 0: brokerage/ESPP gains have no per-lot
    // holding-period split in the planner. RSU lots DO carry explicit vest dates,
    // so an RSU sale can realize genuine short-term gains (taxed at ordinary
    // rates). Accumulate those here; YearSolver reads totalSTCG into realizedSTCG
    // and feeds it through the authoritative federal tax + MAGI.
    let totalSTCG = 0;
    let cumulativeLTCG = 0; // Tracks LTCG from brokerage/ESPP for ACA MAGI headroom
    let cumulativeSTCG = 0; // Tracks brokerage STCG realized this loop (also in MAGI) — #75
    let runningOrdinaryIncome = currentOrdinaryIncome;

    // ACA cliff: track Roth amounts pre-consumed by look-ahead substitution
    const acaRothConsumed = new Map<string, number>();
    const ACA_WITHDRAWAL_BUFFER = 500; // Buffer under cliff for withdrawal LTCG

    // Get tax parameters
    const fedParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'federal', undefined, assumptions);
    const stateParams = TaxService.getTaxParameters(year, taxState.filingStatus, 'state', taxState.stateResidency, assumptions);

    // Get LTCG rate based on current ordinary income. Delegates to the shared
    // getLTCGRate helper (imported as getLTCGRateForIncome), closing over this
    // year's fedParams.
    //
    // NOTE (review #3): passing GROSS runningOrdinaryIncome here is a deliberately
    // conservative proxy for sizing the gross-up — it never under-states the rate.
    // A taxable-income lookup (subtracting the standard deduction) returns the 0%
    // *floor* rate whenever taxable ordinary income is below the 0% LTCG ceiling,
    // which under-withdraws when the gains themselves spill into the 15% bracket.
    // The authoritative per-year tax (calculateTotalFederalTax) stacks correctly.
    const getLTCGRate = (ordinaryIncome: number): number =>
        getLTCGRateForIncome(ordinaryIncome, fedParams);

    // Get marginal ordinary rate
    const getMarginalRate = (ordinaryIncome: number): number => {
        if (!fedParams) return 0.22; // Default to 22%

        const result = TaxService.getMarginalTaxRate(
            Math.max(0, ordinaryIncome - fedParams.standardDeduction),
            fedParams
        );
        return result.rate;
    };

    // Get state marginal rate.
    // BUG #7 FIX: take an income arg and recompute per-iteration (like
    // getMarginalRate) instead of freezing it at the initial
    // currentOrdinaryIncome. As traditional/HSA withdrawals raise running
    // income across state brackets, the state portion of the marginal rate
    // used for subsequent Roth-earnings / HSA / ESPP gross-ups must update too.
    const getStateRate = (ordinaryIncome: number): number => {
        if (!stateParams) return 0;
        const result = TaxService.getMarginalTaxRate(
            Math.max(0, ordinaryIncome - stateParams.standardDeduction),
            stateParams
        );
        return result.rate;
    };

    // IRS Pub 590-B: all Roth IRAs are treated as a single Roth IRA for ordering
    // rules. Pool contribution basis and conversion history (FIFO across accounts)
    // across every roth_ira snapshot. The pool is decremented in place as
    // withdrawals are processed. Roth 401k accounts (pre-retirement only after
    // the at-retirement rollover) keep per-account treatment.
    const rothIRASnapshots = accountOrder.filter(s => s.accountType === 'roth_ira');
    let remainingPoolBasis = rothIRASnapshots.reduce(
        (sum, s) => sum + Math.max(0, s.rothContributions ?? 0),
        0,
    );
    const pooledRothConversions: { year: number; amount: number }[] = rothIRASnapshots
        .flatMap(s => s.conversionHistory ?? [])
        .filter(c => c.amount > 0)
        .map(c => ({ year: c.year, amount: c.amount }))
        .sort((a, b) => a.year - b.year);

    // Process each account in order
    for (const snapshot of accountOrder) {
        if (remainingNetNeeded <= 0) break;

        // Reduce available balance for Roth accounts already tapped by ACA substitution look-ahead
        const acaAlreadyConsumed = acaRothConsumed.get(snapshot.accountId) ?? 0;
        const effectiveVestedBalance = snapshot.vestedBalance - acaAlreadyConsumed;
        if (effectiveVestedBalance <= 0) continue;

        // LTCG stacks on top of ordinary income AND on top of gains already
        // realized earlier in this pass, so position the rate lookup above
        // cumulativeLTCG — otherwise each successive gain-bearing account re-uses
        // the 0% floor as if no gains had been realized yet.
        const ltcgRate = getLTCGRate(runningOrdinaryIncome + cumulativeLTCG);
        const marginalRate = getMarginalRate(runningOrdinaryIncome) + getStateRate(runningOrdinaryIncome);

        let withdrawal: PlannedWithdrawal;

        switch (snapshot.accountType) {
            case 'savings': {
                const result = grossUpSavings(remainingNetNeeded);
                const grossToWithdraw = Math.min(result.gross, effectiveVestedBalance);
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
                const brokerageLots = snapshot.brokerageLots;
                const actualGainRatio = snapshot.gainRatio;
                const lotRates: LotSaleRates = { ordinaryRate: marginalRate, ltcgRate };

                // Normalize the brokerage lots onto the shared lot shape (#90): no
                // ordinary income on a brokerage sale, per-lot gains floored at 0,
                // ST/LT per the model's year-granularity hold convention. STCG (lots
                // held < 2yr) is taxed at the running marginal rate, LTCG at the LTCG
                // rate (#75). FIFO matches the model's lot removal.
                const hasLots = !!(brokerageLots && brokerageLots.length > 0);
                const normalizedLots: NormalizedLot[] = hasLots
                    ? brokerageLots!.map(lot => ({
                        value: lot.totalValue,
                        ordinaryIncome: 0,
                        gain: lot.gain,
                        isLongTerm: lot.isLongTerm,
                    }))
                    : [];

                // Without lot data, fall back to the prior all-LTCG proportional
                // model. A single synthetic full-LTCG lot sized to `gross` runs the
                // same FIFO helper, so the no-lots realize math is no longer expressed
                // twice (#91 item #10): gain = gross × gainRatio, all long-term.
                const realizeBrokerage = (gross: number): LotSaleResult => {
                    const lots: NormalizedLot[] = hasLots
                        ? normalizedLots
                        : [{ value: gross, ordinaryIncome: 0, gain: gross * actualGainRatio, isLongTerm: true }];
                    return sellLotsWithGainSplit(lots, gross, lotRates);
                };

                // Size the gross from a blended effective rate across the lot pool
                // (mirrors RSU), or the single-rate algebraic gross-up without lots.
                let grossToWithdraw: number = hasLots
                    ? Math.min(remainingNetNeeded / grossUpDivisor(blendedLotRate(normalizedLots, lotRates)), effectiveVestedBalance)
                    : Math.min(grossUpBrokerage(remainingNetNeeded, actualGainRatio, ltcgRate).gross, effectiveVestedBalance);

                let { stcg: actualSTCG, ltcg: actualLTCG, tax: actualTax } = realizeBrokerage(grossToWithdraw);
                let netReceived = grossToWithdraw - actualTax;

                // =================================================================
                // ACA CLIFF CHECK: Cap brokerage withdrawal if LTCG would breach cliff
                // Substitute tax-free Roth withdrawals for the remainder
                // =================================================================
                if (acaWithdrawalOptions && grossToWithdraw > 0) {
                    // Both STCG and LTCG land in MAGI, so the cliff check counts both (#75).
                    const projectedMAGI = acaWithdrawalOptions.currentMAGI + cumulativeLTCG + cumulativeSTCG + actualLTCG + actualSTCG;

                    if (projectedMAGI > acaWithdrawalOptions.acaCliffThreshold) {
                        // Calculate how much realized-gains headroom we have
                        const magiHeadroom = Math.max(0,
                            acaWithdrawalOptions.acaCliffThreshold - ACA_WITHDRAWAL_BUFFER
                            - acaWithdrawalOptions.currentMAGI - cumulativeLTCG - cumulativeSTCG
                        );

                        // Convert realized-gains headroom to max safe gross withdrawal.
                        // With lots, size it FIFO-consistently (the oldest lots realize
                        // more gain per gross than the account average, so the aggregate
                        // gainRatio would understate it and breach the cliff — #75 review).
                        let maxSafeGross: number;
                        if (brokerageLots && brokerageLots.length > 0) {
                            maxSafeGross = grossForGainBudget(magiHeadroom, brokerageLots);
                        } else if (actualGainRatio > 0) {
                            maxSafeGross = magiHeadroom / actualGainRatio;
                        } else {
                            maxSafeGross = grossToWithdraw; // No gains, no MAGI impact
                        }

                        const originalGross = grossToWithdraw;
                        const originalNet = netReceived;
                        grossToWithdraw = Math.max(0, Math.min(grossToWithdraw, maxSafeGross));

                        // Recalculate the short/long split with the capped amount.
                        ({ stcg: actualSTCG, ltcg: actualLTCG, tax: actualTax } = realizeBrokerage(grossToWithdraw));
                        netReceived = grossToWithdraw - actualTax;

                        // Calculate deficit still needing coverage from Roth
                        const netShortfall = originalNet - netReceived;

                        if (netShortfall > 0) {
                            // Look-ahead: find Roth accounts in the withdrawal order
                            let rothSubstitutionNet = 0;

                            for (const rothSnapshot of accountOrder) {
                                if (rothSubstitutionNet >= netShortfall) break;
                                if (rothSnapshot.accountType !== 'roth_ira' && rothSnapshot.accountType !== 'roth_401k') continue;

                                const alreadyConsumed = acaRothConsumed.get(rothSnapshot.accountId) ?? 0;
                                const availableRoth = rothSnapshot.vestedBalance - alreadyConsumed;
                                if (availableRoth <= 0) continue;

                                const stillNeeded = netShortfall - rothSubstitutionNet;

                                // BUG #9 FIX: consume from the SAME conversion/basis source the
                                // main loop drains, so a conversion spent here is not available
                                // again to the main pass (which would double-count the dollars and
                                // mis-assign the 5-year penalty).
                                //
                                // For roth_ira (pooled per IRS Pub 590-B) we pass the shared
                                // `pooledRothConversions` array (grossUpRoth mutates conv.amount in
                                // place, so the drain is visible to the main loop) and decrement the
                                // shared `remainingPoolBasis` by whatever contribution basis is used.
                                // For roth_401k (per-account) the snapshot's conversionHistory is a
                                // LIVE reference to the account model's array, and snapshots are reused
                                // across YearSolver's deficit iterations (and the model persists across
                                // simulation years). grossUpRoth decrements conv.amount in place, so we
                                // must pass a deep COPY here (mirroring pooledRothConversions) to avoid
                                // corrupting the account's conversion basis / 5-year-penalty accounting
                                // on later iterations and years. Combined with the main loop's
                                // acaRothConsumed/effectiveVestedBalance guard on balance, this prevents
                                // double-spend without mutating the model.
                                const isPooledRoth = rothSnapshot.accountType === 'roth_ira';
                                const acaContribAvailable = isPooledRoth
                                    ? Math.max(0, Math.min(remainingPoolBasis, rothSnapshot.vestedBalance) - alreadyConsumed)
                                    : Math.max(0, (rothSnapshot.rothContributions ?? 0) - alreadyConsumed);
                                const acaConversionsForCall = isPooledRoth
                                    ? pooledRothConversions
                                    : (rothSnapshot.conversionHistory ?? [])
                                        .map(c => ({ year: c.year, amount: c.amount }))
                                        .sort((a, b) => a.year - b.year);

                                const rothResult = grossUpRoth(
                                    Math.min(stillNeeded, availableRoth),
                                    acaContribAvailable,
                                    acaConversionsForCall,
                                    year,
                                    currentAge,
                                    marginalRate,
                                    availableRoth
                                );

                                if (isPooledRoth) {
                                    remainingPoolBasis = Math.max(0, remainingPoolBasis - rothResult.fromContributions);
                                }

                                const rothGross = rothResult.gross;
                                const rothTax = rothResult.tax;
                                const rothPenalty = rothResult.penalty;
                                const rothNet = rothGross - rothTax - rothPenalty;

                                if (rothNet <= 0) continue;

                                // Track consumption
                                acaRothConsumed.set(rothSnapshot.accountId, alreadyConsumed + rothGross);
                                rothSubstitutionNet += rothNet;

                                // Record the Roth substitution withdrawal
                                const rothWithdrawal: PlannedWithdrawal = {
                                    source: rothSnapshot.accountType,
                                    accountId: rothSnapshot.accountId,
                                    accountName: rothSnapshot.accountName,
                                    gross: rothGross,
                                    net: rothNet,
                                    penalty: rothPenalty,
                                    tax: rothTax,
                                    reason: 'ACA cliff Roth substitution',
                                };

                                withdrawals.push(rothWithdrawal);
                                totalNet += rothNet;
                                totalGross += rothGross;
                                totalTax += rothTax;
                                totalPenalties += rothPenalty;

                                // Roth earnings add to ordinary income if under 59.5
                                if (rothResult.fromEarnings > 0 && currentAge < 59.5) {
                                    runningOrdinaryIncome += rothResult.fromEarnings;
                                }

                                decisions.push({
                                    category: 'withdrawal',
                                    account: rothSnapshot.accountName,
                                    amount: rothGross,
                                    description: `ACA cliff Roth substitution: $${rothGross.toLocaleString()} from ${rothSnapshot.accountName} (tax-free) replaces brokerage to avoid MAGI breach.`,
                                });
                            }

                            // Reduce remainingNetNeeded by what Roth covered
                            remainingNetNeeded -= rothSubstitutionNet;

                            decisions.push({
                                category: 'withdrawal',
                                account: snapshot.accountName,
                                amount: grossToWithdraw,
                                description: `ACA cliff: Brokerage capped at $${grossToWithdraw.toLocaleString()} (was $${originalGross.toLocaleString()}). LTCG $${actualLTCG.toLocaleString()} keeps MAGI under cliff $${acaWithdrawalOptions.acaCliffThreshold.toLocaleString()}. Roth substituted $${rothSubstitutionNet.toLocaleString()}.`,
                            });

                            if (rothSubstitutionNet < netShortfall) {
                                // Not enough Roth to cover the gap — accept cliff breach for remainder
                                decisions.push({
                                    category: 'warning',
                                    amount: netShortfall - rothSubstitutionNet,
                                    description: `Insufficient Roth balance for full ACA substitution. Remaining $${(netShortfall - rothSubstitutionNet).toLocaleString()} unfunded by substitution.`,
                                });
                            }
                        }
                    }
                }

                // Brokerage per-lot gains are floored at 0, so actualSTCG >= 0 always
                // (no Math.max guard needed, unlike RSU's underwater-lot path).
                const brokerageStcgTax = actualSTCG * marginalRate;
                withdrawal = {
                    source: 'brokerage',
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    capitalGains: { shortTerm: actualSTCG, longTerm: actualLTCG },
                    // STCG is taxed at ordinary rates — route its tax through ordinaryTax
                    // so ordinaryTaxOf()/ltcgTaxOf() split it correctly (#75).
                    ordinaryTax: brokerageStcgTax,
                    penalty: 0,
                    tax: actualTax,
                    reason,
                };

                // STCG is ordinary income — advance running ordinary income so a later
                // same-year ordinary withdrawal bracket-stacks on top of it (mirrors RSU).
                if (actualSTCG > 0) runningOrdinaryIncome += actualSTCG;

                cumulativeLTCG += actualLTCG;
                cumulativeSTCG += actualSTCG;
                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                totalTax += actualTax;
                totalLTCG += actualLTCG;
                totalSTCG += actualSTCG;
                break;
            }

            case 'traditional_401k':
            case 'traditional_ira': {
                // Compute taxable income positions and remaining std ded space
                // Federal: uses full runningOrdinaryIncome (includes taxable SS)
                const fedTaxable = Math.max(0, runningOrdinaryIncome - (fedParams?.standardDeduction ?? 0));
                // State: excludes stateExemptIncome (e.g., taxable SS for DC)
                const stateIncomeForBrackets = runningOrdinaryIncome - stateExemptIncome;
                const stateTaxable = stateParams ? Math.max(0, stateIncomeForBrackets - stateParams.standardDeduction) : 0;
                const fedStdDedSpace = Math.max(0, (fedParams?.standardDeduction ?? 0) - runningOrdinaryIncome);
                const stateStdDedSpace = stateParams
                    ? Math.max(0, stateParams.standardDeduction - stateIncomeForBrackets)
                    : Infinity;

                const result = grossUpTraditional(
                    remainingNetNeeded, currentAge,
                    fedTaxable, stateTaxable,
                    fedParams?.brackets ?? [], stateParams?.brackets ?? null,
                    fedStdDedSpace, stateStdDedSpace
                );
                const grossToWithdraw = Math.min(result.gross, effectiveVestedBalance);

                // Compute tax: if capped by balance, recompute piecewise; otherwise use gross-up result
                const penaltyRate = currentAge < EARLY_WITHDRAWAL_AGE ? EARLY_WITHDRAWAL_PENALTY_RATE : 0;
                let actualTax: number;
                let actualPenalty: number;
                let netReceived: number;

                if (grossToWithdraw < result.gross) {
                    // Capped by account balance — recompute tax piecewise for actual gross
                    const taxResult = computeTaxOnGross(
                        grossToWithdraw, fedTaxable, stateTaxable,
                        fedParams?.brackets ?? [], stateParams?.brackets ?? null,
                        fedStdDedSpace, stateStdDedSpace
                    );
                    actualTax = taxResult.totalTax;
                    actualPenalty = grossToWithdraw * penaltyRate;
                    netReceived = grossToWithdraw - actualTax - actualPenalty;
                } else {
                    actualTax = result.tax;
                    actualPenalty = result.penalty;
                    netReceived = grossToWithdraw - actualTax - actualPenalty;
                }

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
                // Roth IRA: pool contribution basis and conversion history across all
                // Roth IRAs (IRS Pub 590-B). Roth 401k: keep per-account treatment.
                const isPooled = snapshot.accountType === 'roth_ira';
                const contribAvailable = isPooled
                    ? Math.max(0, Math.min(remainingPoolBasis, snapshot.vestedBalance) - acaAlreadyConsumed)
                    : Math.max(0, (snapshot.rothContributions ?? 0) - acaAlreadyConsumed);
                const conversionsForCall = isPooled
                    ? pooledRothConversions
                    : (snapshot.conversionHistory ? snapshot.conversionHistory.map(c => ({ year: c.year, amount: c.amount })).sort((a, b) => a.year - b.year) : []);

                const result = grossUpRoth(
                    remainingNetNeeded,
                    contribAvailable,
                    conversionsForCall,
                    year,
                    currentAge,
                    marginalRate,
                    effectiveVestedBalance
                );

                if (isPooled) {
                    remainingPoolBasis = Math.max(0, remainingPoolBasis - result.fromContributions);
                }
                const grossToWithdraw = result.gross;
                const netReceived = grossToWithdraw - result.tax - result.penalty;

                withdrawal = {
                    source: snapshot.accountType,
                    accountId: snapshot.accountId,
                    accountName: snapshot.accountName,
                    gross: grossToWithdraw,
                    net: netReceived,
                    penalty: result.penalty,
                    tax: result.tax,
                    reason,
                };

                // Roth earnings (if any) add to ordinary income
                if (result.fromEarnings > 0 && currentAge < EARLY_WITHDRAWAL_AGE) {
                    runningOrdinaryIncome += result.fromEarnings;
                }

                remainingNetNeeded -= netReceived;
                totalNet += netReceived;
                totalGross += grossToWithdraw;
                totalTax += result.tax;
                totalPenalties += result.penalty;

                if (result.penalty > 0) {
                    decisions.push({
                        category: 'withdrawal',
                        account: snapshot.accountName,
                        amount: result.penalty,
                        description: `Early withdrawal penalty of $${result.penalty.toFixed(0)} on Roth withdrawal (5-year rule).`,
                    });
                }
                break;
            }

            case 'hsa': {
                // HSA withdrawals for non-healthcare are taxed as ordinary + 20% penalty before 65
                const penaltyRate = currentAge < 65 ? 0.20 : 0;
                const effectiveRate = marginalRate + penaltyRate;
                // BUG #14 FIX: guard the divisor so a >= 1 effective rate
                // (marginal + 20% HSA penalty) can't produce Infinity/NaN.
                const gross = remainingNetNeeded / grossUpDivisor(effectiveRate);
                const grossToWithdraw = Math.min(gross, effectiveVestedBalance);

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
                    // Normalize ESPP lots onto the shared lot shape (#90). The bargain
                    // element is ordinary income (marginal + state); only the
                    // post-bargain appreciation is LTCG (always long-term here). Sizing
                    // the gross against just gainRatio*ltcgRate (the old fallback)
                    // ignored the ordinary tax on the bargain element AND wrongly
                    // applied the lower LTCG rate to the ordinary-taxed portion, so the
                    // sale under-delivered net cash; the blended rate fixes that.
                    const lotRates: LotSaleRates = { ordinaryRate: marginalRate, ltcgRate };
                    const normalizedLots: NormalizedLot[] = esppLots.map(lot => ({
                        value: lot.totalValue,
                        ordinaryIncome: lot.shares * lot.ordinaryIncomePerShare,
                        gain: lot.shares * lot.ltcgPerShare,
                        isLongTerm: true,
                    }));

                    // Estimate gross from the blended effective rate, clamped to the
                    // sellable balance AND to the lot-value sum (the walk can never
                    // raise more than the lots hold).
                    const lotValueSum = normalizedLots.reduce((s, l) => s + l.value, 0);
                    const targetGross = Math.min(
                        remainingNetNeeded / grossUpDivisor(blendedLotRate(normalizedLots, lotRates)),
                        effectiveVestedBalance,
                        lotValueSum,
                    );

                    if (targetGross <= 0) {
                        continue; // Skip to next account if no value to withdraw
                    }

                    const sale = sellLotsWithGainSplit(normalizedLots, targetGross, lotRates);
                    const grossToWithdraw = sale.gross;
                    const esppOrdinaryIncome = sale.ordinaryIncome;
                    const esppLTCG = sale.ltcg;
                    const ordinaryTax = esppOrdinaryIncome * marginalRate;
                    const actualTax = sale.tax;
                    const netReceived = grossToWithdraw - actualTax;

                    withdrawal = {
                        source: 'espp',
                        accountId: snapshot.accountId,
                        accountName: snapshot.accountName,
                        gross: grossToWithdraw,
                        net: netReceived,
                        capitalGains: { shortTerm: 0, longTerm: esppLTCG },
                        ordinaryIncome: esppOrdinaryIncome,
                        ordinaryTax,
                        penalty: 0,
                        tax: actualTax,
                        reason,
                    };

                    // ESPP ordinary income affects tax bracket
                    runningOrdinaryIncome += esppOrdinaryIncome;

                    cumulativeLTCG += esppLTCG;
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
                    const grossToWithdraw = Math.min(result.gross, effectiveVestedBalance);

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

                    cumulativeLTCG += actualLTCG;
                    remainingNetNeeded -= netReceived;
                    totalNet += netReceived;
                    totalGross += grossToWithdraw;
                    totalTax += actualTax;
                    totalLTCG += actualLTCG;
                }
                break;
            }

            case 'rsu': {
                const rsuLots = snapshot.rsuLots;

                // Use pre-computed lot data if available. RSU shares were already
                // taxed as ordinary income at vest, so a sale only realizes capital
                // gains/losses: short-term at the ordinary marginal rate, long-term
                // at the LTCG rate. Underwater lots carry negative gains (losses).
                if (rsuLots && rsuLots.length > 0) {
                    const rsuOrdinaryRate = marginalRate;
                    const lotRates: LotSaleRates = { ordinaryRate: rsuOrdinaryRate, ltcgRate };

                    // Normalize RSU lots onto the shared lot shape (#90): no ordinary
                    // income on sale (taxed at vest), per-lot gains may be negative
                    // (underwater), ST taxed at the ordinary rate / LT at the LTCG rate.
                    const normalizedLots: NormalizedLot[] = rsuLots.map(lot => ({
                        value: lot.totalValue,
                        ordinaryIncome: 0,
                        gain: lot.shares * lot.gainPerShare,
                        isLongTerm: lot.isLongTerm,
                    }));

                    // Blended effective tax-per-gross-dollar sizing (mirrors ESPP),
                    // clamped to the sellable balance AND to the lot-value sum.
                    const lotValueSum = normalizedLots.reduce((s, l) => s + l.value, 0);
                    const targetGross = Math.min(
                        remainingNetNeeded / grossUpDivisor(blendedLotRate(normalizedLots, lotRates)),
                        effectiveVestedBalance,
                        lotValueSum,
                    );

                    if (targetGross <= 0) {
                        continue; // Skip to next account if no value to withdraw
                    }

                    // Underwater lots carry negative gains (losses). Two invariants
                    // hold for a sale (enforced by floorLossTax=true in the helper):
                    //  1. A sale's net proceeds can NEVER exceed its gross — a loss
                    //     refund arrives at tax time, not as extra sale cash, so the
                    //     per-sale tax is floored at 0 for withdrawal sizing.
                    //  2. A net capital LOSS only ever offsets up to $3,000 of other
                    //     income (applied ONCE on the year's aggregate below).
                    const sale = sellLotsWithGainSplit(normalizedLots, targetGross, lotRates, true);
                    const grossToWithdraw = sale.gross;
                    const rsuSTCG = sale.stcg;
                    const rsuLTCG = sale.ltcg;
                    // STCG tax charged against the sale (floored at 0), surfaced by
                    // the helper so the withdrawal's ordinaryTax field needn't
                    // recompute it.
                    const stcgTax = sale.stcgTax;
                    const actualTax = sale.tax;
                    const netReceived = grossToWithdraw - actualTax;
                    // The raw realized gains/losses (rsuSTCG/rsuLTCG) flow straight
                    // through. The §1211(b) $3,000 net-loss limit is applied ONCE on
                    // the year's aggregate (totalSTCG + totalLTCG) just before this
                    // planner returns — capping here per-sale or per-bucket let an
                    // underwater pool, or N underwater accounts, pipe a loss many
                    // times the limit into the (unfloored) SS-taxability and
                    // state-tax bases.

                    withdrawal = {
                        source: 'rsu',
                        accountId: snapshot.accountId,
                        accountName: snapshot.accountName,
                        gross: grossToWithdraw,
                        net: netReceived,
                        capitalGains: { shortTerm: rsuSTCG, longTerm: rsuLTCG },
                        // STCG is taxed at ordinary rates, so route its tax through
                        // ordinaryTax — ordinaryTaxOf()/ltcgTaxOf() then split it
                        // correctly (ordinary bucket vs LTCG bucket).
                        ordinaryTax: stcgTax,
                        penalty: 0,
                        tax: actualTax,
                        reason,
                    };

                    // RSU short-term gains are ordinary income — advance the
                    // running ordinary income so a later same-year ordinary
                    // withdrawal bracket-stacks on top of it (parallel to ESPP).
                    // Only positive STCG raises the bracket; a realized loss
                    // doesn't lower ordinary brackets here.
                    if (rsuSTCG > 0) {
                        runningOrdinaryIncome += rsuSTCG;
                    }

                    cumulativeLTCG += Math.max(0, rsuLTCG);
                    // RSU STCG is in MAGI too, so a later brokerage ACA-cliff check
                    // must count it (#75 review #4).
                    cumulativeSTCG += Math.max(0, rsuSTCG);
                    remainingNetNeeded -= netReceived;
                    totalNet += netReceived;
                    totalGross += grossToWithdraw;
                    totalTax += actualTax;
                    totalLTCG += rsuLTCG;
                    totalSTCG += rsuSTCG;

                    if (rsuSTCG !== 0 || rsuLTCG !== 0) {
                        decisions.push({
                            category: 'tax',
                            account: snapshot.accountName,
                            amount: rsuSTCG + rsuLTCG,
                            description: `RSU sale: $${Math.round(rsuSTCG).toLocaleString()} short-term, $${Math.round(rsuLTCG).toLocaleString()} long-term capital gains.`,
                        });
                    }
                } else {
                    // Fallback: treat like brokerage if no RSU lot data (long-term).
                    const result = grossUpBrokerage(remainingNetNeeded, snapshot.gainRatio, ltcgRate);
                    const grossToWithdraw = Math.min(result.gross, effectiveVestedBalance);

                    const actualLTCG = grossToWithdraw * snapshot.gainRatio;
                    const actualTax = actualLTCG * ltcgRate;
                    const netReceived = grossToWithdraw - actualTax;

                    withdrawal = {
                        source: 'rsu',
                        accountId: snapshot.accountId,
                        accountName: snapshot.accountName,
                        gross: grossToWithdraw,
                        net: netReceived,
                        capitalGains: { shortTerm: 0, longTerm: actualLTCG },
                        penalty: 0,
                        tax: actualTax,
                        reason,
                    };

                    cumulativeLTCG += actualLTCG;
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

        // Log the withdrawal
        decisions.push({
            category: 'withdrawal',
            account: snapshot.accountName,
            amount: withdrawal.gross,
            description: `Withdrew $${withdrawal.gross.toLocaleString()} from ${snapshot.accountName} (net: $${withdrawal.net.toLocaleString()}).`,
        });
    }

    // Log if there's remaining deficit
    if (remainingNetNeeded > 0) {
        decisions.push({
            category: 'warning',
            amount: remainingNetNeeded,
            description: `Unfunded deficit of $${remainingNetNeeded.toLocaleString()}. All accounts exhausted.`,
        });
    }

    // §1211(b): a NET realized capital loss offsets at most $3,000 of other income
    // per year. Cap the aggregate (across every sale and account) ONCE here, scaling
    // the ST/LT buckets proportionally. YearSolver feeds totalLTCG raw into the
    // SS-taxability and state-tax bases (no Math.max(0,…) floor there), so an
    // uncapped loss would drop taxable SS / zero out state tax on real income —
    // phantom federal+state refunds, not just MAGI drift. (Brokerage/ESPP only ever
    // contribute non-negative gains, so the net loss is RSU's; gains and losses
    // across sources net here, which is the correct §1211 treatment.)
    //
    // Residual (intentional, conservative): YearSolver's stcgForFederal clamps a
    // negative scaled STCG bucket to 0 in the retirement bases, so the ST share of
    // a capped loss doesn't reduce the federal/SS/MAGI base — the loss is very
    // slightly UNDER-applied. That's the safe direction (opposite of the
    // phantom-refund bug) and only in this already-rare both-underwater case.
    const netRealizedCapital = totalSTCG + totalLTCG;
    if (netRealizedCapital < -ANNUAL_CAPITAL_LOSS_LIMIT) {
        const lossScale = -ANNUAL_CAPITAL_LOSS_LIMIT / netRealizedCapital; // in (0,1)
        totalSTCG *= lossScale;
        totalLTCG *= lossScale;
    }

    return {
        withdrawals,
        totalGross,
        totalNet,
        totalTax,
        totalPenalties,
        totalLTCG,
        totalSTCG,
        remainingDeficit: remainingNetNeeded < 0.01 ? 0 : remainingNetNeeded,
        decisions,
    };
}
