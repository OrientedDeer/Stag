import {
    AnyIncome,
    WorkIncome,
    PassiveIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
} from "../../components/Objects/Income/models";
import {
    AnyExpense,
    MortgageExpense,
    CLASS_TO_CATEGORY,
    isLongTermGoal,
    getGoalFundAnnualSetAside,
} from "../../components/Objects/Expense/models";
import { AnyAccount, InvestedAccount } from "../../components/Objects/Accounts/models";
import {
    CashflowDetail,
    CashflowIncomeKind,
    CashflowIncomeSource,
} from "./types";

const MIN_AMOUNT = 0.005;

interface BuildCashflowDetailInput {
    /** Active incomes after earnings test, including RMD-sourced PassiveIncomes (shown as income). */
    incomes: AnyIncome[];
    /** Expenses after lifestyle creep + GK trim. */
    expenses: AnyExpense[];
    /** All accounts (used to resolve match account taxType and reinvested-income destinations). */
    accounts: AnyAccount[];
    /** Total payroll insurance deduction for the year. */
    insurance: number;
    year: number;
    /**
     * Sum of `w.tax` over the year's brokerage/ESPP withdrawals — the planner's
     * LTCG estimate that was baked into the gross-up. Routed straight to the
     * government, never lands as user cash. Stored on CashflowDetail so the
     * Sankey can subtract it from the gross withdrawal inflow.
     */
    brokerageLTCGFromGross: number;
    /**
     * The ACTUAL employer match the sim deposited, keyed by destination account id
     * (withdrawalState.employerInflows) — already §415(c)-trimmed by
     * AccountGrowth.processInflows, so it is authoritative. When present, the
     * Roth/pretax match split is derived from this map instead of recomputing via
     * getEffectiveAnnualEmployerMatch (which ignores the §415(c) trim and overstates
     * the match, breaking inflow=outflow for high earners at the combined 401k limit).
     */
    employerInflows?: Record<string, number>;
    /**
     * The ACTUAL employee 401k deferral the sim deposited, keyed by destination
     * account id (InflowResult.userContributions) — already §415(c)-trimmed by
     * AccountGrowth.processInflows. When present, userPreTax401k / userRoth401k are
     * derived from this map (each account's deposit allocated across the incomes
     * feeding it and split by each income's own raw inc.preTax401k:roth401k ratio)
     * instead of summing the raw `inc.preTax401k/roth401k`, which ignores the trim and
     * overstates the Sankey's deferral when two jobs share one 401k beyond §415(c).
     */
    userContributions?: Record<string, number>;
    /**
     * The §415(c)-TRIMMED employee deferral split pre-tax vs Roth PER INCOME
     * (InflowResult.userContributionsByIncome, keyed by income id). When present,
     * the pre-tax/Roth deferral is summed straight from these per-income amounts —
     * exact even when several jobs feed one over-limit 401k and the trim lands on a
     * specific job rather than a raw-ratio share. Falls back to the per-account
     * userContributions redistribution (then to raw fields) when omitted.
     */
    userContributionsByIncome?: Record<string, { preTax: number; roth: number }>;
}

/**
 * Build the per-year cashflow detail consumed by the Sankey chart.
 *
 * The sim already does all this math while running — this just packages
 * the per-source breakdown into a stable shape so the chart doesn't have
 * to re-derive it (and drift from the sim's actual values).
 */
