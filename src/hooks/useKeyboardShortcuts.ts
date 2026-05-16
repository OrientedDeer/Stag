import { useEffect } from 'react';
import type React from 'react';

/**
 * True when focus is in something that consumes keystrokes (input, textarea,
 * select, contenteditable). Global keyboard shortcuts should bail out here.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
}

/**
 * True when Cmd/Ctrl/Alt are held. Shift is treated as part of the shortcut
 * key itself (e.g. "Shift+ArrowLeft") and is NOT considered a modifier here.
 */
export function hasModifier(e: KeyboardEvent): boolean {
    return e.metaKey || e.ctrlKey || e.altKey;
}

function shortcutKey(e: KeyboardEvent): string {
    return (e.shiftKey ? 'Shift+' : '') + e.key;
}

export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

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
 */
export function useSubTabKeyboardNav(
    tabs: readonly string[],
    activeTab: string,
    setActiveTab: (tab: string) => void
) {
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
