import { AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, RSUAccount, PropertyAccount, DebtAccount, DeficitDebtAccount, ESPPLot, RSULot } from "../../components/Objects/Accounts/models";
import { postInterestDebtBalance } from "./SurplusAllocator";
import { AnyExpense, MortgageExpense, LoanExpense } from "../../components/Objects/Expense/models";
import { AnyIncome, WorkIncome, getIncomeActiveMultiplier } from "../../components/Objects/Income/models";
import { AssumptionsState } from "../../components/Objects/Assumptions/AssumptionsContext";
import { getESPPLimit, get415cLimit } from "../../data/ContributionLimits";
import { WithdrawalState } from "./types";
import { midYearSaleDate } from "./dates";

export interface InflowResult {
    totalEmployerMatch: number;
    totalBucketAllocations: number;
    bucketDetail: Record<string, number>;
    esppLots: Record<string, ESPPLot[]>;
    discretionaryCash: number;
    deficitDebtPayment: number;
    /**
     * The §415(c)-TRIMMED employee 401k deferral actually deposited this year,
     * keyed by destination account id. Threaded out (alongside employerInflows)
     * so the Sankey can show the deposited deferral instead of recomputing the
     * raw, untrimmed `inc.preTax401k/roth401k` (which overstates the deposit and
     * breaks Net-Pay inflow=outflow when two jobs share one 401k over §415(c)).
     */
    userContributions: Record<string, number>;
    /**
     * The §415(c)-TRIMMED employee deferral the engine actually deposited, split
     * pre-tax vs Roth PER INCOME (keyed by income id). The per-account total in
     * userContributions can't say WHICH job ate the trim when two jobs feed one
     * 401k over the limit — the trim falls on the income processed last, not on a
     * raw-ratio share. The Sankey attributes its pre-tax/Roth deferral from this so
     * the split matches the engine even in that corner. Each income's pre+roth sums
     * to its real deposit; summed over incomes it equals userContributions.
     */
    userContributionsByIncome: Record<string, { preTax: number; roth: number }>;
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
    const totalBucketAllocations = 0;
    const esppLots: Record<string, ESPPLot[]> = {};
    const deficitDebtPayment = 0;

    // Per-account POSITIVE employee deferral routed to each 401k THIS YEAR (the
    // §415(c)-trimmed `currentSelf + trimmedSelf` running total — employee money
    // only; the employer match lives in withdrawalState.employerInflows and is NOT
    // accumulated here), tracked independently of withdrawalState.userInflows.
    // The §415(c) running total must use these, not the net userInflows balance:
    // when a destination account is also drained this year (RMD / in-service
    // withdrawal / Roth conversion), executeYearPlan/processRMDs have already written
    // a NEGATIVE userInflows entry, which would understate prior additions and let the
    // §415(c) trim under-fire (account over-funded above the combined limit).
    const contributionsToAccount: Record<string, number> = {};

    // Per-INCOME §415(c)-trimmed deferral, split pre-tax vs Roth (keyed by income
    // id). The per-account total can't say which income ate the trim when several
    // jobs feed one 401k over the limit; the Sankey reads this to attribute the
    // pre-tax/Roth deferral the way the engine actually deposited it.
    const contributionsByIncome: Record<string, { preTax: number; roth: number }> = {};

