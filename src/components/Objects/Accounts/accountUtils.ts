import { type AnyAccount, InvestedAccount, SavedAccount, ESPPAccount, RSUAccount } from "./models";

/**
 * Sum the account balances that make up the "withdrawal portfolio" — the
 * invested-asset set the withdrawal strategies size their budget against
 * (savings/brokerage/retirement/ESPP/RSU; excludes property and debt). Shared
 * so every consumer (the engine's strategy budget, the GK rate suggestion, …)
 * derives the implied withdrawal rate against an identical denominator.
 */
export function sumInvestedAssets(accounts: AnyAccount[]): number {
    return accounts.reduce((sum, acc) => {
        if (acc instanceof InvestedAccount || acc instanceof SavedAccount || acc instanceof ESPPAccount || acc instanceof RSUAccount) {
            return sum + acc.amount;
        }
        return sum;
    }, 0);
}
