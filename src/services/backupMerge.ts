/**
 * backupMerge - headless, React-free merge of new SimpleFIN data into a decrypted
 * Stag backup blob. This is the single source of truth that the in-app import UI
 * (reducers in BudgetContext / AccountContext) and the headless stag-feed importer
 * must agree on, so neither hand-mirrors the other.
 *
 * It operates on a *plain decrypted FullBackup object* (post-JSON.parse, no class
 * reconstitution) and mutates it in place, returning a report. Fold repeatedly
 * against the same working blob; don't recreate it between calls.
 *
 * Mirrors three pieces of in-app behavior exactly:
 *   - BudgetContext `getOrCreateMonth` + `BULK_ADD_TRANSACTIONS` (append txns,
 *     creating the month snapshot if missing).
 *   - AccountContext `ADD_AMOUNT_SNAPSHOT` (append {date,num} to amountHistory[id],
 *     replacing the last entry when it shares the same date => idempotent per day).
 *   - ImportBalancesModal `handleApply` (BOTH the account.amount write AND the
 *     history snapshot — the simulation reads account.amount, not the history tail).
 *
 * If you change those reducers, change this file (and backupMerge.test.ts) to match.
 *
 * Tolerates both v1 (no budget / no balanceAccountMap) and v2 blobs.
 */

import { applyCategories, detectDuplicates, detectIncomeCategory } from './CSVImportService';
import { autoMatchAccount } from './simplefinBalances';
import type { Transaction, CategoryMapping, MonthlySnapshot, BudgetState } from '../components/Objects/Budget/BudgetTypes';

// --- The structural subset of a decrypted FullBackup these helpers read/mutate ---

export interface AmountPoint {
    date: string; // YYYY-MM-DD
    num: number;
}

export interface MergeableAccount {
    id: string;
    name: string;
    amount?: number;
    [k: string]: unknown;
}

export interface MergeBlob {
    version?: number;
    accounts: MergeableAccount[];
    amountHistory: Record<string, AmountPoint[]>;
    budget?: BudgetState;
    /** csvAccount -> appAccountId[] (present in v2 blobs). */
    balanceAccountMap?: Record<string, string[]>;
    [k: string]: unknown;
}

// --- Reports ---

export interface TransactionMergeReport {
    added: number;
    duplicatesSkipped: number;
    autoCategorized: number;
    /** "YYYY-M" -> count appended */
    byMonth: Record<string, number>;
}

export interface BalanceUpdate {
    id: string;
    name: string;
    amount: number;
}

export interface BalanceFlag {
    /** SimpleFIN account key from the input row. */
    account: string;
    reason:
        | 'unmapped'             // no mapping and no confident auto-match
        | 'auto-matched'         // not in the map, but matched a single account by name
        | 'multi-target-split'   // one balance split across several accounts by weight
        | 'missing-account';     // mapped id no longer exists in the blob
}

export interface BalanceMergeReport {
    updated: BalanceUpdate[];
    flagged: BalanceFlag[];
}

export interface BalanceRowInput {
    /** SimpleFIN account key — matches the keys in balanceAccountMap. */
    account: string;
    /** Current balance (may be negative for debts/credit cards). */
    balance: number;
}

export interface NewTransactionInput {
    /** Stable unique id. For a stable source (SimpleFIN), use its txn id so
     *  exact id-dedup works across overlapping re-fetches. */
    id: string;
    /** Posted date as 'YYYY-MM-DD'. */
    date: string;
    description: string;
    /** Signed amount in Stag's convention: money out = negative. */
    amount: number;
}

export interface ApplyTransactionsOptions {
    /**
     * 'fuzzy' (default): date + amount ±$0.01 + ~80% description similarity —
     *   mirrors the in-app manual-CSV importer, for sources without stable ids.
     * 'id': exact match on Transaction.id against existing txns — correct for a
     *   stable-id source (keeps two genuinely-distinct same-day/same-amount
     *   charges; suppresses only true re-fetches of the same id).
     */
    dedup?: 'fuzzy' | 'id';
}

