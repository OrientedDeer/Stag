import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Consume a `?tab=` search param as a one-shot deep link into a page's
 * sub-tabs (e.g. `/current/expense?tab=Monthly` from a ReceiptToast link).
 *
 * Pages with cadence/category sub-tabs restore the last-viewed tab from
 * localStorage, so a plain route link lands wherever the user last was — a
 * receipt's "Review" link must be able to override that and select the tab
 * the new object actually appears under. The param is applied once, then
 * removed from the URL (replace, no history entry) so refresh/back behave
 * normally and the localStorage persistence takes over again.
 *
 * Unknown tab values are ignored (and still cleaned from the URL).
 */
export function useSubTabDeepLink(
    tabs: readonly string[],
    setActiveTab: (tab: string) => void,
): void {
    const [searchParams, setSearchParams] = useSearchParams();

    useEffect(() => {
        const linked = searchParams.get('tab');
        if (linked === null) return;
        if (tabs.includes(linked)) {
            setActiveTab(linked);
        }
        setSearchParams(prev => {
            const next = new URLSearchParams(prev);
            next.delete('tab');
            return next;
        }, { replace: true });
        // tabs/setActiveTab are stable per page; reacting to searchParams alone
        // makes this a pure consume-on-arrival effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchParams]);
}
