import { useContext } from 'react';
import { AccountContext, AccountDispatchContext } from './AccountContext';
import { IncomeContext, IncomeDispatchContext } from '../Income/IncomeContext';
import { ExpenseContext, ExpenseDispatchContext } from '../Expense/ExpenseContext';
import { TaxContext } from '../../Objects/Taxes/TaxContext';
import { AssumptionsContext, AssumptionsState, defaultAssumptions } from '../Assumptions/AssumptionsContext';
import { AnyAccount, reconstituteAccount } from './models';
import { AmountHistoryEntry } from './AccountContext';
import { AnyIncome, reconstituteIncome } from '../Income/models';
import { AnyExpense, reconstituteExpense } from '../Expense/models';
import { TaxState, defaultTaxState } from '../../Objects/Taxes/TaxContext';
import { ImportKeyContext } from './ImportKeyContext';
import { BudgetContext, BudgetState } from '../Budget/BudgetContext';

export interface FullBackup {
    version: number;
    accounts: any[];
    amountHistory: Record<string, AmountHistoryEntry[]>;
    incomes: any[];
    expenses: any[];
    taxSettings: TaxState;
    assumptions: AssumptionsState;
    budget?: BudgetState; // Optional for backwards compatibility
}

export const useFileManager = () => {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const { incomes } = useContext(IncomeContext);
    const incomeDispatch = useContext(IncomeDispatchContext);
    const { expenses } = useContext(ExpenseContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { state, dispatch: taxesDispatch } = useContext(TaxContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
    const { importKey, incrementImportKey } = useContext(ImportKeyContext);
    const budgetContext = useContext(BudgetContext);
    const { dispatch: budgetDispatch } = budgetContext;

    const handleGlobalExport = () => {
        // Extract budget state (excluding dispatch and helper functions)
        const { months, importSettings, selectedMonth, selectedYear } = budgetContext;
        const budgetState: BudgetState = { months, importSettings, selectedMonth, selectedYear };

        const fullBackup: FullBackup = {
            version: 1,
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
            amountHistory,
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
            taxSettings: state as TaxState,
            assumptions: assumptions as AssumptionsState,
            budget: budgetState,
        };

        const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stag_full_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleGlobalImport = (json: string) => {
        try {
            const data = JSON.parse(json);

            const newAccounts = data.accounts.map(reconstituteAccount).filter(Boolean as any as (value: AnyAccount | null) => value is AnyAccount);
            const newIncomes = data.incomes.map(reconstituteIncome).filter(Boolean as any as (value: AnyIncome | null) => value is AnyIncome);
            const newExpenses = data.expenses.map(reconstituteExpense).filter(Boolean as any as (value: AnyExpense | null) => value is AnyExpense);

            accountDispatch({ type: 'SET_BULK_DATA', payload: { accounts: newAccounts, amountHistory: data.amountHistory || {} } });
            incomeDispatch({ type: 'SET_BULK_DATA', payload: { incomes: newIncomes } });
            expenseDispatch({ type: 'SET_BULK_DATA', payload: { expenses: newExpenses } });
            // Merge taxSettings with defaults to ensure all fields are present
            const mergedTaxSettings = {
                ...defaultTaxState,
                ...data.taxSettings,
            };
            taxesDispatch({ type: 'SET_BULK_DATA', payload: mergedTaxSettings });
            if (data.assumptions) { // Check if assumptions exist in the backup data
                const mergedAssumptions = {
                    ...defaultAssumptions,
                    ...data.assumptions,
                    macro: { ...defaultAssumptions.macro, ...(data.assumptions.macro || {}) },
                    income: { ...defaultAssumptions.income, ...(data.assumptions.income || {}) },
                    expenses: { ...defaultAssumptions.expenses, ...(data.assumptions.expenses || {}) },
                    investments: {
                        ...defaultAssumptions.investments,
                        ...(data.assumptions.investments || {}),
                        returnRates: {
                            ...defaultAssumptions.investments.returnRates,
                            ...((data.assumptions.investments && data.assumptions.investments.returnRates) || {}),
                        },
                    },
                    demographics: { ...defaultAssumptions.demographics, ...(data.assumptions.demographics || {}) },
                    priorities: data.assumptions.priorities || defaultAssumptions.priorities
                };
                assumptionsDispatch({ type: 'SET_BULK_DATA', payload: mergedAssumptions });
            }
            else {
                assumptionsDispatch({ type: 'RESET_DEFAULTS'});
            }
            // Import budget data if present
            if (data.budget) {
                budgetDispatch({ type: 'SET_BULK_DATA', payload: data.budget });
            }
            // Increment shared importKey to force chart remounts after import
            incrementImportKey();
            // Force page reload to ensure all components update
            //window.location.reload();
        } catch (e) {
            console.error(e);
            alert("Error importing backup. Please check file format.");
        }
    };

    const getBackupData = (): FullBackup => {
        const { months, importSettings, selectedMonth, selectedYear } = budgetContext;
        const budgetState: BudgetState = { months, importSettings, selectedMonth, selectedYear };

        return {
            version: 1,
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
            amountHistory,
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
            taxSettings: state as TaxState,
            assumptions: assumptions as AssumptionsState,
            budget: budgetState,
        };
    };

    return { handleGlobalExport, handleGlobalImport, getBackupData, importKey };
};
