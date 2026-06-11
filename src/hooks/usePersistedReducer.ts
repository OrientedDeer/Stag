import { useReducer, useCallback, Reducer, Dispatch } from 'react';
import { useDebouncedLocalStorage } from './useDebouncedLocalStorage';

/**
 * Configuration for persisted reducer
 */
export interface PersistedReducerConfig<S> {
    /** localStorage key for persistence */
    storageKey: string;
    /** Function to transform raw JSON into proper state (e.g., reconstitute classes) */
    hydrate?: (parsed: unknown, initialState: S) => S;
    /** Function to transform state into serializable format */
    serialize?: (state: S) => string;
}

/**
 * Loads state from localStorage with error handling
 */
function loadFromStorage<S>(
    storageKey: string,
    initialState: S,
    hydrate?: (parsed: unknown, initialState: S) => S
): S {
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (hydrate) {
                return hydrate(parsed, initialState);
            }
            // Default: merge parsed with initial to handle new fields
            return { ...initialState, ...parsed };
        }
    } catch (e) {
        // Silently fall back to initial state on parse errors
    }
    return initialState;
}

/**
 * A hook that combines useReducer with localStorage persistence.
 *
 * Features:
 * - Automatic loading from localStorage on initialization
 * - Debounced saving to localStorage on state changes
 * - Support for custom hydration (e.g., reconstituting class instances)
 * - Support for custom serialization (e.g., adding className fields)
 *
 * @example
 * const [state, dispatch] = usePersistedReducer(
 *     myReducer,
 *     initialState,
 *     {
 *         storageKey: 'my_data',
 *         hydrate: (parsed, initial) => ({
 *             ...initial,
 *             items: parsed.items.map(reconstituteItem).filter(Boolean)
 *         }),
 *         serialize: (state) => JSON.stringify({
 *             ...state,
 *             items: state.items.map(item => ({ ...item, className: item.constructor.name }))
 *         })
 *     }
 * );
 */
export function usePersistedReducer<S, A>(
    reducer: Reducer<S, A>,
    initialState: S,
    config: PersistedReducerConfig<S>
): [S, Dispatch<A>] {
    const { storageKey, hydrate, serialize } = config;

    // Initialize state from localStorage
    const [state, dispatch] = useReducer(
        reducer,
        initialState,
        (initial) => loadFromStorage(storageKey, initial, hydrate)
    );

    // Create serializer callback (memoized)
    const serializer = useCallback(
        (s: S) => {
            if (serialize) {
                return serialize(s);
            }
            return JSON.stringify(s);
        },
        [serialize]
    );

    // Persist to localStorage with debouncing
    useDebouncedLocalStorage(storageKey, state, serializer);

    return [state, dispatch];
}

