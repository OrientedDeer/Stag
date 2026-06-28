import {
    AnyIncome,
    WorkIncome,
    PassiveIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    getIncomeActiveMultiplier,
    isSocialSecurity,
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
import { distributeProportional } from "../../utils/distribute";

const MIN_AMOUNT = 0.005;

/** A 401k account whose deferrals land as Roth (Roth 401k or Roth IRA). */
function isRothAccount(acc: AnyAccount | undefined): boolean {
    return acc instanceof InvestedAccount &&
        (acc.taxType === 'Roth 401k' || acc.taxType === 'Roth IRA');
}

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
    /**
     * Sell-to-cover withholding per synthetic RSU vest income, keyed by income id
     * (RSUVestingResult.vestWithholdingByIncomeId). An RSU vest is recognized at
     * GROSS as reinvested income, but only the NET shares (gross − withheld) land
     * in the account — the withheld slice was sold to pay tax. Used to set
     * `reinvestedNet` on the vest's income source so the Sankey routes gross
     * through Gross Pay (giving the withholding a tax source) but only the net out
     * to savings. Omitted when no RSU vested this year.
     */
    rsuVestWithholding?: Record<string, number>;
    /**
     * The source RSU account id per synthetic vest income, keyed by the vest
     * income's id (RSUVestingResult.vestAccountIdByIncomeId). The destination
     * account is resolved by EXACT id from this map rather than reverse-engineering
     * it from the vest id string — account/income ids can both contain hyphens, so
     * prefix-matching the id is genuinely ambiguous (e.g. account `rsu` vs `rsu-2`).
     * Falls back to the raw vest name when the id isn't present (e.g. account
     * deleted). Omitted when no RSU vested this year.
     */
    rsuVestAccountId?: Record<string, string>;
    /**
     * The source savings account id per synthetic reinvested-interest income, keyed
     * by the interest income's id (IncomeProjectionResult.interestAccountIdByIncomeId).
     * The destination account is resolved by EXACT id from this map rather than
     * reverse-engineering it from the `interest-{accountId}-{year}` id string. The
     * account id is KNOWN at mint time (IncomeProjection.ts), so this mirrors the
     * RSU-vest map and avoids parsing the id. Falls back to the positional parse (and
     * then the income name) when the id isn't present — the positional parse is
     * unambiguous today (single trailing year token), so the map is a consistency /
     * maintainability win rather than a current-bug fix. Omitted when no interest was
     * reinvested this year (e.g. the EOY path, or callers with no savings APR).
     */
    interestAccountIdByIncomeId?: Record<string, string>;
}

/**
 * Build the per-year cashflow detail consumed by the Sankey chart.
 *
 * The sim already does all this math while running — this just packages
 * the per-source breakdown into a stable shape so the chart doesn't have
 * to re-derive it (and drift from the sim's actual values).
 */
