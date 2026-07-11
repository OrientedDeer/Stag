import { ReactNode, useMemo, useCallback } from 'react';
import { usePersistedReducer } from '../../../hooks/usePersistedReducer';
import { generateId } from '../../../utils/id';
import type { MonthlySnapshot } from './BudgetTypes';
import {
    BudgetContext,
    budgetReducer,
    initialState,
    STORAGE_KEY,
    hydrateBudgetState,
} from './BudgetContext';

export function BudgetProvider({ children }: { children: ReactNode }): React.ReactElement {
    const [state, dispatch] = usePersistedReducer(budgetReducer, initialState, {
        storageKey: STORAGE_KEY,
        hydrate: hydrateBudgetState,
    });

    const getOrCreateMonth = useCallback((month: number, year: number): MonthlySnapshot => {
        const existing = state.months.find(m => m.month === month && m.year === year);
        if (existing) return existing;

        const newMonth: MonthlySnapshot = {
            id: generateId('MONTH'),
            month,
            year,
            spending: {},
            accountBalances: {},
            contributions: {},
            transactions: [],
            reconciled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        dispatch({ type: 'ADD_MONTH', payload: newMonth });
        return newMonth;
    }, [state.months, dispatch]);

    const getCurrentMonth = useCallback((): MonthlySnapshot | undefined => {
        return state.months.find(
            m => m.month === state.selectedMonth && m.year === state.selectedYear
        );
    }, [state.months, state.selectedMonth, state.selectedYear]);

    const contextValue = useMemo(() => ({
        ...state,
        dispatch,
        getOrCreateMonth,
        getCurrentMonth,
    }), [state, dispatch, getOrCreateMonth, getCurrentMonth]);

    return (
        <BudgetContext.Provider value={contextValue}>
            {children}
        </BudgetContext.Provider>
    );
}
