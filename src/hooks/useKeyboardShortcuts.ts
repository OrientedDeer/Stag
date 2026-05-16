import { useEffect, useRef } from 'react';
import type React from 'react';

// Input types that don't accept text — arrows on them are navigation/toggle,
// not cursor movement, so they shouldn't suppress global keyboard shortcuts.
const NON_TYPING_INPUT_TYPES = new Set([
    'range', 'checkbox', 'radio', 'button', 'submit', 'reset',
    'file', 'color', 'image',
]);

/**
 * True when focus is in something that consumes keystrokes for text input —
 * `<textarea>`, `<select>`, contenteditable, and `<input>` types that accept
 * text (text/email/password/number/date/etc.). Range sliders, checkboxes, and
 * radios are NOT considered typing targets: their arrow keys are navigation,
 * not text editing, so global Shift+arrow shortcuts can still fire from them.
 */
function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        const type = (target as HTMLInputElement).type;
        return !NON_TYPING_INPUT_TYPES.has(type);
    }
    if (target.isContentEditable) return true;
    return false;
}

/**
 * True when Cmd/Ctrl/Alt are held. Shift is treated as part of the shortcut
 * key itself (e.g. "Shift+ArrowLeft") and is NOT considered a modifier here.
 */
function hasModifier(e: KeyboardEvent): boolean {
    return e.metaKey || e.ctrlKey || e.altKey;
}

function shortcutKey(e: KeyboardEvent): string {
    return (e.shiftKey ? 'Shift+' : '') + e.key;
}

type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

interface UseKeyboardShortcutsOptions {
    enabled?: boolean;
    allowInInputs?: boolean;
    allowModifiers?: boolean;
}

/**
 * Register a flat map of shortcuts on `window`. Keys may include "Shift+"
 * prefix for shift-modified shortcuts; Cmd/Ctrl/Alt combos are not supported
 * here (they belong to the browser/OS unless allowModifiers is set).
 *
 * The `shortcuts` map identity is used as a dep — memoize it (useMemo) if you
 * want a stable listener.
 */
export function useKeyboardShortcuts(
    shortcuts: ShortcutMap,
    options: UseKeyboardShortcutsOptions = {}
) {
    const { enabled = true, allowInInputs = false, allowModifiers = false } = options;
    useEffect(() => {
        if (!enabled) return;
        const handler = (e: KeyboardEvent) => {
            if (!allowInInputs && isTypingTarget(e.target)) return;
            if (!allowModifiers && hasModifier(e)) return;
            const fn = shortcuts[shortcutKey(e)];
            if (fn) fn(e);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [shortcuts, enabled, allowInInputs, allowModifiers]);
}

/**
 * Plain ←/→ adjusts a slider value. For a dual-value (range) slider, only the
 * upper bound (end node) moves — matching the "scrub the end year" UX on chart
 * tabs. Visibility-gated via `containerRef` so multiple hidden sub-tabs don't
 * all fight for the same keystroke.
 */
export function useArrowKeyAdjust(
    value: number | [number, number],
    onChange: (v: number | [number, number]) => void,
    options: {
        min: number;
        max: number;
        step?: number;
        enabled?: boolean;
        containerRef?: React.RefObject<HTMLElement | null>;
    }
) {
    const { min, max, step = 1, enabled = true, containerRef } = options;
    useEffect(() => {
        if (!enabled) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.shiftKey) return;
            if (hasModifier(e)) return;
            if (isTypingTarget(e.target)) return;
            if (containerRef && containerRef.current && containerRef.current.offsetParent === null) return;

            e.preventDefault();
            const delta = e.key === 'ArrowLeft' ? -step : step;
            if (Array.isArray(value)) {
                const newEnd = Math.max(value[0] + step, Math.min(max, value[1] + delta));
                onChange([value[0], newEnd]);
            } else {
                const newVal = Math.max(min, Math.min(max, value + delta));
                onChange(newVal);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [value, onChange, min, max, step, enabled, containerRef]);
}

/**
 * Wire Shift+← / Shift+→ to cycle through a list of sub-tabs (with wraparound).
 * Plain ←/→ remain free for within-tab use (e.g. month navigation in Budget).
 *
 * After ANY tab change (keyboard or mouse click), focus moves into the new
 * tab's content — landing on the first visible focusable element. Without
 * this, clicking a tab leaves focus on the tab button itself, and plain
 * arrow keys end up scrolling the overflow-x-auto tab bar horizontally
 * instead of doing something useful in the new tab.
 *
 * Initial mount is skipped via a previous-value ref so we don't steal focus
 * on page load.
 */
export function useSubTabKeyboardNav(
    tabs: readonly string[],
    activeTab: string,
    setActiveTab: (tab: string) => void
) {
    const prevActiveTabRef = useRef(activeTab);

    useEffect(() => {
        // Only fire when activeTab actually changes (skips initial mount and
        // React strict-mode double-invoke, since both leave the ref unchanged).
        if (prevActiveTabRef.current === activeTab) return;
        prevActiveTabRef.current = activeTab;
        // Find the visible sub-tab content container.
        let container: HTMLElement | null = null;
        const candidates = document.querySelectorAll<HTMLElement>('[data-sub-tab-content]');
        for (const el of Array.from(candidates)) {
            if (el.offsetParent !== null) {
                container = el;
                break;
            }
        }
        if (!container) container = document.getElementById('main-content');
        if (!container) return;

        const isVisible = (el: HTMLElement): boolean => {
            if (el.offsetParent === null) return false;
            const cs = window.getComputedStyle(el);
            return cs.opacity !== '0' && cs.visibility !== 'hidden';
        };

        // Preferred target: the first ExpandableCard toggle (button[aria-expanded]).
        // Matches the "first card" on Account/Income/Expense list pages.
        const expandButtons = container.querySelectorAll<HTMLElement>('button[aria-expanded]');
        for (const el of Array.from(expandButtons)) {
            if (isVisible(el)) {
                el.focus({ preventScroll: true });
                return;
            }
        }

        // Fallback: any real form control or link.
        const focusables = container.querySelectorAll<HTMLElement>(
            'button:not([role="tab"]), input, select, textarea, a[href]'
        );
        for (const el of Array.from(focusables)) {
            if (!isVisible(el)) continue;
            el.focus({ preventScroll: true });
            return;
        }
    }, [activeTab]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (!e.shiftKey) return;
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (hasModifier(e)) return;
            if (isTypingTarget(e.target)) return;
            const idx = tabs.indexOf(activeTab);
            if (idx === -1) return;
            e.preventDefault();
            const nextIdx = e.key === 'ArrowLeft'
                ? (idx - 1 + tabs.length) % tabs.length
                : (idx + 1) % tabs.length;
            setActiveTab(tabs[nextIdx]);
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [tabs, activeTab, setActiveTab]);
}
