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
}

/**
 * Build the per-year cashflow detail consumed by the Sankey chart.
 *
 * The sim already does all this math while running — this just packages
 * the per-source breakdown into a stable shape so the chart doesn't have
 * to re-derive it (and drift from the sim's actual values).
 */
export function buildCashflowDetail(input: BuildCashflowDetailInput): CashflowDetail {
    const { incomes, expenses, accounts, insurance, year, brokerageLTCGFromGross, employerInflows } = input;

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
            userPreTax401k += inc.getProratedAnnual(inc.preTax401k, year);
            userRoth401k += inc.getProratedAnnual(inc.roth401k, year);

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
    // fund, so it must be read once per fund — never once per goal. SimulationEngine
    // does exactly this (its per-fund goalFundCredits map, keyed by accountId), so
    // living expenses count the set-aside once. Track which funds we've already
    // emitted so two goals on one fund don't each write the full fund-wide sum and
    // double-count it (which would unbalance the Expenses node by the set-aside).
    const emittedGoalFunds = new Set<string>();
    for (const exp of expenses) {
        if (exp instanceof MortgageExpense) continue;
        // Long-term goals report $0 from getAnnualAmount, but their committed
        // set-aside IS in the sim's living expenses (SimulationEngine counts it
        // and credits the fund). Without a matching category here the Sankey's
        // Expenses node is unbalanced by exactly the set-aside.
        let amount: number;
        if (isLongTermGoal(exp) && exp.goalAccountId) {
            if (emittedGoalFunds.has(exp.goalAccountId)) continue; // fund already credited once
            emittedGoalFunds.add(exp.goalAccountId);
            amount = getGoalFundAnnualSetAside(expenses, exp.goalAccountId, year) ?? 0;
        } else {
            amount = exp.getAnnualAmount(year);
        }
        if (amount < MIN_AMOUNT) continue;
        // Each goal gets its own labeled node ("Car (goal)") — clearer in the
        // chart than a generic "Goals" bucket, and the "(goal)" suffix avoids
        // colliding with a regular expense of the same name. When several goals
        // share one fund the fund's whole set-aside is attributed to the first
        // goal's label (the set-aside is per-fund, not per-goal).
        const category = isLongTermGoal(exp)
            ? `${exp.name} (goal)`
            : (CLASS_TO_CATEGORY[exp.constructor.name] || 'Other');
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
