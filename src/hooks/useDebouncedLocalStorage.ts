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

    // Update ref on every render so we always have the latest value
    valueRef.current = value;

    useEffect(() => {
        // Clear any pending write
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Schedule a new write
        timeoutRef.current = setTimeout(() => {
            try {
                const serialized = serializer(valueRef.current);
                localStorage.setItem(key, serialized);
            } catch (e) {
                console.error(`Failed to write to localStorage key "${key}":`, e);
            }
        }, delay);

        // Cleanup on unmount
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [key, value, serializer, delay]);

    // Also write immediately on unmount to ensure we don't lose data
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
            try {
                const serialized = serializer(valueRef.current);
                localStorage.setItem(key, serialized);
            } catch (e) {
                console.error(`Failed to write to localStorage on unmount:`, e);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
}