/**
 * Build a Transaction from a stable source, mirroring CSVImportService.applyMapping's
 * flagging so the headless path and the in-app path agree:
 *   - date -> a local-midnight Date (matches parseDate('YYYY-MM-DD'); avoids the
 *     UTC-bucketing-into-the-prior-month boundary bug on negative-offset runners),
 *   - isPossibleCredit = amount > 0,
 *   - incomeCategory via detectIncomeCategory for credits.
 * expenseId is left for applyCategories; isReimbursement/isTransfer/accountId/
 * statementDate default off, exactly as applyMapping leaves them.
 */
export function makeTransaction(input: NewTransactionInput): Transaction {
    const isPossibleCredit = input.amount > 0;
    return {
        id: input.id,
        date: new Date(`${input.date}T00:00:00`),
        description: input.description.trim(),
        amount: input.amount,
        isPossibleCredit,
        incomeCategory: isPossibleCredit ? (detectIncomeCategory(input.description) ?? undefined) : undefined,
    };
}

// --- Small helpers (mirror the app) ---

function generateMonthId(): string {
    // Mirrors BudgetContext.generateId('MONTH').
    return `MONTH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function localToday(): string {
    // Mirrors AccountContext.getTodayString(): local run-day date (not UTC, which
    // would stamp tomorrow's date in the evening of a negative-offset timezone).
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * Find or create the month snapshot in the blob (mutates blob.budget.months).
 * Creates a default budget container if the blob has none (v1 backups).
 */
function getOrCreateMonth(blob: MergeBlob, month: number, year: number): MonthlySnapshot {
    if (!blob.budget) {
        blob.budget = {
            months: [],
            importSettings: {
                dateColumn: '',
                amountColumn: '',
                descriptionColumn: '',
                categoryMappings: [],
                savedCSVFormats: [],
                autoCreateRules: false,
            },
            selectedMonth: month,
            selectedYear: year,
        };
    }
    const existing = blob.budget.months.find(m => m.month === month && m.year === year);
    if (existing) return existing;

    const created: MonthlySnapshot = {
        id: generateMonthId(),
        month,
        year,
        spending: {},
        accountBalances: {},
        contributions: {},
        transactions: [],
        reconciled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    blob.budget.months.push(created);
    return created;
}

/** Mirror of AccountContext ADD_AMOUNT_SNAPSHOT, but date is caller-controlled. */
function addAmountSnapshot(blob: MergeBlob, id: string, amount: number, date: string): void {
    const history = blob.amountHistory[id] ?? [];
    const last = history[history.length - 1];
    const entry: AmountPoint = { date, num: amount };
    blob.amountHistory[id] = last?.date === date
        ? [...history.slice(0, -1), entry]
        : [...history, entry];
}

// --- Public API ---

/**
 * Merge incoming transactions into the blob. Pipeline mirrors useCSVImportFlow:
 * auto-categorize -> detect duplicates against ALL existing blob transactions ->
 * drop duplicates -> bucket by month -> append (creating months as needed).
 *
 * `incoming` is already parsed into Transactions (build them directly, or via
 * CSVImportService's parse functions). Each must carry a stable, unique `id`;
 * dates should be ISO strings since the blob is JSON.
 */
export function applyTransactions(
    blob: MergeBlob,
    incoming: Transaction[],
    opts: ApplyTransactionsOptions = {}
): TransactionMergeReport {
    const report: TransactionMergeReport = {
        added: 0,
        duplicatesSkipped: 0,
        autoCategorized: 0,
        byMonth: {},
    };
    if (incoming.length === 0) return report;

    const rules: CategoryMapping[] = blob.budget?.importSettings?.categoryMappings ?? [];

    // Existing transactions across every month — the dedup universe.
    const existing: Transaction[] = (blob.budget?.months ?? []).flatMap(m => m.transactions ?? []);

    const { categorized, autoCategorizedCount } = applyCategories(incoming, rules);

    let toAdd: Transaction[];
    if ((opts.dedup ?? 'fuzzy') === 'id') {
        const existingIds = new Set(existing.map(e => e.id));
        toAdd = categorized.filter(t => !existingIds.has(t.id));
    } else {
        const dupeIds = new Set(detectDuplicates(categorized, existing).map(d => d.id));
        toAdd = categorized.filter(t => !dupeIds.has(t.id));
    }

    report.autoCategorized = autoCategorizedCount;
    report.duplicatesSkipped = categorized.length - toAdd.length;

    // Bucket by month/year exactly as the UI does.
    const byMonth: Record<string, Transaction[]> = {};
    for (const txn of toAdd) {
        const d = new Date(txn.date);
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        (byMonth[key] ??= []).push(txn);
    }

    for (const [key, txns] of Object.entries(byMonth)) {
        const [yearStr, monthStr] = key.split('-');
        const snapshot = getOrCreateMonth(blob, parseInt(monthStr, 10), parseInt(yearStr, 10));
        snapshot.transactions = [...snapshot.transactions, ...txns];
        snapshot.updatedAt = new Date();
        report.byMonth[key] = txns.length;
        report.added += txns.length;
    }

    return report;
}

/**
 * Apply SimpleFIN balances to the blob. For each row:
 *   - 1 mapped account  -> apply the full balance.
 *   - N mapped accounts -> split by current-balance weight (splitByWeight); even
 *     split when all current balances are zero. Flagged 'multi-target-split'.
 *   - no mapping        -> try a confident name auto-match (flagged 'auto-matched');
 *                          otherwise flagged 'unmapped' and skipped.
 * Each applied account gets BOTH writes: account.amount and a history snapshot.
 *
 * `date` defaults to the UTC run-date, matching the in-app reducer (idempotent
 * per day). Pass an explicit date only if you intend to own same-date dedup.
 */
export function applyBalances(
    blob: MergeBlob,
    rows: BalanceRowInput[],
    opts: { date?: string } = {}
): BalanceMergeReport {
    const date = opts.date ?? localToday();
    const map = blob.balanceAccountMap ?? {};
    const report: BalanceMergeReport = { updated: [], flagged: [] };

    const accountById = new Map(blob.accounts.map(a => [a.id, a]));

    const applyOne = (id: string, value: number) => {
        const account = accountById.get(id);
        if (!account) return false;
        account.amount = value;
        addAmountSnapshot(blob, id, value, date);
        report.updated.push({ id, name: account.name, amount: value });
        return true;
    };

    for (const row of rows) {
        const targetIds = map[row.account];

        // Fallback: no explicit mapping -> attempt a confident single auto-match.
        if (!targetIds || targetIds.length === 0) {
            const matched = autoMatchAccount(row.account, blob.accounts);
            if (matched) {
                applyOne(matched, round2(row.balance));
                report.flagged.push({ account: row.account, reason: 'auto-matched' });
            } else {
                report.flagged.push({ account: row.account, reason: 'unmapped' });
            }
            continue;
        }

        if (targetIds.length === 1) {
            const ok = applyOne(targetIds[0], round2(row.balance));
            if (!ok) report.flagged.push({ account: row.account, reason: 'missing-account' });
            continue;
        }

        // Multi-target: split by current-balance weight.
        const present = targetIds.filter(id => accountById.has(id));
        if (present.length === 0) {
            report.flagged.push({ account: row.account, reason: 'missing-account' });
            continue;
        }
        const weights = present.map(id => Math.abs(accountById.get(id)!.amount ?? 0));
        const totalWeight = weights.reduce((s, w) => s + w, 0);

        let allocated = 0;
        present.forEach((id, i) => {
            // Last account absorbs the rounding remainder so the split sums exactly.
            const isLast = i === present.length - 1;
            const share = isLast
                ? round2(row.balance - allocated)
                : round2(totalWeight > 0 ? row.balance * (weights[i] / totalWeight) : row.balance / present.length);
            allocated = round2(allocated + share);
            applyOne(id, share);
        });
        report.flagged.push({ account: row.account, reason: 'multi-target-split' });
    }

    return report;
}