export function buildCashflowDetail(input: BuildCashflowDetailInput): CashflowDetail {
    const { incomes, expenses, accounts, insurance, year, brokerageLTCGFromGross, employerInflows, userContributions, userContributionsByIncome, rsuVestWithholding, rsuVestAccountId, interestAccountIdByIncomeId } = input;

    // buildCashflowDetail runs once per simulated year, so build the account-by-id
    // lookup ONCE at the top and reuse it for every account resolution below (match
    // account, interest/RSU reinvested destinations, employer-inflow split). This
    // replaces four prior O(accounts) linear `accounts.find(a => a.id === …)` scans
    // (and the duplicate Map that the per-account deferral block used to build), so
    // each lookup is O(1) — behavior-identical.
    const accountById = new Map(accounts.map(a => [a.id, a]));

    const incomeBySource: CashflowIncomeSource[] = [];
    let userPreTax401k = 0;
    let userRoth401k = 0;
    let employerMatchPreTax = 0;
    let employerMatchRoth = 0;

    // Pick the employee-deferral attribution tier ONCE, so the per-income raw
    // fallback below and the deferral block agree on a single source:
    //
    //   tier-1 PER-INCOME (userContributionsByIncome) — the engine's §415(c)-
    //     trimmed deferral already split pre-tax/Roth per income. The map is keyed
    //     by inc.id; reconstituteIncome now mints a deterministic, unique id when
    //     an imported income lacks one, so distinct jobs no longer collide on id=""
    //     here. As a backstop for the genuinely-ambiguous corner (two byte-identical
    //     incomes both missing an id → same content-derived id), this tier is still
    //     skipped when two WorkIncomes that ACTUALLY FEED the per-income map share an
    //     id: a colliding key clobbers one job's split and the per-income loop (read
    //     once per income) would add the survivor's split for both — one deferral
    //     vanishes, the other double-counts, Net-Pay in≠out.
    //   tier-2 PER-ACCOUNT (userContributions) — the trimmed TOTAL per destination
    //     account, re-split across the incomes feeding it. The explicit fallback
    //     when tier-1 has colliding ids, OR when the per-income map was provided but
    //     this income is absent from it (e.g. a 401k routed to a deleted account).
    //   tier-3 RAW — sum the untrimmed inc.preTax401k/roth401k (callers that pass
    //     NEITHER map, e.g. the Dashboard / legacy non-trimmed paths).
    //
    // Tier choice gates on whether each map was PASSED (!== undefined), not on its
    // length: a caller that ran the engine but deposited nothing (every deferral
    // trimmed away, or an active income whose matchAccountId was cleared) passes an
    // EMPTY map — and that income's deferral is genuinely $0, which the per-income /
    // per-account path yields. Only a caller that passes no map at all (undefined)
    // wants the raw deferral; an empty-but-provided map must NOT fall through to raw
    // (that would show a full deferral the engine never deposited).
    const hasPerIncome = userContributionsByIncome !== undefined;
    const hasPerAccount = userContributions !== undefined;
    // Collision set: only WorkIncomes that actually WRITE userContributionsByIncome —
    // i.e. have a matchAccountId AND are active this year (getIncomeActiveMultiplier
    // > 0). processInflows early-returns on an inactive feeder (activeMultiplier 0)
    // and never records its split, so including it here would be a false positive
    // that needlessly downgrades exact per-income attribution to the per-account path.
    const feederIds = incomes
        .filter((inc): inc is WorkIncome =>
            inc instanceof WorkIncome &&
            !!inc.matchAccountId &&
            getIncomeActiveMultiplier(inc, year) > 0)
        .map(inc => inc.id);
    const hasDuplicateFeederId = new Set(feederIds).size !== feederIds.length;
    const usePerIncome = hasPerIncome && !hasDuplicateFeederId;
    const usePerAccount = !usePerIncome && hasPerAccount;
    const useRawDeferral = !usePerIncome && !usePerAccount;

    for (const inc of incomes) {
        const amount = inc.getProratedAnnual ? inc.getProratedAnnual(inc.amount, year) : 0;

        if (inc instanceof WorkIncome) {
            // Track work-income contributions even when amount==0 is impossible here
            // (inactive work incomes are filtered upstream by milestones / earnings test).
            if (amount >= MIN_AMOUNT) {
                incomeBySource.push({ name: inc.name, amount, kind: 'work' });
            }
            // When the sim's actual deposited deferral is available (per-income
            // or per-account, chosen above), derive the deferral from it below
            // instead of summing raw per-income fields, which ignore the §415(c)
            // trim. Otherwise (tier-3) fall back to raw.
            if (useRawDeferral) {
                userPreTax401k += inc.getProratedAnnual(inc.preTax401k, year);
                userRoth401k += inc.getProratedAnnual(inc.roth401k, year);
            }

            if (inc.matchAccountId && !employerInflows) {
                const match = inc.getEffectiveAnnualEmployerMatch(year);
                if (match >= MIN_AMOUNT) {
                    const matchAccount = accountById.get(inc.matchAccountId);
                    if (isRothAccount(matchAccount)) {
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
                // Resolve the destination account so the chart labels it correctly.
                //   Interest: `interest-{accountId}-{year}`
                //   RSU vest: `rsu-vest-{accountId}-{incomeId}-{year}`
                // Account/income ids can themselves contain hyphens. Both the interest
                // and vest source accounts are now carried explicitly via id maps
                // (`interestAccountIdByIncomeId` / `rsuVestAccountId`, keyed by the
                // reinvested income's id) so resolution is an EXACT-id lookup — no
                // ambiguous prefix/positional parsing.
                let destAccount: AnyAccount | undefined;
                if (inc.id.startsWith('interest-')) {
                    // The interest income's source account is KNOWN at mint time
                    // (IncomeProjection.ts) and carried in interestAccountIdByIncomeId
                    // keyed by this income's id, so look it up by exact id. The map
                    // mirrors the RSU-vest map exactly. Fall back to the positional
                    // parse only when the id is absent from the map (the parse is
                    // unambiguous today — a single trailing year token — so it remains a
                    // safe backstop, e.g. for callers that don't pass the map).
                    const interestAccountId = interestAccountIdByIncomeId?.[inc.id];
                    if (interestAccountId) {
                        destAccount = accountById.get(interestAccountId);
                    } else {
                        const idParts = inc.id.split('-');
                        const accountId = idParts.length >= 3 ? idParts.slice(1, -1).join('-') : null;
                        destAccount = accountId ? accountById.get(accountId) : undefined;
                    }
                    // Fall back to the income name minus the " Interest" suffix when the
                    // source account was deleted — that yields the bare account label.
                    source.accountName = destAccount?.name ?? inc.name.replace(' Interest', '');
                } else if (inc.id.startsWith('rsu-vest-')) {
                    // The vest's source account is KNOWN at mint time (RSUVesting.ts) and
                    // carried in rsuVestAccountId keyed by this vest income's id, so look
                    // it up by exact id. Unambiguous even when account/income ids share a
                    // textual prefix (`rsu` vs `rsu-2`).
                    const vestAccountId = rsuVestAccountId?.[inc.id];
                    destAccount = vestAccountId ? accountById.get(vestAccountId) : undefined;
                    // No " Interest" suffix on a vest income; fall back to the raw vest
                    // name (e.g. "Engineer RSU Vest") when the account can't be resolved
                    // (id absent from the map or the account was deleted).
                    source.accountName = destAccount?.name ?? inc.name;
                } else {
                    source.accountName = inc.name.replace(' Interest', '');
                }

                // RSU vests are recognized at gross but only the net shares land in
                // the account (sell-to-cover paid the tax). Carry the net so the
                // Sankey doesn't double-count the withholding (which is already in
                // Taxes) as a reinvested outflow. Prorated by the same active
                // multiplier already applied to `amount`. No withholding entry →
                // ordinary reinvested income, leave reinvestedNet unset (== gross).
                const withheld = rsuVestWithholding?.[inc.id];
                if (withheld !== undefined && amount > 0 && inc.amount > 0) {
                    // `amount` is `inc.amount` (gross) after the year's active
                    // multiplier; prorate the full-year withholding by the same
                    // factor so net tracks a partial-year vest.
                    const proratedWithheld = withheld * (amount / inc.amount);
                    source.reinvestedNet = Math.max(0, amount - proratedWithheld);
                }
            }

            incomeBySource.push(source);
        } else if (isSocialSecurity(inc)) {
            // Canonical className-aware predicate so reconstituted (prototype-stripped)
            // SS income — e.g. a sim year marshalled across the worker boundary — is
            // tagged 'ss' for the Sankey instead of falling through to the passive node.
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
            const matchAccount = accountById.get(accountId);
            if (isRothAccount(matchAccount)) {
                employerMatchRoth += match;
            } else {
                employerMatchPreTax += match;
            }
        }
    }

    // Employee-deferral attribution, most-exact first (tier chosen above):
    //
    // 1. PER-INCOME (userContributionsByIncome): the §415(c)-trimmed deferral already
    //    split pre-tax/Roth per income by the engine. Sum the map's VALUES directly
    //    (one entry per income that actually deferred) rather than looping incomes and
    //    reading map[inc.id]: the value-sum IS the deposited deferral and counts each
    //    entry exactly once, so it can't double-count when two incomes on the consumer
    //    side share an id (a colliding "" key holds a single entry). Exact even when
    //    several jobs feed one over-limit 401k and the trim lands on a SPECIFIC job
    //    (the last processed) rather than on a raw-ratio share. This tier is skipped
    //    (→ tier-2) when two 401k-feeding jobs share an id, because then the engine's
    //    OWN map already lost one job's split (it too is keyed by id) and the surviving
    //    entry is the wrong total — the per-account re-split recovers it.
    if (usePerIncome) {
        for (const split of Object.values(userContributionsByIncome!)) {
            userPreTax401k += split.preTax;
            userRoth401k += split.roth;
        }
    } else if (usePerAccount) {
    // 2. PER-ACCOUNT (userContributions): the explicit fallback when the per-income
    // map is unusable — empty (#2) or has colliding 401k-feeder ids (#1, e.g. two
    // imported jobs both reconstituted with id=""). Only the trimmed TOTAL per
    // destination account is known here, so split it pre-tax/Roth so the Sankey's
    // Net-Pay deferral matches the deposit even when two jobs share one 401k.
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
    // (Per-feeder shares are NOT keyed by income id, so this stays correct even when
    // the colliding ids that forced us here repeat across the feeders.)
        // Pre-bucket the WorkIncome feeders by destination account ONCE so the
        // per-deposit loop is a Map lookup instead of an incomes.filter() per
        // deposit. (The accounts-by-id lookup is the function-level `accountById`.)
        const feedersByAccount = new Map<string, WorkIncome[]>();
        for (const inc of incomes) {
            if (!(inc instanceof WorkIncome) || !inc.matchAccountId) continue;
            const bucket = feedersByAccount.get(inc.matchAccountId);
            if (bucket) bucket.push(inc);
            else feedersByAccount.set(inc.matchAccountId, [inc]);
        }

        for (const [accountId, deferral] of Object.entries(userContributions!)) {
            if (deferral < MIN_AMOUNT) continue;
            const accountIsRoth = isRothAccount(accountById.get(accountId));

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

            // Build the raw-weight array once and reuse it for both the
            // explains-the-deposit guard and the proportional split.
            const rawWeights = feeders.map(f => f.raw);
            const totalRaw = rawWeights.reduce((sum, w) => sum + w, 0);
            if (feeders.length === 0 || totalRaw < MIN_AMOUNT) {
                // No income explains this deposit (dangling/edge) — fall back to the
                // account's taxType so the deposited total is still represented.
                if (accountIsRoth) userRoth401k += deferral;
                else userPreTax401k += deferral;
                continue;
            }

            // Distribute the trimmed deposit across feeders by raw weight (last feeder
            // absorbs the remainder so the shares sum to `deferral` exactly), then
            // split each feeder's share by its own raw pre-tax : Roth ratio.
            const shares = distributeProportional(deferral, rawWeights);
            feeders.forEach((f, i) => {
                const rothPortion = shares[i] * (f.roth / f.raw);
                userRoth401k += rothPortion;
                userPreTax401k += shares[i] - rothPortion;
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

            // Goals sharing this fund (in expense order), filtered ONCE. Each goal's
            // EXACT own annual set-aside (monthly × that goal's months-active this
            // year) comes from getGoalFundAnnualSetAside on a single-goal array. The
            // fund total IS the sum of those per-goal set-asides (that's exactly what
            // getGoalFundAnnualSetAside(expenses, …) sums internally), so we derive it
            // here from this one scan instead of running a second full pass.
            const sharingGoals = expenses
                .filter(e => isLongTermGoal(e) && e.goalAccountId === exp.goalAccountId)
                .map(goal => ({
                    goal,
                    share: getGoalFundAnnualSetAside([goal], exp.goalAccountId!, year) ?? 0,
                }));

            const fundTotal = sharingGoals.reduce((sum, g) => sum + g.share, 0);
            if (fundTotal < MIN_AMOUNT) continue;

            sharingGoals.forEach(({ goal, share }) => {
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
