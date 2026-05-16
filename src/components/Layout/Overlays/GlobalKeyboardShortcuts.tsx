import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useKeyboardShortcuts } from '../../../hooks/useKeyboardShortcuts';
import KeyboardShortcutsOverlay from './KeyboardShortcutsOverlay';

/**
 * Flat ordering of sidebar pages, top-to-bottom. Shift+↑ / Shift+↓ walks through
 * this list with wraparound.
 */
const SIDEBAR_ROUTES: readonly string[] = [
    '/dashboard',
    '/current/accounts',
    '/current/income',
    '/current/expense',
    '/current/taxes',
    '/budget',
    '/future/assumptions',
    '/future/allocation',
    '/future/withdrawal',
    '/future/charts',
    '/testing',
];

/**
 * Picks the sidebar route that matches the current pathname most closely.
 * Falls back to 0 (Dashboard) if no match.
 */
function currentSidebarIndex(pathname: string): number {
    const exact = SIDEBAR_ROUTES.indexOf(pathname);
    if (exact !== -1) return exact;
    // Match by prefix for child paths (e.g. /budget/something → /budget)
    const sorted = [...SIDEBAR_ROUTES].sort((a, b) => b.length - a.length);
    for (const route of sorted) {
        if (pathname.startsWith(route)) return SIDEBAR_ROUTES.indexOf(route);
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
    const [helpOpen, setHelpOpen] = useState(false);
    const closeHelp = useCallback(() => setHelpOpen(false), []);

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
                const idx = currentSidebarIndex(pathname);
                const nextIdx = (idx - 1 + SIDEBAR_ROUTES.length) % SIDEBAR_ROUTES.length;
                navigate(SIDEBAR_ROUTES[nextIdx]);
            },
            'Shift+ArrowDown': (e: KeyboardEvent) => {
                e.preventDefault();
                const idx = currentSidebarIndex(pathname);
                const nextIdx = (idx + 1) % SIDEBAR_ROUTES.length;
                navigate(SIDEBAR_ROUTES[nextIdx]);
            },
        };
    }, [navigate, pathname]);

    useKeyboardShortcuts(shortcuts);

    return <KeyboardShortcutsOverlay open={helpOpen} onClose={closeHelp} />;
}