export function buildCashflowDetail(input: BuildCashflowDetailInput): CashflowDetail {
    const { incomes, expenses, accounts, insurance, year, brokerageLTCGFromGross, employerInflows, userContributions, userContributionsByIncome } = input;

    const incomeBySource: CashflowIncomeSource[] = [];
    let userPreTax401k = 0;
    let userRoth401k = 0;
    let employerMatchPreTax = 0;
    let employerMatchRoth = 0;

    for (const inc of incomes) {
        const amount = inc.getProratedAnnual ? inc.getProratedAnnual(inc.amount, year) : 0;

        if (inc instanceof WorkIncome) {
            // Track work-income contributions even when amount==0 is impossible here
            // (inactive work incomes are filtered upstream by milestones / earnings test).
            if (amount >= MIN_AMOUNT) {
                incomeBySource.push({ name: inc.name, amount, kind: 'work' });
            }
            // When the sim's actual deposited deferral is available (per-income
            // userContributionsByIncome, or the per-account userContributions),
            // derive the deferral from it below instead of summing raw per-income
            // fields, which ignore the §415(c) trim. Otherwise fall back to raw.
            if (!userContributions && !userContributionsByIncome) {
                userPreTax401k += inc.getProratedAnnual(inc.preTax401k, year);
                userRoth401k += inc.getProratedAnnual(inc.roth401k, year);
            }

            if (inc.matchAccountId && !employerInflows) {
                const match = inc.getEffectiveAnnualEmployerMatch(year);
                if (match >= MIN_AMOUNT) {
                    const matchAccount = accounts.find(a => a.id === inc.matchAccountId);
                    const isRoth = matchAccount instanceof InvestedAccount &&
                        (matchAccount.taxType === 'Roth 401k' || matchAccount.taxType === 'Roth IRA');
                    if (isRoth) {
                        employerMatchRoth += match;
                    } else {
                        employerMatchPreTax += match;
                    }
                }
            }
            continue;
        }

        if (amount < MIN_AMOUNT) continue;

        if (inc instanceof PassiveIncome) {
            // RMDs are surfaced as spendable income (they drain the Traditional account
            // via userInflows, but cash-flow-wise they're a required distribution that
            // funds expenses, with any surplus reinvested). They are deliberately NOT in
            // cashflow.withdrawalDetail, so showing them here is the single representation.
            const kind: CashflowIncomeKind = inc.isReinvested ? 'reinvested' : 'passive';
            const source: CashflowIncomeSource = { name: inc.name, amount, kind };

            if (inc.isReinvested) {
                // Interest incomes have ids of the form `interest-{accountId}-{year}`.
                // Resolve the account so the chart can label the destination correctly.
                const idParts = inc.id.startsWith('interest-') ? inc.id.split('-') : null;
                const accountId = idParts && idParts.length >= 3
                    ? idParts.slice(1, -1).join('-')
                    : null;
                const account = accountId ? accounts.find(a => a.id === accountId) : null;
                source.accountName = account?.name ?? inc.name.replace(' Interest', '');
            }

            incomeBySource.push(source);
        } else if (
            inc instanceof SocialSecurityIncome ||
            inc instanceof CurrentSocialSecurityIncome ||
            inc instanceof FutureSocialSecurityIncome
        ) {
            incomeBySource.push({ name: inc.name, amount, kind: 'ss' });
        } else if (inc instanceof FERSPensionIncome) {
            // Include the MRA-to-62 supplement so the Sankey matches spendable income.
            incomeBySource.push({ name: inc.name, amount: inc.getTotalAnnualAmount(year), kind: 'pension' });
        } else if (inc instanceof CSRSPensionIncome) {
            incomeBySource.push({ name: inc.name, amount, kind: 'pension' });
        } else {
            incomeBySource.push({ name: inc.name, amount, kind: 'passive' });
        }
    }

    // When the sim's actual deposited match is available, derive the Roth/pretax
    // split from it (per destination account, already §415(c)-trimmed) so the Sankey
    // matches what AccountGrowth deposited rather than an untrimmed recompute.
    if (employerInflows) {
        for (const [accountId, match] of Object.entries(employerInflows)) {
            if (match < MIN_AMOUNT) continue;
            const matchAccount = accounts.find(a => a.id === accountId);
            const isRoth = matchAccount instanceof InvestedAccount &&
                (matchAccount.taxType === 'Roth 401k' || matchAccount.taxType === 'Roth IRA');
            if (isRoth) {
                employerMatchRoth += match;
            } else {
                employerMatchPreTax += match;
            }
        }
    }

    // Employee-deferral attribution, most-exact first:
    //
    // 1. PER-INCOME (userContributionsByIncome): the §415(c)-trimmed deferral already
    //    split pre-tax/Roth per income by the engine — sum it straight. Exact even
    //    when several jobs feed one over-limit 401k and the trim lands on a SPECIFIC
    //    job (the last processed) rather than on a raw-ratio share of the account.
    if (userContributionsByIncome) {
        for (const inc of incomes) {
            if (!(inc instanceof WorkIncome)) continue;
            const split = userContributionsByIncome[inc.id];
            if (!split) continue;
            userPreTax401k += split.preTax;
            userRoth401k += split.roth;
        }
    } else if (userContributions) {
    // 2. PER-ACCOUNT (userContributions): only the trimmed TOTAL per destination
    // account is known, so split it pre-tax/Roth so the Sankey's Net-Pay deferral
    // matches the deposit even when two jobs share one 401k over the limit.
    //
    // The deposited TOTAL is keyed by DESTINATION account, but a single income can
    // defer BOTH pre-tax and Roth into one account (AccountGrowth sums inc.preTax401k
    // + inc.roth401k into one matchAccountId deposit). Splitting purely by the
    // account's taxType would dump such an income's whole deposit onto one flow and
    // make the Roth (or pre-tax) portion disappear. So we allocate each account's
    // trimmed total across the incomes feeding it (proportional to each income's raw
    // deferral, preserving the trimmed total) and split each income's share by its OWN
    // raw inc.preTax401k : inc.roth401k. An income that defers only one kind is
    // unchanged; a deposit with no matching income falls back to the account taxType.
        // Pre-bucket the WorkIncome feeders by destination account ONCE (and the
        // accounts by id) so the per-deposit loop is a Map lookup instead of an
        // incomes.filter() + accounts.find() per deposit.
        const feedersByAccount = new Map<string, WorkIncome[]>();
        for (const inc of incomes) {
            if (!(inc instanceof WorkIncome) || !inc.matchAccountId) continue;
            const bucket = feedersByAccount.get(inc.matchAccountId);
            if (bucket) bucket.push(inc);
            else feedersByAccount.set(inc.matchAccountId, [inc]);
        }
        const accountById = new Map(accounts.map(a => [a.id, a]));

        for (const [accountId, deferral] of Object.entries(userContributions)) {
            if (deferral < MIN_AMOUNT) continue;
            const account = accountById.get(accountId);
            const accountIsRoth = account instanceof InvestedAccount &&
                (account.taxType === 'Roth 401k' || account.taxType === 'Roth IRA');

            // Incomes deferring into this account, with their RAW (untrimmed) annual
            // pre-tax/Roth split. The deposited total is shared in proportion to each
            // income's raw deferral; within a share, kinds split by that raw ratio.
            const feeders = (feedersByAccount.get(accountId) ?? [])
                .map(inc => {
                    const pre = inc.getProratedAnnual(inc.preTax401k, year);
                    const roth = inc.getProratedAnnual(inc.roth401k, year);
                    return { pre, roth, raw: pre + roth };
                })
                .filter(f => f.raw >= MIN_AMOUNT);

            const totalRaw = feeders.reduce((sum, f) => sum + f.raw, 0);
            if (feeders.length === 0 || totalRaw < MIN_AMOUNT) {
                // No income explains this deposit (dangling/edge) — fall back to the
                // account's taxType so the deposited total is still represented.
                if (accountIsRoth) userRoth401k += deferral;
                else userPreTax401k += deferral;
                continue;
            }

            // Distribute the trimmed deposit across feeders by raw weight; give the
            // last feeder the remainder so the per-flow amounts sum to `deferral` exactly.
            let allocated = 0;
            feeders.forEach((f, i) => {
                const isLast = i === feeders.length - 1;
                const share = isLast ? deferral - allocated : deferral * (f.raw / totalRaw);
                allocated += share;
                // Split this feeder's share by its own raw pre-tax : Roth ratio.
                const rothPortion = share * (f.roth / f.raw);
                userRoth401k += rothPortion;
                userPreTax401k += share - rothPortion;
            });
        }
    }

    let mortgagePrincipal = 0;
    let mortgageInterestEscrow = 0;
    for (const exp of expenses) {
        if (exp instanceof MortgageExpense) {
            const amort = exp.calculateAnnualAmortization(year);
            mortgagePrincipal += amort.totalPrincipal;
            mortgageInterestEscrow += amort.totalPayment - amort.totalPrincipal;
        }
    }

    const expensesByCategory: Record<string, number> = {};
    // getGoalFundAnnualSetAside SUMS the set-aside across EVERY goal sharing a
    // fund (each goal's monthly set-aside × that goal's own months-active), so the
    // FUND total must be counted once — never once per goal. SimulationEngine does
    // exactly this (its per-fund goalFundCredits map, keyed by accountId), so living
    // expenses count the set-aside once. We still want EACH goal the user created to
    // keep its own labeled node ("Car (goal)", "Boat (goal)") in the chart, so the
    // fund's total is split across the sharing goals by giving each goal its OWN
    // exact annual set-aside — getGoalFundAnnualSetAside on a single-goal array. The
    // fund total IS the sum of those per-goal set-asides, so the per-goal nodes sum
    // to the fund total with no weighting drift, and a goal not funding this year
    // (months-active = 0) correctly contributes $0 instead of siphoning a slice.
    const emittedGoalFunds = new Set<string>();
    for (const exp of expenses) {
        if (exp instanceof MortgageExpense) continue;
        // Long-term goals report $0 from getAnnualAmount, but their committed
        // set-aside IS in the sim's living expenses (SimulationEngine counts it
        // and credits the fund). Without a matching category here the Sankey's
        // Expenses node is unbalanced by exactly the set-aside.
        if (isLongTermGoal(exp) && exp.goalAccountId) {
            if (emittedGoalFunds.has(exp.goalAccountId)) continue; // fund already split once
            emittedGoalFunds.add(exp.goalAccountId);

            const fundTotal = getGoalFundAnnualSetAside(expenses, exp.goalAccountId, year) ?? 0;
            if (fundTotal < MIN_AMOUNT) continue;

            // Goals sharing this fund (in expense order), filtered ONCE and reused.
            // getGoalFundAnnualSetAside already ran this same predicate internally;
            // filtering once here keeps the per-goal split provably consistent with
            // the fund total it returned (and avoids a second full pass).
            const sharingGoals = expenses.filter(
                e => isLongTermGoal(e) && e.goalAccountId === exp.goalAccountId,
            );

            sharingGoals.forEach(goal => {
                // Each goal's EXACT own annual set-aside: monthly × that goal's
                // months-active this year, via getGoalFundAnnualSetAside on a
                // single-goal array (which applies the months-active factor). These
                // sum to fundTotal by construction — no weighting approximation.
                const share = getGoalFundAnnualSetAside([goal], exp.goalAccountId, year) ?? 0;
                if (share < MIN_AMOUNT) return; // an inactive goal (0 months) is dropped
                // Each goal keeps its own labeled node ("Car (goal)") — clearer in
                // the chart than a generic "Goals" bucket, and the "(goal)" suffix
                // avoids colliding with a regular expense of the same name.
                const category = `${goal.name} (goal)`;
                expensesByCategory[category] = (expensesByCategory[category] || 0) + share;
            });
            continue;
        }

        const amount = exp.getAnnualAmount(year);
        if (amount < MIN_AMOUNT) continue;
        const category = CLASS_TO_CATEGORY[exp.constructor.name] || 'Other';
        expensesByCategory[category] = (expensesByCategory[category] || 0) + amount;
    }

    return {
        incomeBySource,
        userPreTax401k,
        userRoth401k,
        employerMatchPreTax,
        employerMatchRoth,
        insurance,
        mortgagePrincipal,
        mortgageInterestEscrow,
        expensesByCategory,
        brokerageLTCGFromGross,
    };
}