    // 5a. Payroll & Match
    incomesWithEarningsTest.forEach(inc => {
        if (inc instanceof WorkIncome && inc.matchAccountId) {
            const activeMultiplier = getIncomeActiveMultiplier(inc, year);
            if (activeMultiplier === 0) return;

            // Prior POSITIVE additions to this account this year (NOT the net
            // userInflows balance — see contributionsToAccount note above).
            const currentSelf = contributionsToAccount[inc.matchAccountId] || 0;
            const currentMatch = withdrawalState.employerInflows[inc.matchAccountId] || 0;

            // preTax401k/roth401k are per pay period; getProratedAnnual converts to the
            // annual deposit (and already folds in the active-period multiplier).
            const annualPreTax = inc.getProratedAnnual(inc.preTax401k, year);
            const annualRoth = inc.getProratedAnnual(inc.roth401k, year);
            const selfContribution = annualPreTax + annualRoth;
            let employerMatch = inc.getEffectiveAnnualEmployerMatch() * activeMultiplier;

            // Bug #11: enforce the §415(c) combined annual-additions limit
            // (employee pre-tax + Roth + employer) for this 401k account. The
            // §402(g) elective-deferral limit is handled at the income-model
            // level (get401kLimit / getEffective401k); this is the separate,
            // higher combined cap. Excess is removed from the employer match
            // first, since the employee's own deferrals are already capped and
            // are the participant's money. We clamp using the POSITIVE additions
            // already routed to this account this year (currentSelf/currentMatch)
            // plus this income's new contributions, so multiple incomes feeding one
            // account share a single limit — and so a same-year drain (negative
            // userInflows) can't mask additions and let the trim under-fire.
            const limit415c = get415cLimit(year, currentAge, assumptions.macro.inflationAdjusted);
            let trimmedSelf = selfContribution;
            const totalAdditions = currentSelf + currentMatch + selfContribution + employerMatch;
            if (totalAdditions > limit415c) {
                const excess = totalAdditions - limit415c;
                // Trim the employer match first — the employee's own deferrals are
                // already §402(g)-capped and are the participant's money.
                const trimmedMatch = Math.max(0, employerMatch - excess);
                if (trimmedMatch < employerMatch) {
                    logs.push(`[WARN] §415(c) limit: ${inc.name} employer match reduced by $${(employerMatch - trimmedMatch).toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within combined $${limit415c.toLocaleString()} 401k limit`);
                }
                const matchReduction = employerMatch - trimmedMatch;
                employerMatch = trimmedMatch;

                // If the match couldn't absorb all of the excess (e.g. multiple
                // incomes feed this account and their combined EMPLOYEE deferrals
                // alone exceed §415(c)), trim this income's employee deferral too —
                // as a last resort — so the account is never over-funded (PR #56 #5).
                const remainingExcess = Math.max(0, excess - matchReduction);
                if (remainingExcess > 0) {
                    trimmedSelf = Math.max(0, selfContribution - remainingExcess);
                    logs.push(`[WARN] §415(c) limit: ${inc.name} employee deferral reduced by $${(selfContribution - trimmedSelf).toLocaleString(undefined, { maximumFractionDigits: 0 })} to stay within combined $${limit415c.toLocaleString()} 401k limit`);
                }
            }

            totalEmployerMatch += employerMatch;

            // Apply to userInflows ADDITIVELY so any pre-existing same-year drain
            // (negative entry from a withdrawal/RMD/conversion) is preserved in the
            // net balance growAccounts will apply.
            withdrawalState.userInflows[inc.matchAccountId] =
                (withdrawalState.userInflows[inc.matchAccountId] || 0) + trimmedSelf;
            withdrawalState.employerInflows[inc.matchAccountId] = currentMatch + employerMatch;

            // Track POSITIVE additions separately for the §415(c) running total.
            contributionsToAccount[inc.matchAccountId] = currentSelf + trimmedSelf;

            // Record this income's TRIMMED deferral, split by its own raw
            // pre-tax : Roth ratio (preserving the trimmed total). An income that
            // defers only one kind is unchanged; this is what the Sankey reads so
            // the pre-tax/Roth split matches the income the engine actually trimmed.
            // (trimmedSelf is a Math.max(0, …) of non-negatives, so it's always ≥ 0.)
            const rothPortion = selfContribution > 0
                ? trimmedSelf * (annualRoth / selfContribution)
                : 0;
            contributionsByIncome[inc.id] = {
                preTax: trimmedSelf - rothPortion,
                roth: rothPortion,
            };
        }
    });

