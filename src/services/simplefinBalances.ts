/**
 * simplefinBalances - Parses the balances CSV produced by stag-feed (SimpleFin)
 * and helps map its accounts onto the app's own accounts.
 *
 * Expected columns (header row, case-insensitive):
 *   FetchedAt, Org, Account, Balance, AvailableBalance, BalanceDate, Currency
 *
 * The file may contain multiple dated snapshots per account; we collapse to the
 * single most-recent row per account (by FetchedAt, then BalanceDate).
 */

import { parseCSV } from './CSVImportService';

export interface BalanceRow {
    org: string;        // e.g. "First Bank"
    account: string;    // e.g. "Savings Account (1111)" — used as the stable mapping key
    balance: number;    // current balance (may be negative for debts/credit cards)
    balanceDate: string; // YYYY-MM-DD
    fetchedAt: string;   // raw FetchedAt value, used only to pick the latest row
}

export interface ParsedBalances {
    rows: BalanceRow[];  // one row per account, newest snapshot only
    errors: string[];
}

// localStorage key holding { [csvAccount]: appAccountId } so repeat imports auto-match.
const MAPPING_STORAGE_KEY = 'stag_balance_account_map';

const REQUIRED_COLUMNS = ['Account', 'Balance'] as const;

function findColumn(headers: string[], name: string): number {
    const target = name.toLowerCase();
    return headers.findIndex((h) => h.trim().toLowerCase() === target);
}

function parseAmount(raw: string): number {
    // Strip currency symbols, thousands separators, and whitespace.
    const cleaned = (raw ?? '').replace(/[$,\s]/g, '');
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : NaN;
}

/**
 * Parse the raw CSV text from stag-feed into one row per account (latest snapshot).
 */
export function parseBalancesCSV(content: string): ParsedBalances {
    const errors: string[] = [];
    const { headers, rows } = parseCSV(content);

    if (headers.length === 0 || rows.length === 0) {
        return { rows: [], errors: ['The file is empty or has no data rows.'] };
    }

    const missing = REQUIRED_COLUMNS.filter((c) => findColumn(headers, c) === -1);
    if (missing.length > 0) {
        return {
            rows: [],
            errors: [`Missing expected column(s): ${missing.join(', ')}. Is this a stag-feed balances file?`],
        };
    }

    const idx = {
        org: findColumn(headers, 'Org'),
        account: findColumn(headers, 'Account'),
        balance: findColumn(headers, 'Balance'),
        balanceDate: findColumn(headers, 'BalanceDate'),
        fetchedAt: findColumn(headers, 'FetchedAt'),
    };

    // Collapse to the newest row per account.
    const latest = new Map<string, BalanceRow>();

    rows.forEach((cols, i) => {
        const account = (cols[idx.account] ?? '').trim();
        if (!account) return; // skip blank rows silently

        const balance = parseAmount(cols[idx.balance]);
        if (Number.isNaN(balance)) {
            errors.push(`Row ${i + 2}: could not read balance "${cols[idx.balance]}" for "${account}".`);
            return;
        }

        const row: BalanceRow = {
            org: idx.org === -1 ? '' : (cols[idx.org] ?? '').trim(),
            account,
            balance,
            balanceDate: idx.balanceDate === -1 ? '' : (cols[idx.balanceDate] ?? '').trim(),
            fetchedAt: idx.fetchedAt === -1 ? '' : (cols[idx.fetchedAt] ?? '').trim(),
        };

        const existing = latest.get(account);
        if (!existing || isNewer(row, existing)) {
            latest.set(account, row);
        }
    });

    return { rows: [...latest.values()], errors };
}

// A row is "newer" if its FetchedAt (preferred) or BalanceDate sorts later.
function isNewer(candidate: BalanceRow, current: BalanceRow): boolean {
    const a = candidate.fetchedAt || candidate.balanceDate;
    const b = current.fetchedAt || current.balanceDate;
    return a.localeCompare(b) >= 0;
}

// ---------------------------------------------------------------------------
// Account matching
// ---------------------------------------------------------------------------

/** Normalize a name for fuzzy comparison: lowercase, strip masked digits and punctuation. */
function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .replace(/\(\s*[x*]*\d+\s*\)/g, ' ') // drop "(1111)" / "(x1234)" masks
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

/**
 * Best-effort auto-match of a CSV account to one of the app's accounts.
 * Returns the matching app account id, or null if no confident match.
 */
export function autoMatchAccount(
    csvAccount: string,
    appAccounts: { id: string; name: string }[]
): string | null {
    const target = normalizeName(csvAccount);
    if (!target) return null;

    // 1. Exact normalized match.
    const exact = appAccounts.find((a) => normalizeName(a.name) === target);
    if (exact) return exact.id;

    // 2. One name contains the other (e.g. "Primary Savings" vs "Savings Account").
    const contains = appAccounts.find((a) => {
        const n = normalizeName(a.name);
        return n.length > 2 && (n.includes(target) || target.includes(n));
    });
    return contains ? contains.id : null;
}

// ---------------------------------------------------------------------------
// Mapping persistence
// ---------------------------------------------------------------------------

// A CSV account maps to one OR MORE app accounts (e.g. a single 401(k) balance
// split across a Roth and a Traditional account).
export function loadAccountMap(): Record<string, string[]> {
    try {
        const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw) as Record<string, string | string[]>;
        const out: Record<string, string[]> = {};
        for (const [key, val] of Object.entries(parsed)) {
            // Back-compat: earlier versions stored a single appId string.
            out[key] = Array.isArray(val) ? val : [val];
        }
        return out;
    } catch {
        return {};
    }
}

export function saveAccountMap(map: Record<string, string[]>): void {
    try {
        localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // localStorage may be unavailable/full; mapping persistence is best-effort.
    }
}
