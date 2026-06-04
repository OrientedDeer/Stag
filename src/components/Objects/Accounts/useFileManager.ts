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
import { loadAccountMap, saveAccountMap } from '../../../services/simplefinBalances';

export interface FullBackup {
    version: number;
    accounts: any[];
    amountHistory: Record<string, AmountHistoryEntry[]>;
    incomes: any[];
    expenses: any[];
    taxSettings: TaxState;
    assumptions: AssumptionsState;
    // View state (selectedMonth/selectedYear) is intentionally excluded — it's UI
    // state, not data, so it must not be backed up or count toward dirty-detection.
    budget?: Omit<BudgetState, 'selectedMonth' | 'selectedYear'>; // Optional for backwards compatibility
    // SimpleFIN -> Stag account mapping (csvAccount -> appAccountId[]). Lives in
    // localStorage during normal use; carried in the blob so headless stag-feed
    // can read it. Optional for backwards compatibility with v1 backups.
    balanceAccountMap?: Record<string, string[]>;
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
        // Extract budget data (excluding dispatch/helpers). selectedMonth/selectedYear
        // are UI view state, not data — omit them so switching months doesn't dirty the backup.
        const { months, importSettings } = budgetContext;
        const budgetState = { months, importSettings };

        const fullBackup: FullBackup = {
            version: 2,
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
            amountHistory,
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
            taxSettings: state as TaxState,
            assumptions: assumptions as AssumptionsState,
            budget: budgetState,
            balanceAccountMap: loadAccountMap(),
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
            // Restore the SimpleFIN account mapping if present (v2+ backups)
            if (data.balanceAccountMap) {
                saveAccountMap(data.balanceAccountMap);
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
        // selectedMonth/selectedYear are UI view state — omit so month switches don't dirty the backup.
        const { months, importSettings } = budgetContext;
        const budgetState = { months, importSettings };

        return {
            version: 2,
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
            amountHistory,
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
            taxSettings: state as TaxState,
            assumptions: assumptions as AssumptionsState,
            budget: budgetState,
            balanceAccountMap: loadAccountMap(),
        };
    };

    return { handleGlobalExport, handleGlobalImport, getBackupData, importKey };
};
