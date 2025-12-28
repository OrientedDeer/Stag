import { useContext } from 'react';
import { AccountContext } from './AccountContext';
import { IncomeContext } from '../Income/IncomeContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { TaxContext } from '../Taxes/TaxContext';
import { AssumptionsContext, AssumptionsState } from '../Assumptions/AssumptionsContext'; // Import AssumptionsContext and AssumptionsState
import { AnyAccount } from './models';
import { reconstituteAccount, AmountHistoryEntry } from './AccountContext';
import { AnyIncome } from '../Income/models';
import { reconstituteIncome } from '../Income/IncomeContext';
import { AnyExpense } from '../Expense/models';
import { reconstituteExpense } from '../Expense/ExpenseContext';
import { TaxState } from '../Taxes/TaxContext';

interface FullBackup {
    version: number;
    accounts: AnyAccount[];
    amountHistory: Record<string, AmountHistoryEntry[]>;
    incomes: AnyIncome[];
    expenses: AnyExpense[];
    taxSettings: TaxState;
    assumptions: AssumptionsState; // Add assumptions to the FullBackup interface
}

export const useFileManager = () => {
    const { accounts, amountHistory, dispatch: accountDispatch } = useContext(AccountContext);
    const { incomes, dispatch: incomeDispatch } = useContext(IncomeContext);
    const { expenses, dispatch: expenseDispatch } = useContext(ExpenseContext);
    const { state, dispatch: taxesDispatch } = useContext(TaxContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext); // Get assumptions state and dispatch

    const handleGlobalExport = () => {
        const fullBackup: FullBackup = {
            version: 1,
            // Add 'as any' to bypass the missing method check
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })) as any,
            amountHistory,
            // Add 'as any' here to fix your specific error
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })) as any,
            // Add 'as any' here as well
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })) as any,
            taxSettings: state as TaxState,
            assumptions: assumptions as AssumptionsState,
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
            taxesDispatch({ type: 'SET_BULK_DATA', payload: data.taxSettings });
            if (data.assumptions) { // Check if assumptions exist in the backup data
                assumptionsDispatch({ type: 'SET_BULK_DATA', payload: data.assumptions });
            }
            else {
                assumptionsDispatch({ type: 'RESET_DEFAULTS'});
            }
        } catch (e) {
            console.error(e);
            alert("Error importing backup. Please check file format.");
        }
    };

    return { handleGlobalExport, handleGlobalImport };
};
