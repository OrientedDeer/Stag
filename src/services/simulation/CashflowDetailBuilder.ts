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
} from "../../components/Objects/Expense/models";
import { AnyAccount, InvestedAccount } from "../../components/Objects/Accounts/models";
import {
    CashflowDetail,
    CashflowIncomeKind,
    CashflowIncomeSource,
} from "./types";

const MIN_AMOUNT = 0.005;

interface BuildCashflowDetailInput {
    /** Active incomes after earnings test, excluding RMD-sourced PassiveIncomes. */
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
}

/**
 * Build the per-year cashflow detail consumed by the Sankey chart.
 *
 * The sim already does all this math while running — this just packages
 * the per-source breakdown into a stable shape so the chart doesn't have
 * to re-derive it (and drift from the sim's actual values).
 */
export function buildCashflowDetail(input: BuildCashflowDetailInput): CashflowDetail {
    const { incomes, expenses, accounts, insurance, year, brokerageLTCGFromGross } = input;

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

            if (inc.matchAccountId) {
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
            // RMDs are surfaced as withdrawals (in cashflow.withdrawalDetail), not as income.
            if (inc.sourceType === 'RMD') continue;

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
    for (const exp of expenses) {
        if (exp instanceof MortgageExpense) continue;
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
