import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, PropertyAccount, DebtAccount, DeficitDebtAccount, ESPPLot } from "../../components/Objects/Accounts/models";
import { AnyExpense, MortgageExpense, LoanExpense } from "../../components/Objects/Expense/models";
import { AnyIncome, WorkIncome, getIncomeActiveMultiplier } from "../../components/Objects/Income/models";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
import { getESPPLimit, get415cLimit } from "../../data/ContributionLimits";
import { WithdrawalState } from "./types";

export interface InflowResult {
    totalEmployerMatch: number;
    totalBucketAllocations: number;
    bucketDetail: Record<string, number>;
    esppLots: Record<string, ESPPLot[]>;
    discretionaryCash: number;
    deficitDebtPayment: number;
    logs: string[];
}

/**
 * Process payroll contributions, employer match, ESPP purchases,
 * deficit debt payments, and priority bucket allocations.
 */
export function processInflows(
    incomesWithEarningsTest: AnyIncome[],
    accounts: AnyAccount[],
    assumptions: AssumptionsState,
    year: number,
    withdrawalState: WithdrawalState,
    discretionaryCash: number,
    _existingDeficitDebt: DeficitDebtAccount | undefined,
    _totalLivingExpenses: number,
    currentAge: number,
    logs: string[]
): InflowResult {
    const bucketDetail: Record<string, number> = {};
    let totalEmployerMatch = 0;
    let totalBucketAllocations = 0;
    const esppLots: Record<string, ESPPLot[]> = {};
    let deficitDebtPayment = 0;

    // 5a. Payroll & Match
    incomesWithEarningsTest.forEach(inc => {
        if (inc instanceof WorkIncome && inc.matchAccountId) {
            const activeMultiplier = getIncomeActiveMultiplier(inc, year);
            if (activeMultiplier === 0) return;

            const currentSelf = withdrawalState.userInflows[inc.matchAccountId] || 0;
            const currentMatch = withdrawalState.employerInflows[inc.matchAccountId] || 0;

            // preTax401k/roth401k are per pay period; getProratedAnnual converts to the
            // annual deposit (and already folds in the active-period multiplier).
            const selfContribution = inc.getProratedAnnual(inc.preTax401k + inc.roth401k, year);
            let employerMatch = inc.getEffectiveAnnualEmployerMatch() * activeMultiplier;

            // Bug #11: enforce the §415(c) combined annual-additions limit
            // (employee pre-tax + Roth + employer) for this 401k account. The
            // §402(g) elective-deferral limit is handled at the income-model
            // level (get401kLimit / getEffective401k); this is the separate,
            // higher combined cap. Excess is removed from the employer match
            // first, since the employee's own deferrals are already capped and
            // are the participant's money. We clamp using the additions already
            // routed to this account this year (currentSelf/currentMatch) plus
            // this income's new contributions, so multiple incomes feeding one
            // account share a single limit.
            const limit415c = get415cLimit(year, currentAge, assumptions.macro.inflationAdjusted);
            const totalAdditions = currentSelf + currentMatch + selfContribution + employerMatch;
            if (totalAdditions > limit415c) {
                const excess = totalAdditions - limit415c;
                const trimmedMatch = Math.max(0, employerMatch - excess);
                if (trimmedMatch < employerMatch) {
                    logs.push(`[WARN] §415(c) limit: ${inc.name} employer match reduced by $${(employerMatch - trimmedMatch).toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within combined $${limit415c.toLocaleString()} 401k limit`);
                }
                employerMatch = trimmedMatch;
            }

            totalEmployerMatch += employerMatch;

            withdrawalState.userInflows[inc.matchAccountId] = currentSelf + selfContribution;
            withdrawalState.employerInflows[inc.matchAccountId] = currentMatch + employerMatch;
        }
    });

    // 5a-2. ESPP Purchase Processing
    let totalESPPFMVThisYear = 0;
    const esppLimit = getESPPLimit();

    incomesWithEarningsTest.forEach(inc => {
        if (!(inc instanceof WorkIncome)) return;
        if (inc.esppContributionType === 'NONE') return;
        if (!inc.esppAccountId) return;

        const activeMultiplier = getIncomeActiveMultiplier(inc, year);
        if (activeMultiplier === 0) return;

        const annualContribution = inc.getAnnualESPPContribution() * activeMultiplier;
        if (annualContribution <= 0) return;

        const esppAccount = accounts.find(acc => acc.id === inc.esppAccountId && acc instanceof ESPPAccount) as ESPPAccount | undefined;
        if (!esppAccount) {
            logs.push(`[WARN] ESPP account ${inc.esppAccountId} not found for ${inc.name}`);
            return;
        }

        const purchaseContribution = annualContribution / 2;
        const stockGrowthRate = inc.esppExpectedStockGrowth / 100;

        for (let purchaseNum = 0; purchaseNum < 2; purchaseNum++) {
            const grantMonth = purchaseNum * 6;
            const purchaseMonth = grantMonth + 5;
            const grantDate = new Date(Date.UTC(year, grantMonth, 1));
            const purchaseDate = new Date(Date.UTC(year, purchaseMonth, 28));

            const fmvAtGrant = 100;
            const growthOverPeriod = Math.pow(1 + stockGrowthRate, 0.5);
            const fmvAtPurchase = fmvAtGrant * growthOverPeriod;

            let basePriceForDiscount: number;
            if (inc.esppHasLookback) {
                basePriceForDiscount = Math.min(fmvAtGrant, fmvAtPurchase);
            } else {
                basePriceForDiscount = fmvAtPurchase;
            }

            const discountPercent = inc.esppDiscountPercent / 100;
            const purchasePrice = basePriceForDiscount * (1 - discountPercent);
            const discountAmount = basePriceForDiscount - purchasePrice;

            const shares = purchaseContribution / purchasePrice;
            const fmvOfShares = shares * fmvAtPurchase;

            if (totalESPPFMVThisYear + fmvOfShares > esppLimit) {
                const remainingFMV = Math.max(0, esppLimit - totalESPPFMVThisYear);
                if (remainingFMV <= 0) {
                    logs.push(`[WARN] ESPP: ${inc.name} hit $25k annual limit - purchase skipped`);
                    continue;
                }
                const reducedShares = remainingFMV / fmvAtPurchase;
                const reducedContribution = reducedShares * purchasePrice;
                logs.push(`[WARN] ESPP: ${inc.name} purchase reduced to stay within $25k limit`);

                const lot: ESPPLot = {
                    id: `LOT-${year}-${purchaseNum}-${inc.id}`,
                    grantDate,
                    purchaseDate,
                    fmvAtGrant,
                    fmvAtPurchase,
                    purchasePrice,
                    shares: reducedShares,
                    totalCost: reducedContribution,
                    discountAmount
                };

                // NOTE: do NOT write the purchase FMV into userInflows[esppId].
                // The ESPP balance is updated via addLot (esppLots) in growAccounts,
                // not via userInflows. userInflows[esppId] is reserved for the NET
                // SALE signal that SimulationEngine records as a negative entry — a
                // positive purchase write here would net against a same-year sale and
                // mask it (PR #56 #3). Cash deployed into ESPP is tracked separately
                // via the WorkIncome contribution, not this field.
                totalESPPFMVThisYear += remainingFMV;

                if (!esppLots[esppAccount.id]) esppLots[esppAccount.id] = [];
                esppLots[esppAccount.id].push(lot);
            } else {
                const lot: ESPPLot = {
                    id: `LOT-${year}-${purchaseNum}-${inc.id}`,
                    grantDate,
                    purchaseDate,
                    fmvAtGrant,
                    fmvAtPurchase,
                    purchasePrice,
                    shares,
                    totalCost: purchaseContribution,
                    discountAmount
                };

                // See note above: the purchase reaches the balance via addLot, so
                // we must NOT add it to userInflows (it would mask a same-year sale).
                totalESPPFMVThisYear += fmvOfShares;

                if (!esppLots[esppAccount.id]) esppLots[esppAccount.id] = [];
                esppLots[esppAccount.id].push(lot);

                logs.push(`[FLOW] ESPP: ${inc.name} purchased ${shares.toFixed(2)} shares @ $${purchasePrice.toFixed(2)} (${(discountPercent * 100).toFixed(0)}% discount${inc.esppHasLookback ? ' + lookback' : ''})`);
            }
        }
    });

    // Note: Deficit debt paydown and priority waterfall are handled by
    // SurplusAllocator.allocateSurplus() in the V2 YearSolver path.

    return {
        totalEmployerMatch,
        totalBucketAllocations,
        bucketDetail,
        esppLots,
        discretionaryCash,
        deficitDebtPayment,
        logs
    };
}

