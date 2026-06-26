import { ReactElement } from 'react';
import { Link } from 'react-router-dom';

/**
 * Deep link from a missing-RSU/ESPP-account warning straight to the Accounts
 * tab's "Invested" sub-tab, where the "+ Add RSU" / "+ Add ESPP" buttons live
 * (#141). Reuses the proven `?tab=` deep-link pattern (AddExpenseModal receipt
 * toasts → useSubTabDeepLink → AccountTab) and the cross-tab `<Link>` idiom
 * (Dashboard.tsx, ReceiptToast.tsx).
 *
 * Uses the warning-* semantic tokens so it inherits the host AlertBanner's
 * themed warning color (CLAUDE.md: no raw Tailwind palette colors).
 *
 * Card-only: from inside the Add-Income modal a `<Link>` would navigate away
 * and abandon the in-progress income, so the modal warnings stay text-only —
 * matching the AddExpenseModal precedent (its in-modal warnings never link out;
 * the cross-tab link only appears in a post-submit receipt toast). See #141.
 */
export function AddStockAccountLink({ kind }: { kind: 'RSU' | 'ESPP' }): ReactElement {
    return (
        <Link
            to="/current/accounts?tab=Invested"
            className="font-medium underline text-warning-bright hover:text-warning-bright/80"
        >
            Add {kind} account
        </Link>
    );
}
