import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDebouncedLocalStorage } from '../../hooks/useDebouncedLocalStorage';

describe('useDebouncedLocalStorage', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.clear();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('debounces the write (nothing until the timer fires)', () => {
        const key = 'test-key';
        const { rerender } = renderHook(
            ({ value }) => useDebouncedLocalStorage(key, value),
            { initialProps: { value: { a: 1 } } },
        );

        rerender({ value: { a: 2 } });
        // Before the debounce window elapses, nothing has been written.
        expect(localStorage.getItem(key)).toBeNull();

        vi.advanceTimersByTime(500);
        expect(localStorage.getItem(key)).toBe(JSON.stringify({ a: 2 }));
    });

    it('flushes the pending write on pagehide (hard reload / tab close) before the timer fires', () => {
        const key = 'pagehide-key';
        const { rerender } = renderHook(
            ({ value }) => useDebouncedLocalStorage(key, value),
            { initialProps: { value: { a: 1 } } },
        );

        rerender({ value: { a: 2 } });

        // Simulate a hard page unload BEFORE the 500ms debounce timer fires.
        // The unmount-flush effect does NOT run on a real browser unload, so a
        // pagehide handler must flush the latest value synchronously.
        window.dispatchEvent(new Event('pagehide'));

        expect(localStorage.getItem(key)).toBe(JSON.stringify({ a: 2 }));
    });

    it('removes the pagehide listener on unmount (no leak / no stale write)', () => {
        const key = 'cleanup-key';
        const addSpy = vi.spyOn(window, 'addEventListener');
        const removeSpy = vi.spyOn(window, 'removeEventListener');

        const { unmount } = renderHook(
            ({ value }) => useDebouncedLocalStorage(key, value),
            { initialProps: { value: { a: 1 } } },
        );

        const pagehideAdds = addSpy.mock.calls.filter(c => c[0] === 'pagehide').length;
        expect(pagehideAdds).toBeGreaterThan(0);

        unmount();

        const pagehideRemoves = removeSpy.mock.calls.filter(c => c[0] === 'pagehide').length;
        expect(pagehideRemoves).toBe(pagehideAdds);

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });
});
