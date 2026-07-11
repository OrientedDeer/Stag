import { type ReactNode, useMemo } from 'react';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import {
  SimulationContext,
  simulationReducer,
  initialState,
  STORAGE_KEY,
  hydrateSimulationState,
  serializeSimulationState,
} from './SimulationContext';

export function SimulationProvider({ children }: { children: ReactNode }): React.ReactElement {
  const [state, dispatch] = usePersistedReducer(simulationReducer, initialState, {
    storageKey: STORAGE_KEY,
    hydrate: hydrateSimulationState,
    serialize: serializeSimulationState,
  });

  const contextValue = useMemo(() => ({ ...state, dispatch }), [state, dispatch]);

  return (
    <SimulationContext.Provider value={contextValue}>
      {children}
    </SimulationContext.Provider>
  );
}
