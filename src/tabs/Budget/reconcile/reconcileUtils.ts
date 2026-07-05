/**
 * Pure helpers for the Statement Compare (Reconcile) feature.
 *
 * The idea: a credit-card statement covers a date range. If you sum the
 * transactions you've recorded for that card over the same range, the total
 * should match the statement — if it doesn't, you're probably missing (or
 * double-counting) transactions. These functions gather a source's
 * transactions across every monthly snapshot and break the total into
 * charges / credits / net so the UI can compare against whatever line the
 * statement shows.
 */
import type { MonthlySnapshot, Transaction } from '../../../components/Objects/Budget/BudgetTypes';

/** Local Y/M/D ordinal (YYYYMMDD) for date-only, timezone-safe comparison. */
function dateOrdinal(d: Date): number {
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * The date a statement files this transaction under (#163): the bank's posted
 * date when known, else the transaction date. Statements cut on posting — a
 * charge swiped June 30 that posts July 2 belongs to the July statement. The
 * fallback covers pre-#163 rows and banks that send no separate posted date
 * (for those, `date` already IS the posted date).
 */
export function statementDateOf(t: Transaction): Date {
    return new Date(t.postedDate ?? t.date);
}

export interface StatementCompareInput {
    /** Source label to match (exact). Empty string matches untagged transactions. */
    source: string;
    /** Inclusive start of the window (date-only). Undefined = no lower bound. */
    start?: Date;
    /** Inclusive end of the window (date-only). Undefined = no upper bound. */
    end?: Date;
}

export interface StatementCompareResult {
    /** Matched transactions, sorted by date ascending. */
    transactions: Transaction[];
    /** Sum of charges (spending) as a positive number — |amount| for amount < 0. */
    charges: number;
    /** Sum of credits (payments/refunds) as a positive number — amount for amount > 0. */
    credits: number;
    /** charges - credits: the net change to the balance over the window. */
    net: number;
    /** Number of matched transactions. */
    count: number;
}

/**
 * Gather every transaction across all monthly snapshots that matches `source`
 * and falls inside [start, end] (inclusive, date-only), then total it up.
 *
 * Classification is purely by sign so the result is predictable and the
 * caller can show the underlying list for auditing: amount < 0 is a charge,
 * amount > 0 is a credit. Transfers/contributions are NOT special-cased —
 * whatever is tagged to the source counts by its sign.
 */
export function computeStatementCompare(
    months: MonthlySnapshot[],
    { source, start, end }: StatementCompareInput,
): StatementCompareResult {
    const startOrd = start ? dateOrdinal(start) : -Infinity;
    const endOrd = end ? dateOrdinal(end) : Infinity;

    const matched: Transaction[] = [];
    for (const month of months) {
        for (const t of month.transactions) {
            if ((t.source || '') !== source) continue;
            // #163: statements cut on the POSTED date, so window membership and
            // ordering use it (falling back to the transaction date).
            const ord = dateOrdinal(statementDateOf(t));
            if (ord < startOrd || ord > endOrd) continue;
            matched.push(t);
        }
    }

    matched.sort((a, b) => dateOrdinal(statementDateOf(a)) - dateOrdinal(statementDateOf(b)));

    let charges = 0;
    let credits = 0;
    for (const t of matched) {
        if (t.amount < 0) charges += Math.abs(t.amount);
        else if (t.amount > 0) credits += t.amount;
    }

    return {
        transactions: matched,
        charges,
        credits,
        net: charges - credits,
        count: matched.length,
    };
}

/**
 * Distinct, non-empty source labels used across all snapshots, sorted
 * case-insensitively. Drives both the autocomplete suggestions on the
 * transaction forms and the source picker on the Reconcile tab.
 */
export function getKnownSources(months: MonthlySnapshot[]): string[] {
    const seen = new Set<string>();
    for (const month of months) {
        for (const t of month.transactions) {
            const s = t.source?.trim();
            if (s) seen.add(s);
        }
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
