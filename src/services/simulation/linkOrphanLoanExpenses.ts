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
 * a MortgageExpense / LoanExpense whose linkedAccountId is empty, points at an
 * account that isn't present, or points at an account of the wrong type (one that
 * carries no loan). Such an "orphan" loan would otherwise be silently dropped from
 * net worth (its balance lives only on the expense side, which the account-only
 * reconciler never reads). To prevent that silent liability loss, this pass
 * auto-creates and bidirectionally links a correctly-typed paired account for each
 * orphan, mirroring the paired-account creation in AddExpenseModal.tsx:312-333:
 *   - MortgageExpense -> PropertyAccount('Financed', value=valuation, loan=loan_balance)
 *   - LoanExpense     -> DebtAccount(amount=expense.amount)
 *
 * Both link directions are set so the dedup in MilestoneEvaluator (keyed off
 * account.linkedAccountId == expense.id) and the per-year balance sync in
 * AccountGrowth (keyed off expense.linkedAccountId == account.id) both resolve.
 *
 * Call sites: this guard runs on the IMPORT path (useFileManager.handleGlobalImport
 * — JSON/QR/cloud restore) and on SCENARIO LOAD (ScenarioContext, ephemeral — feeds
 * the sim, not persisted). It is NOT yet wired into localStorage boot-hydration
 * (AccountProvider/ExpenseProvider hydrate from separate keys with no shared
 * chokepoint); covering that path is tracked as issue #136 (a pending user decision).
 *
 * Pure: returns new arrays; expense link assignment mutates the passed expense
 * instances' public `linkedAccountId` field in place (a field write, not a model
 * change), which is acceptable since these are freshly reconstituted instances
 * owned by the caller. Returns the (possibly extended) accounts, the expenses, and
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
    const accountById = new Map<string, AnyAccount>(accounts.map(a => [a.id, a]));

    // The loan-carrying account for a given expense must be the RIGHT type: a
    // MortgageExpense's balance lives on a PropertyAccount.loanAmount, a
    // LoanExpense's on a DebtAccount.amount. SavedAccount/InvestedAccount/etc.
    // carry no loan, and AccountGrowth only syncs linkedState onto Property/Debt,
    // so a link to the wrong type does NOT carry the liability — the loan would
    // still be silently dropped from account-only net worth. Treat such a link as
    // uncovered so the proper paired account is still created.
    const isCarrier = (acc: AnyAccount | undefined, expense: MortgageExpense | LoanExpense): boolean => {
        if (!acc) return false;
        return expense instanceof MortgageExpense
            ? acc instanceof PropertyAccount
            : acc instanceof DebtAccount;
    };

    // Index correctly-typed loan-carrying accounts that already claim a given
    // expense id (account.linkedAccountId === expense.id). The expense->account and
    // account->expense links are set INDEPENDENTLY at creation, so a backup can
    // carry one direction without the other: a PropertyAccount/DebtAccount
    // legitimately points at the loan while the expense's own linkedAccountId is
    // empty or dangling. Such a loan is NOT an orphan — its balance already lives
    // on that account; creating a second paired account would double-claim it.
    // Only correctly-typed carriers are indexed: a DebtAccount claiming a
    // MortgageExpense (or vice-versa) does NOT cover it.
    const carrierByClaimedExpenseId = new Map<string, AnyAccount>();
    for (const acc of accounts) {
        if ((acc instanceof PropertyAccount || acc instanceof DebtAccount) && acc.linkedAccountId) {
            // First writer wins; a well-formed backup never has two accounts
            // claiming the same expense, and reusing one is strictly safer than
            // minting a duplicate.
            if (!carrierByClaimedExpenseId.has(acc.linkedAccountId)) {
                carrierByClaimedExpenseId.set(acc.linkedAccountId, acc);
            }
        }
    }

    // An expense is already covered only when a correctly-TYPED, loan-carrying
    // account links it in EITHER direction: its own linkedAccountId names a present
    // carrier of the right type, OR such a carrier claims this expense. Anything
    // else (no link, link to a non-carrier type, wrong-typed claim) => still an
    // orphan, so the proper paired account gets created.
    const coveringAccount = (expense: MortgageExpense | LoanExpense): AnyAccount | null => {
        if (expense.linkedAccountId) {
            const forward = accountById.get(expense.linkedAccountId);
            if (isCarrier(forward, expense)) return forward!;
        }
        const reverse = carrierByClaimedExpenseId.get(expense.id);
        if (isCarrier(reverse, expense)) return reverse!;
        return null;
    };

    const createdAccounts: AnyAccount[] = [];
    const notices: string[] = [];

    // Derive a paired-account id from the expense id the same way AddExpenseModal
    // does ('ACC' + id-suffix). Guard against collisions with ANY id we know about
    // (existing accounts + ones we just created) by falling back to a unique
    // suffix, so we never alias onto an unrelated account.
    const makeAccountId = (expenseId: string): string => {
        const base = expenseId.length > 3 ? 'ACC' + expenseId.substring(3) : `ACC-${expenseId}`;
        let candidate = base;
        let n = 1;
        while (accountIds.has(candidate)) {
            candidate = `${base}-relink${n++}`;
        }
        return candidate;
    };

    for (const expense of expenses) {
        const isMortgage = expense instanceof MortgageExpense;
        const isLoan = expense instanceof LoanExpense;
        if (!isMortgage && !isLoan) continue;

        const existing = coveringAccount(expense);
        if (existing) {
            // Loan is already carried by an account. Just repair the expense's
            // back-link if it's broken; do NOT mint a second account.
            if (expense.linkedAccountId !== existing.id) {
                expense.linkedAccountId = existing.id;
            }
            continue;
        }

        const accountId = makeAccountId(expense.id);
        accountIds.add(accountId);

        if (isMortgage) {
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
        } else {
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
