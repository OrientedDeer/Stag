/**
 * Shared unique-id minting for prefixed entity ids (e.g. 'MONTH-...', 'TXN-...').
 * Single source of truth — BudgetContext, CSVImportService, and backupMerge all
 * mint through here so their id semantics can't drift apart.
 */

// Monotonic counter so several ids minted in the same synchronous tick never
// collide when crypto.randomUUID is unavailable (Date.now() has ms resolution).
let idCounter = 0;

/**
 * Mint a unique id of the form `${prefix}-...`. Uses crypto.randomUUID() when
 * available (jsdom/node/browsers all support it); otherwise falls back to
 * timestamp + module-monotonic counter + random suffix, which stays unique even
 * within a single synchronous loop over hundreds of rows.
 */
export function generateId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${idCounter++}-${Math.floor(Math.random() * 1000)}`;
}