/**
 * Grow all accounts: apply inflows, compound growth, handle ESPP lots, and linked data.
 */
export function growAccounts(
    accounts: AnyAccount[],
    expenses: AnyExpense[],
    withdrawalState: WithdrawalState,
    conversionDeposits: Record<string, number>,
    esppLots: Record<string, ESPPLot[]>,
    deficitDebtPayment: number,
    existingDeficitDebt: DeficitDebtAccount | undefined,
    assumptions: AssumptionsState,
    year: number,
    returnOverride: number | undefined,
    _logs: string[]
): AnyAccount[] {
    const DEFICIT_DEBT_ID = 'system-deficit-debt';
    const DEFICIT_DEBT_NAME = 'Uncovered Deficit';

    // 6. LINKED DATA (Mortgages/Loans)
    const linkedData = new Map<string, { balance: number; value?: number }>();
    expenses.forEach(exp => {
        if (exp instanceof MortgageExpense && exp.linkedAccountId) {
            linkedData.set(exp.linkedAccountId, { balance: exp.loan_balance, value: exp.valuation });
        } else if (exp instanceof LoanExpense && exp.linkedAccountId) {
            linkedData.set(exp.linkedAccountId, { balance: exp.amount });
        }
    });

    // 7. GROW ACCOUNTS
    let nextAccounts: AnyAccount[] = accounts.map(acc => {
        const userIn = withdrawalState.userInflows[acc.id] || 0;
        const employerIn = withdrawalState.employerInflows[acc.id] || 0;
        const totalIn = userIn + employerIn;

        const linkedState = linkedData.get(acc.id);

        if (acc instanceof PropertyAccount) {
            let finalLoanBalance = linkedState?.balance;
            if (finalLoanBalance !== undefined && totalIn > 0) {
                finalLoanBalance = Math.max(0, finalLoanBalance - totalIn);
            }
            return acc.increment(assumptions, { newLoanBalance: finalLoanBalance, newValue: linkedState?.value });
        }

        if (acc instanceof DeficitDebtAccount) {
            const newBalance = Math.max(0, acc.amount - deficitDebtPayment);
            return acc.increment(assumptions, newBalance);
        }

        if (acc instanceof DebtAccount) {
            let finalBalance = linkedState?.balance ?? (acc.amount * (1 + acc.apr / 100));
            if (totalIn > 0) finalBalance = Math.max(0, finalBalance - totalIn);
            return acc.increment(assumptions, finalBalance);
        }

        if (acc instanceof InvestedAccount) {
            const convAmount = conversionDeposits[acc.id] || 0;
            return acc.increment(assumptions, userIn, employerIn, returnOverride, convAmount, year);
        }

        if (acc instanceof SavedAccount) {
            return acc.increment(assumptions, totalIn);
        }

        if (acc instanceof ESPPAccount) {
            let workingAccount: ESPPAccount = acc;

            // Apply any withdrawal (sale) recorded for this account: sell shares at the
            // current (start-of-year) FMV per share before growth, using the account's
            // configured lot-selling order. This keeps the ESPP balance conserved.
            const grossWithdrawn = userIn < 0 ? -userIn : 0;
            if (grossWithdrawn > 0) {
                const totalShares = workingAccount.lots.reduce((sum, lot) => sum + lot.shares, 0);
                const fmvPerShare = totalShares > 0 ? workingAccount.amount / totalShares : 0;
                if (fmvPerShare > 0) {
                    const sharesToSell = Math.min(totalShares, grossWithdrawn / fmvPerShare);
                    // removeSoldShares only accepts 'fifo' | 'disqualifying_first' | 'qualifying_first'.
                    // ESPPWithdrawalPreference also includes 'dont_sell_until_qualifying', which has no
                    // direct sell-order equivalent here, so it falls back to 'fifo'.
                    const pref = workingAccount.withdrawalPreference;
                    const lotOrder: 'fifo' | 'disqualifying_first' | 'qualifying_first' =
                        pref === 'disqualifying_first' || pref === 'qualifying_first' || pref === 'fifo'
                            ? pref
                            : 'fifo';
                    workingAccount = workingAccount.removeSoldShares(sharesToSell, fmvPerShare, undefined, lotOrder);
                }
            }

            let grownAccount = workingAccount.increment(assumptions, returnOverride);

            const newLots = esppLots[acc.id] || [];
            if (newLots.length > 0) {
                for (const lot of newLots) {
                    grownAccount = grownAccount.addLot(lot);
                }
            }

            return grownAccount;
        }

        const _exhaustiveCheck: never = acc;
        return _exhaustiveCheck;
    });

    // Handle deficit debt: either update existing, add new, or remove
    if (existingDeficitDebt) {
        const finalDeficitDebtBalance = existingDeficitDebt.amount - deficitDebtPayment;
        const hasDeficitDebtInAccounts = nextAccounts.some(acc => acc.id === DEFICIT_DEBT_ID);

        if (finalDeficitDebtBalance > 0) {
            if (hasDeficitDebtInAccounts) {
                nextAccounts = nextAccounts.map(acc =>
                    acc.id === DEFICIT_DEBT_ID
                        ? new DeficitDebtAccount(DEFICIT_DEBT_ID, DEFICIT_DEBT_NAME, finalDeficitDebtBalance)
                        : acc
                );
            } else {
                nextAccounts = [...nextAccounts, new DeficitDebtAccount(DEFICIT_DEBT_ID, DEFICIT_DEBT_NAME, finalDeficitDebtBalance)];
            }
        } else {
            nextAccounts = nextAccounts.filter(acc => acc.id !== DEFICIT_DEBT_ID);
        }
    }

    return nextAccounts;
}
