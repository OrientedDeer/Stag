import { type AnyAccount, DebtAccount, PropertyAccount } from '../../components/Objects/Accounts/models';
import { type AnyExpense, MortgageExpense, LoanExpense } from '../../components/Objects/Expense/models';

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
 * Wrong-typed FORWARD link is NOT a double-count [#124 review-3 #6]: if a mortgage's
 * linkedAccountId pointed at, say, a SavedAccount with a nonzero balance, that
 * SavedAccount holds the user's own ASSET — it is not the negative loan liability
 * (a SavedAccount has no loanAmount and never carried the loan). The link was simply
 * malformed. Minting the proper PropertyAccount restores the previously-dropped
 * liability; net worth correctly falls by the loan. The asset and the liability are
 * genuinely distinct, so this is the intended behavior, not a duplicate.
 *
 * Call sites: this guard runs on the IMPORT path (useFileManager.handleGlobalImport
 * — JSON/QR/cloud restore), on SCENARIO LOAD (ScenarioContext, ephemeral — feeds the
 * sim, not persisted), and on localStorage BOOT hydration (OrphanLoanReconciler,
 * #136 — persisted, self-healing).
 *
 * Array identity is PER-SIDE [#124 review-4 #8]: the returned `accounts` is a NEW
 * reference only when an account changed (one was created, or a wrong-typed account's
 * stale claim was cleared); the returned `expenses` is a NEW reference only when an
 * expense changed (a back-link was reassigned). The untouched side passes through by
 * reference. So consumers keying off referential equality (React context dispatch,
 * memoized selectors) re-render exactly when THEIR side changed — an account-only
 * stale-claim clear doesn't churn expense consumers, and a back-link-only repair
 * doesn't churn account consumers. Link assignment mutates the passed instances'
 * public `linkedAccountId` field in place (a field write, not a model change), which
 * is acceptable since these are freshly reconstituted instances owned by the caller.
 * Returns the (possibly extended) accounts, the expenses, a `changed` flag, and
 * human-readable notices.
 *
 * `changed` is the authoritative "did anything happen" signal — true when an account
 * was created OR a link was repaired (an expense back-link reassigned, or a stale
 * wrong-typed reverse claim cleared). Callers that PERSIST the result (the boot
 * reconciler, self-healing localStorage) MUST key off `changed`, not `notices`:
 * `notices` carries only the account-creation messages (for a user-facing trace), so
 * a pure back-link repair has an empty `notices` but `changed === true`. Persisting
 * only on a non-empty `notices` would silently drop back-link-only repairs and
 * re-derive them every boot. When nothing is orphaned, the inputs pass through
 * unchanged, `changed` is false, and `notices` is empty.
 */
export interface OrphanLinkResult {
    accounts: AnyAccount[];
    expenses: AnyExpense[];
    /** True if any account was created or any link (back-link / stale reverse claim) was repaired. */
    changed: boolean;
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

    // Index loan-bearing accounts that already claim a given expense id
    // (account.linkedAccountId === expense.id). The expense->account and
    // account->expense links are set INDEPENDENTLY at creation, so a backup can
    // carry one direction without the other: a PropertyAccount/DebtAccount
    // legitimately points at the loan while the expense's own linkedAccountId is
    // empty or dangling. Such a loan is NOT an orphan — its balance already lives
    // on that account; creating a second paired account would double-claim it.
    // We index ALL Property/Debt claimants (not just correctly-typed ones) so a
    // wrong-typed claimant (a DebtAccount claiming a MortgageExpense, or vice-versa)
    // can be detected and its stale claim cleared [#124 review-3 #7]; coverage still
    // requires a correctly-typed claimant via isCarrier below.
    const claimantsByExpenseId = new Map<string, (PropertyAccount | DebtAccount)[]>();
    for (const acc of accounts) {
        if ((acc instanceof PropertyAccount || acc instanceof DebtAccount) && acc.linkedAccountId) {
            const list = claimantsByExpenseId.get(acc.linkedAccountId);
            if (list) list.push(acc);
            else claimantsByExpenseId.set(acc.linkedAccountId, [acc]);
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
        const claimants = claimantsByExpenseId.get(expense.id);
        if (claimants) {
            const carrier = claimants.find(c => isCarrier(c, expense));
            if (carrier) return carrier;
        }
        return null;
    };

    // Clear any WRONG-TYPED account still claiming this expense (account.linkedAccountId
    // === expense.id but the account cannot carry this expense's loan — a DebtAccount
    // claiming a mortgage, or a PropertyAccount claiming a loan). Such a claim is stale:
    // the wrong-typed account never carried the loan and now dangles. A CORRECTLY-TYPED
    // account that also claims the expense is NOT cleared — two legitimate carriers of
    // one expense (or a genuine second financed property) must each keep their link so
    // AccountGrowth keeps syncing the loan onto them [#124 review-4 #2]. The chosen
    // carrier is correctly-typed, so it is never touched here either.
    // Returns true if it cleared anything.
    const clearStaleClaims = (expense: MortgageExpense | LoanExpense): boolean => {
        const claimants = claimantsByExpenseId.get(expense.id);
        if (!claimants) return false;
        let cleared = false;
        for (const acc of claimants) {
            if (!isCarrier(acc, expense) && acc.linkedAccountId === expense.id) {
                acc.linkedAccountId = '';
                cleared = true;
            }
        }
        return cleared;
    };

    const createdAccounts: AnyAccount[] = [];
    const notices: string[] = [];
    // Track which SIDE changed so we hand back a new array reference only for the side
    // that actually changed [#124 review-4 #8]: an expense back-link reassignment is an
    // expense change; clearing a wrong-typed account's stale claim is an account change;
    // minting a paired account is both.
    let accountsChanged = false;
    let expensesChanged = false;

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
            // Loan is already carried by a correctly-typed account. Just repair the
            // expense's back-link if it's broken; do NOT mint a second account.
            if (expense.linkedAccountId !== existing.id) {
                expense.linkedAccountId = existing.id;
                expensesChanged = true;
            }
            // Clear any wrong-typed account still claiming this expense [#7].
            if (clearStaleClaims(expense)) accountsChanged = true;
            continue;
        }

        const accountId = makeAccountId(expense.id);
        accountIds.add(accountId);
        // A new carrier is being minted; clear any wrong-typed account that was
        // claiming this expense so it doesn't keep a stale reference [#7].
        if (clearStaleClaims(expense)) accountsChanged = true;

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
        // A paired account was created AND the expense's back-link was set: both sides changed.
        accountsChanged = true;
        expensesChanged = true;
    }

    const changed = accountsChanged || expensesChanged;

    // Return a NEW array reference ONLY for the side that actually changed [#8], so
    // consumers keying off referential equality (React context dispatch / memoized
    // selectors) re-render exactly when their side changed, and pass the untouched
    // side through by reference. `changed` is the overall signal (account created,
    // back-link reassigned, or wrong-typed stale claim cleared).
    return {
        accounts: accountsChanged ? [...accounts, ...createdAccounts] : accounts,
        expenses: expensesChanged ? [...expenses] : expenses,
        changed,
        notices,
    };
}
