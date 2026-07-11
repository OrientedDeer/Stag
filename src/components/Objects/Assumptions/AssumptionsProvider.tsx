/* @refresh reset - the provider holds reducer state, so full remount on HMR is needed */
import { useReducer, type ReactNode, useMemo } from 'react';
import { useDebouncedLocalStorage } from '../../../hooks/useDebouncedLocalStorage';
import {
  AssumptionsContext,
  assumptionsReducer,
  defaultAssumptions,
  migrateAssumptions,
} from './AssumptionsContext';

export const AssumptionsProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(assumptionsReducer, defaultAssumptions, (initial) => {
    const saved = localStorage.getItem('assumptions_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Deep merge with defaults to handle missing fields from older versions
        return migrateAssumptions(parsed, initial);
      } catch {
        // JSON parse failed - return defaults
        return initial;
      }
    }
    return initial;
  });

  // Debounced localStorage persistence (500ms delay to prevent main thread blocking)
  useDebouncedLocalStorage('assumptions_settings', state);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    state,
    dispatch
  }), [state, dispatch]);

  return <AssumptionsContext.Provider value={contextValue}>{children}</AssumptionsContext.Provider>;
};
