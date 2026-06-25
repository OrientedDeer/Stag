import { AnyAccount, DebtAccount, PropertyAccount } from '../../components/Objects/Accounts/models';
import { AnyExpense, MortgageExpense, LoanExpense } from '../../components/Objects/Expense/models';

/**
 * Orphan-loan repair for imported / restored state (#124).
 *
 * Net worth and total debt are sourced from ACCOUNTS only (calculateNetWorth /
 * getAccountTotals): liabilities come from DebtAccount/DeficitDebtAccount balances
 * and PropertyAccount.loanAmount, NOT from the expense side. That keeps net worth
 * single-sourced and matches every display surface — but it relies on the invariant
 * that AddExpenseModal already enforces at creation time: every MortgageExpense /
 * LoanExpense has a paired PropertyAccount / DebtAccount carrying its balance.
 *
 * Imported, QR-restored, legacy, or hand-edited backups can violate that invariant:
 * a MortgageExpense / LoanExpense whose linkedAccountId is empty, or points at an
 * account that isn't present. Such an "orphan" loan would otherwise be silently
 * dropped from net worth (its balance lives only on the expense side, which the
 * account-only reconciler never reads). To prevent that silent liability loss, this
 * pass auto-creates and bidirectionally links a paired account for each orphan,
 * mirroring AddExpenseModal.tsx:312-347:
 *   - MortgageExpense -> PropertyAccount('Financed', value=valuation, loan=loan_balance)
 *   - LoanExpense     -> DebtAccount(amount=expense.amount)
 *
 * Both link directions are set so the dedup in MilestoneEvaluator (keyed off
 * account.linkedAccountId == expense.id) and the per-year balance sync in
 * AccountGrowth (keyed off expense.linkedAccountId == account.id) both resolve.
 *
 * Pure: returns new arrays; expense link assignment mutates the passed expense
 * instances' public `linkedAccountId` field in place (a field write, not a model
 * change), which is acceptable since these are freshly reconstituted instances
 * owned by the import. Returns the (possibly extended) accounts, the expenses, and
 * a list of human-readable notices describing each repair (so a trace is surfaced
 * rather than mutating silently). When nothing is orphaned the inputs pass through
 * unchanged and `notices` is empty.
 */
export interface OrphanLinkResult {
    accounts: AnyAccount[];
    expenses: AnyExpense[];
    notices: string[];
}

export function linkOrphanLoanExpenses(
    accounts: AnyAccount[],
    expenses: AnyExpense[],
): OrphanLinkResult {
    const accountIds = new Set(accounts.map(a => a.id));

    // An expense is "linked" if its linkedAccountId names an account that is
    // actually present. Empty string or a dangling id both count as orphaned.
    const isLinked = (expense: MortgageExpense | LoanExpense): boolean =>
        !!expense.linkedAccountId && accountIds.has(expense.linkedAccountId);

    const createdAccounts: AnyAccount[] = [];
    const notices: string[] = [];

    // Derive a paired-account id from the expense id the same way AddExpenseModal
    // does ('ACC' + id-suffix). Guard against collisions with an existing id by
    // falling back to a unique suffix, so we never alias onto an unrelated account.
    const makeAccountId = (expenseId: string): string => {
        const base = expenseId.length > 3 ? 'ACC' + expenseId.substring(3) : `ACC-${expenseId}`;
        if (!accountIds.has(base)) return base;
        let candidate = base;
        let n = 1;
        while (accountIds.has(candidate)) {
            candidate = `${base}-relink${n++}`;
        }
        return candidate;
    };

    for (const expense of expenses) {
        if (expense instanceof MortgageExpense) {
            if (isLinked(expense)) continue;
            const accountId = makeAccountId(expense.id);
            accountIds.add(accountId);
            createdAccounts.push(new PropertyAccount(
                accountId,
                expense.name,
                expense.valuation,
                'Financed',
                expense.loan_balance,
                expense.starting_loan_balance || expense.loan_balance,
                expense.id,
                expense.apr,
            ));
            expense.linkedAccountId = accountId;
            notices.push(
                `Relinked imported mortgage "${expense.name}": created property account to carry its $${Math.round(expense.loan_balance).toLocaleString()} balance.`,
            );
        } else if (expense instanceof LoanExpense) {
            if (isLinked(expense)) continue;
            const accountId = makeAccountId(expense.id);
            accountIds.add(accountId);
            createdAccounts.push(new DebtAccount(
                accountId,
                expense.name,
                expense.amount,
                expense.id,
                expense.apr,
            ));
            expense.linkedAccountId = accountId;
            notices.push(
                `Relinked imported loan "${expense.name}": created debt account to carry its $${Math.round(expense.amount).toLocaleString()} balance.`,
            );
        }
    }

    if (createdAccounts.length === 0) {
        return { accounts, expenses, notices };
    }

    return { accounts: [...accounts, ...createdAccounts], expenses, notices };
}
