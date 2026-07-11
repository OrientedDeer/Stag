import { useEffect, useRef } from 'react';

/**
 * Custom hook that debounces localStorage writes to prevent blocking the main thread.
 *
 * Instead of writing to localStorage on every state change, this hook batches writes
 * with a configurable delay (default 500ms). This prevents long tasks warnings caused
 * by synchronous JSON.stringify and localStorage.setItem operations.
 *
 * @param key - The localStorage key to write to
 * @param value - The value to serialize and store
 * @param serializer - Function to serialize the value (default: JSON.stringify)
 * @param delay - Debounce delay in milliseconds (default: 500)
 */
export function useDebouncedLocalStorage<T>(
    key: string,
    value: T,
    serializer: (val: T) => string = JSON.stringify,
    delay: number = 500
): void {
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const valueRef = useRef<T>(value);
    const serializerRef = useRef(serializer);
    const keyRef = useRef(key);

    // Keep refs current so the debounced write and the unload/unmount flush
    // paths always serialize the latest value. Updating them in an effect
    // (rather than during render) satisfies the ref-usage rule; every consumer
    // reads these refs after commit (in a timeout, an event handler, or a
    // cleanup), so they always observe the post-commit values.
    useEffect(() => {
        valueRef.current = value;
        serializerRef.current = serializer;
        keyRef.current = key;
    });

    useEffect(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
            timeoutRef.current = null;
            try {
                localStorage.setItem(key, serializer(valueRef.current));
            } catch (e) {
                console.error(`Failed to write to localStorage key "${key}":`, e);
            }
        }, delay);

        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [key, value, serializer, delay]);

    // Flush any pending debounced write synchronously when the page is being
    // unloaded (hard reload, tab close, or backgrounding). The React unmount
    // cleanup below does NOT run on a real browser unload, so without this a
    // value changed within the debounce window would be lost.
    useEffect(() => {
        const flush = () => {
            if (timeoutRef.current === null) {
                // No pending write — nothing to flush.
                return;
            }
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
            try {
                localStorage.setItem(keyRef.current, serializerRef.current(valueRef.current));
            } catch (e) {
                console.error('Failed to flush localStorage on page unload:', e);
            }
        };

        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                flush();
            }
        };

        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', onVisibilityChange);

        return () => {
            window.removeEventListener('pagehide', flush);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, []);

    // Write immediately on unmount to ensure data is not lost
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            try {
                localStorage.setItem(keyRef.current, serializerRef.current(valueRef.current));
            } catch (e) {
                console.error('Failed to write to localStorage on unmount:', e);
            }
        };
    }, []);
}
