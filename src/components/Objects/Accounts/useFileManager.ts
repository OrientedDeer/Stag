import { useContext } from 'react';
import { AccountContext, AccountDispatchContext } from './AccountContext';
import { IncomeContext, IncomeDispatchContext } from '../Income/IncomeContext';
import { ExpenseContext, ExpenseDispatchContext } from '../Expense/ExpenseContext';
import { TaxContext } from '../../Objects/Taxes/TaxContext';
import { AssumptionsContext, AssumptionsState, defaultAssumptions, migrateAssumptions } from '../Assumptions/AssumptionsContext';
import { AnyAccount, reconstituteAccount } from './models';
import { AmountHistoryEntry } from './AccountContext';
import { AnyIncome, reconstituteIncome } from '../Income/models';
import { AnyExpense, reconstituteExpense } from '../Expense/models';
import { linkOrphanLoanExpenses } from '../../../services/simulation/linkOrphanLoanExpenses';
import { TaxState, defaultTaxState } from '../../Objects/Taxes/TaxContext';
import { ImportKeyContext } from './ImportKeyContext';
import { BudgetContext, BudgetState, reconstituteBudgetState } from '../Budget/BudgetContext';
import { loadAccountMap, saveAccountMap } from '../../../services/simplefinBalances';
import { formatDateForInput, jsonDateReplacer } from '../../../utils/formatters';

export interface FullBackup {
    version: number;
    accounts: Array<Record<string, unknown>>;
    amountHistory: Record<string, AmountHistoryEntry[]>;
    incomes: Array<Record<string, unknown>>;
    expenses: Array<Record<string, unknown>>;
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

    const getBackupData = (): FullBackup => {
        // Extract budget data (excluding dispatch/helpers). selectedMonth/selectedYear
        // are UI view state, not data — omit them so switching months doesn't dirty the backup.
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

    const handleGlobalExport = () => {
        const fullBackup = getBackupData();

        const blob = new Blob([JSON.stringify(fullBackup, jsonDateReplacer, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Local date, not UTC (toISOString), so an evening export in a
        // negative-offset timezone isn't stamped with tomorrow's date.
        a.download = `stag_full_backup_${formatDateForInput(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleGlobalImport = (json: string) => {
        try {
            const data = JSON.parse(json);

            const reconstitutedAccounts = data.accounts.map(reconstituteAccount).filter((value: AnyAccount | null): value is AnyAccount => value !== null);
            const newIncomes = data.incomes.map(reconstituteIncome).filter((value: AnyIncome | null): value is AnyIncome => value !== null);
            const newExpenses = data.expenses.map(reconstituteExpense).filter((value: AnyExpense | null): value is AnyExpense => value !== null);

            // Orphan-loan guard (#124): net worth/total debt are sourced from accounts
            // only, so an imported MortgageExpense/LoanExpense whose linkedAccountId is
            // empty or dangling would have its balance silently dropped. Re-link each
            // orphan to a freshly created paired account so the liability lands on the
            // account side (mirrors the invariant AddExpenseModal enforces at creation).
            // Repair is silent; the helper's `notices` are available for a future
            // user-visible trace if one is wanted.
            const { accounts: newAccounts } = linkOrphanLoanExpenses(reconstitutedAccounts, newExpenses);

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
                // Route through migrateAssumptions so OLD backups (legacy
                // demographics.birthYear/retirementAge/lifeExpectancy with no
                // milestones array) get their built-in milestones synthesized, and
                // every section (including display + arrays) is deep-merged with
                // defaults — matching the on-load localStorage migration.
                const mergedAssumptions = migrateAssumptions(data.assumptions, defaultAssumptions);
                assumptionsDispatch({ type: 'SET_BULK_DATA', payload: mergedAssumptions });
            }
            else {
                assumptionsDispatch({ type: 'RESET_DEFAULTS'});
            }
            // Import budget data if present. Reconstitute Date fields (transactions'
            // date/statementDate, months' createdAt/updatedAt) since JSON.parse leaves
            // them as ISO strings — bypassing hydrateBudgetState would otherwise store
            // strings under Date-typed fields.
            if (data.budget) {
                budgetDispatch({ type: 'SET_BULK_DATA', payload: reconstituteBudgetState(data.budget) });
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

    return { handleGlobalExport, handleGlobalImport, getBackupData, importKey };
};
