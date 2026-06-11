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

    // Update refs on every render so cleanup always has latest values
    valueRef.current = value;
    serializerRef.current = serializer;
    keyRef.current = key;

    useEffect(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        timeoutRef.current = setTimeout(() => {
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
