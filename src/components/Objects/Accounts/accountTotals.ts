import { type AnyAccount, DebtAccount, PropertyAccount } from './models';

/**
 * Canonical net-worth definition for the whole app.
 *
 * This is the single source of truth for "assets − liabilities" across every
 * surface: the Future/Overview tabs, projection-history snapshots, the Roth
 * optimizer's after-tax-wealth ruler, Monte Carlo, and the Excel export. It
 * lives here (next to the account models, provider-neutral) rather than inside a
 * tab module so a service can import it without reaching into `src/tabs`, and so
 * the definition can never fork per surface.
 *
 * Accounting rules:
 *   - DebtAccount balances are liabilities. (DeficitDebtAccount extends
 *     DebtAccount, so it's covered by the same `instanceof` branch.)
 *   - Every other account's balance is an asset.
 *   - A financed PropertyAccount additionally carries its outstanding mortgage
 *     in `loanAmount`, which is a liability. Counting only the home's value as an
 *     asset (and ignoring the mortgage) would overstate net worth by the entire
 *     outstanding principal (#195).
 */
export function getAccountTotals(accounts: AnyAccount[]): { assets: number; liabilities: number; netWorth: number } {
    let assets = 0;
    let liabilities = 0;

    for (const acc of accounts) {
        if (acc instanceof DebtAccount) {
            liabilities += acc.amount;
        } else {
            assets += acc.amount;
            // PropertyAccount has a loan that counts as liability
            if (acc instanceof PropertyAccount && acc.loanAmount) {
                liabilities += acc.loanAmount;
            }
        }
    }

    return { assets, liabilities, netWorth: assets - liabilities };
}
