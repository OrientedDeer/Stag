import { useContext } from 'react';
import { AccountContext } from './AccountContext';
import { IncomeContext } from '../Income/IncomeContext';
import { ExpenseContext } from '../Expense/ExpenseContext';
import { TaxContext } from '../../Objects/Taxes/TaxContext';
import { AssumptionsContext, AssumptionsState, defaultAssumptions } from '../Assumptions/AssumptionsContext'; // Import AssumptionsContext and AssumptionsState
import { AnyAccount, reconstituteAccount } from './models';
import { AmountHistoryEntry } from './AccountContext';
import { AnyIncome, reconstituteIncome } from '../Income/models';
import { AnyExpense, reconstituteExpense } from '../Expense/models';
import { TaxState } from '../../Objects/Taxes/TaxContext';

interface FullBackup {
    version: number;
    accounts: any[];
    amountHistory: Record<string, AmountHistoryEntry[]>;
    incomes: any[];
    expenses: any[];
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
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
            amountHistory,
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
            taxSettings: state as TaxState,
            assumptions: assumptions as AssumptionsState, // Include assumptions in the backup
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
                    personal: { ...defaultAssumptions.personal, ...(data.assumptions.personal || {}) },
                    priorities: data.assumptions.priorities || defaultAssumptions.priorities
                };
                assumptionsDispatch({ type: 'SET_BULK_DATA', payload: mergedAssumptions });
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