    // 5a-HSA. Payroll HSA contributions → deposit into the HSA account.
    // hsaContribution is a pre-tax, FICA-exempt payroll deduction: YearSolver
    // subtracts it from spendable cash (getPreTaxExemptions), so — exactly like a
    // 401k deferral — it must be DEPOSITED somewhere or net worth silently loses
    // it every working year (#179; six figures over a career for HSA maximizers).
    // Unlike the 401k there is no persisted hsaAccountId link on WorkIncome yet, so
    // route it to the account the user modeled as an HSA (InvestedAccount with
    // taxType 'HSA') when EXACTLY ONE exists. If none or several exist we can't know
    // the destination, so we WARN (visible in the year's Simulation Logs) rather
    // than drop the money silently. Deposited via userInflows (additively) so
    // growAccounts grows it like any other contribution — mirroring the 401k path.
    const hsaAccounts = accounts.filter(
        (acc): acc is InvestedAccount => acc instanceof InvestedAccount && acc.taxType === 'HSA'
    );
    let totalHSAContribution = 0;
    incomesWithEarningsTest.forEach(inc => {
        if (!(inc instanceof WorkIncome)) return;
        if (!(inc.hsaContribution > 0)) return;
        const activeMultiplier = getIncomeActiveMultiplier(inc, year);
        if (activeMultiplier === 0) return;
        // getProratedAnnual converts the per-period field to the annual deposit and
        // already folds in the active-period multiplier (same as the 401k path).
        const annualHSA = inc.getProratedAnnual(inc.hsaContribution, year);
        if (annualHSA > 0) totalHSAContribution += annualHSA;
    });
    if (totalHSAContribution > 0) {
        const fmtHSA = totalHSAContribution.toLocaleString(undefined, { maximumFractionDigits: 0 });
        if (hsaAccounts.length === 1) {
            const hsaId = hsaAccounts[0].id;
            withdrawalState.userInflows[hsaId] =
                (withdrawalState.userInflows[hsaId] || 0) + totalHSAContribution;
        } else if (hsaAccounts.length === 0) {
            logs.push(`[WARN] HSA: $${fmtHSA} of payroll HSA contributions have no HSA account to receive them — the money reduces cash and taxes but isn't deposited anywhere. Add an HSA-type account so it's tracked.`);
        } else {
            logs.push(`[WARN] HSA: $${fmtHSA} of payroll HSA contributions could not be deposited — ${hsaAccounts.length} HSA accounts exist and there's no link specifying which one. Consolidate to a single HSA account.`);
        }
    }

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
            // Build LOCAL date-only values (repo convention; parseDate hydrates
            // user-entered lots the same way). Every reader — calculateDispositionType,
            // getEligibleLots/daysSincePurchase — uses LOCAL accessors and getTime()
            // deltas, so a UTC-midnight stamp would classify holding-period and
            // disposition boundaries inconsistently against user lots in non-UTC zones.
            const grantDate = new Date(year, grantMonth, 1);
            const purchaseDate = new Date(year, purchaseMonth, 28);

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
        userContributions: contributionsToAccount,
        userContributionsByIncome: contributionsByIncome,
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
    rsuLots: Record<string, RSULot[]>,
    deficitDebtPayment: number,
    existingDeficitDebt: DeficitDebtAccount | undefined,
    assumptions: AssumptionsState,
    year: number,
    returnOverride: number | undefined,
    // Reserved logs-threading slot (see CLAUDE.md). growAccounts does no logging
    // of its own today, but the engine and many tests pass `logs` positionally as
    // the final argument, so the parameter must stay. This config's no-unused-vars
    // doesn't honor the `_` prefix, hence the targeted disable.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            if (linkedState) {
                // LINKED debt (#60): the balance is the linked LoanExpense's
                // balance. Any surplus paydown was already applied to the loan in
                // the engine (reduceLoanBalance), so the mirror just follows it —
                // the engine deliberately writes NO userInflow for a linked debt
                // (that would double-count). [7] Defensive invariant: if some
                // future path DID write a linked-debt userInflow, apply it on top
                // of the loan-derived balance rather than silently dropping it.
                // Today totalIn is always 0 for a linked debt, so this is inert.
                const finalBalance = totalIn > 0
                    ? Math.max(0, linkedState.balance - totalIn)
                    : linkedState.balance;
                return acc.increment(assumptions, finalBalance);
            }
            // UNLINKED debt (legacy/imported, no backing loan): self-grows by APR,
            // and a direct inflow pays it down. postInterestDebtBalance
            // single-sources the APR-grossup formula.
            let finalBalance = postInterestDebtBalance(acc);
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
                    // Classify lots at the SAME mid-year sale date the planner used to
                    // tax them (shared midYearSaleDate helper). With a wall-clock
                    // `new Date()` here, qualifying_first/disqualifying_first would sort
                    // lots by a DIFFERENT disposition boundary than the tax was computed
                    // at, so the lots removed would diverge from the lots taxed and
                    // corrupt future-year lot state (#179). Both sides use all lots
                    // (getEligibleLots is skipped consistently on both), so only the
                    // date needed to be aligned.
                    const saleDate = midYearSaleDate(year);
                    workingAccount = workingAccount.removeSoldShares(sharesToSell, fmvPerShare, saleDate, lotOrder);
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

        if (acc instanceof RSUAccount) {
            let workingAccount: RSUAccount = acc;

            // Apply any withdrawal (sale) recorded for this account: sell shares at
            // the current per-share price before growth, using the account's
            // configured lot-selling order. Conserves the RSU balance.
            //
            // Mirror the planner exactly so the lots removed here match the tax it
            // reported: same per-share price (currentSharePrice if set, else the
            // amount/totalShares fallback), same mid-year sale date (so
            // minimumHoldingDays eligibility lines up), same preference order.
            const grossWithdrawn = userIn < 0 ? -userIn : 0;
            if (grossWithdrawn > 0) {
                const totalShares = workingAccount.lots.reduce((sum, lot) => sum + lot.shares, 0);
                const fmvPerShare = workingAccount.currentSharePrice
                    ?? (totalShares > 0 ? workingAccount.amount / totalShares : 0);
                if (fmvPerShare > 0) {
                    const saleDate = midYearSaleDate(year);
                    const eligibleShares = workingAccount.getEligibleShares(saleDate);
                    const sharesToSell = Math.min(eligibleShares, grossWithdrawn / fmvPerShare);
                    if (sharesToSell > 0) {
                        workingAccount = workingAccount.removeSoldShares(
                            sharesToSell, fmvPerShare, saleDate, workingAccount.withdrawalPreference
                        );
                    }
                }
            }

            let grownAccount = workingAccount.increment(assumptions, returnOverride);

            // Add this year's vesting tranches (net shares, after sell-to-cover).
            const newLots = rsuLots[acc.id] || [];
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
