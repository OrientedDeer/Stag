import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts';
import { AssumptionsContext } from '../../Objects/Assumptions/AssumptionsContext';
import KeyboardShortcutsOverlay from './KeyboardShortcutsOverlay';

/**
 * Flat ordering of sidebar pages, top-to-bottom. Shift+↑ / Shift+↓ walks through
 * this list with wraparound. /testing is only included when the "Developer
 * tools" display setting is on, mirroring its Sidebar entry.
 */
const SIDEBAR_ROUTES: readonly string[] = [
    '/dashboard',
    '/current/accounts',
    '/current/income',
    '/current/expense',
    '/current/taxes',
    '/budget',
    '/plan/assumptions',
    '/plan/allocation',
    '/plan/withdrawal',
    '/projection',
    '/testing',
];

/**
 * Picks the sidebar route that matches the current pathname most closely.
 * Falls back to 0 (Dashboard) if no match.
 */
function currentSidebarIndex(pathname: string, routes: readonly string[]): number {
    const exact = routes.indexOf(pathname);
    if (exact !== -1) return exact;
    // Match by prefix for child paths (e.g. /budget/something → /budget)
    const sorted = [...routes].sort((a, b) => b.length - a.length);
    for (const route of sorted) {
        if (pathname.startsWith(route)) return routes.indexOf(route);
    }
    return 0;
}

/**
 * Registers global keyboard shortcuts and renders the help overlay.
 * Mount once near the root of the app.
 */
export default function GlobalKeyboardShortcuts() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const { state: assumptions } = useContext(AssumptionsContext);
    const showDevTools = assumptions.display?.showDevTools ?? false;
    const [helpOpen, setHelpOpen] = useState(false);
    const closeHelp = useCallback(() => setHelpOpen(false), []);

    // Skip /testing when its Sidebar entry is hidden — Shift+↑/↓ should only
    // cycle through pages the user can see. The route itself stays mounted, so
    // a direct URL still works either way.
    const routes = useMemo(
        () => (showDevTools ? SIDEBAR_ROUTES : SIDEBAR_ROUTES.filter(r => r !== '/testing')),
        [showDevTools]
    );

    const shortcuts = useMemo(() => {
        const scrollMain = (dy: number) => {
            const main = document.querySelector('main');
            if (main instanceof HTMLElement) main.scrollBy({ top: dy, behavior: 'auto' });
        };
        return {
            '?': (e: KeyboardEvent) => {
                e.preventDefault();
                setHelpOpen(true);
            },
            // The app's scrollable area is <main>, not the document body, so the
            // browser's default arrow-scroll doesn't kick in. Drive it manually.
            'ArrowUp': (e: KeyboardEvent) => {
                e.preventDefault();
                scrollMain(-60);
            },
            'ArrowDown': (e: KeyboardEvent) => {
                e.preventDefault();
                scrollMain(60);
            },
            'Shift+ArrowUp': (e: KeyboardEvent) => {
                e.preventDefault();
                const idx = currentSidebarIndex(pathname, routes);
                const nextIdx = (idx - 1 + routes.length) % routes.length;
                navigate(routes[nextIdx]);
            },
            'Shift+ArrowDown': (e: KeyboardEvent) => {
                e.preventDefault();
                const idx = currentSidebarIndex(pathname, routes);
                const nextIdx = (idx + 1) % routes.length;
                navigate(routes[nextIdx]);
            },
        };
    }, [navigate, pathname, routes]);

    useKeyboardShortcuts(shortcuts);

    // On route change (and initial load), focus <main> so Tab starts inside
    // the current page's content. Sidebar nav (Shift+↑/↓) intentionally does
    // NOT focus the sidebar link — focus belongs in the page content, not in
    // the nav rail. The active sidebar item still gets aria-current="page" so
    // it's announced to screen readers and visually highlighted.
    useEffect(() => {
        const main = document.getElementById('main-content');
        if (main) main.focus({ preventScroll: true });
    }, [pathname]);

    return <KeyboardShortcutsOverlay open={helpOpen} onClose={closeHelp} />;
}
