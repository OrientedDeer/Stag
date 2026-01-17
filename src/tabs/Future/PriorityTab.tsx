import { useState, useContext, useMemo, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, PriorityBucket, CapType } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AnyAccount, InvestedAccount } from '../../components/Objects/Accounts/models';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { calculateFederalTax, calculateStateTax, calculateFicaTax } from '../../components/Objects/Taxes/TaxService';
import { WorkIncome } from '../../components/Objects/Income/models';
import { formatCompactCurrency } from './tabs/FutureUtils';
import { get401kLimit, getIRALimit, getHSALimit } from '../../data/ContributionLimits';

// UI Components
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { NameInput } from '../../components/Layout/InputFields/NameInput';
import { NumberInput } from '../../components/Layout/InputFields/NumberInput';

// Chevron icon for expand/collapse
const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
    <svg
        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
    >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
);

export default function PriorityTab() {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);

    const year = new Date().getFullYear();
    const forceExact = state.display?.useCompactCurrency === false;

    // Currency formatter
    const formatMoney = useCallback((amount: number) =>
        formatCompactCurrency(amount, { forceExact }), [forceExact]);

    // Filter accounts for allocation - exclude 401k (those are managed via payroll deductions on Income card)
    const allocatableAccounts = useMemo(() => {
        return accounts.filter(acc => {
            if (acc instanceof InvestedAccount) {
                return acc.taxType !== 'Traditional 401k' && acc.taxType !== 'Roth 401k';
            }
            return true; // Include non-invested accounts (savings, etc.)
        });
    }, [accounts]);

    // ========== CALCULATIONS ==========

    const totalMonthlyIncome = useMemo(() =>
        incomes.reduce((sum, inc) => sum + (inc.getMonthlyAmount(year)), 0),
    [incomes, year]);

    const totalMonthlyFixedExpenses = useMemo(() =>
        expenses.reduce((sum, exp) => sum + (exp.getMonthlyAmount(year)), 0),
    [expenses, year]);

    // Tax calculations (monthly)
    const federalTax = useMemo(() => calculateFederalTax(taxState, incomes, expenses, year) / 12, [taxState, incomes, expenses, year]);
    const stateTax = useMemo(() => calculateStateTax(taxState, incomes, expenses, year) / 12, [taxState, incomes, expenses, year]);
    const ficaTax = useMemo(() => calculateFicaTax(taxState, incomes, year) / 12, [taxState, incomes, year]);
    const monthlyTaxes = federalTax + stateTax + ficaTax;

    // Paycheck deductions (401k, insurance, HSA)
    const deductionBreakdown = useMemo(() => {
        let pretax401k = 0;
        let roth401k = 0;
        let insurance = 0;
        let hsa = 0;

        incomes.forEach(inc => {
            if (inc instanceof WorkIncome) {
                pretax401k += inc.getProratedMonthly(inc.preTax401k, year);
                roth401k += inc.getProratedMonthly(inc.roth401k, year);
                insurance += inc.getProratedMonthly(inc.insurance, year);
                hsa += inc.getProratedMonthly(inc.hsaContribution || 0, year);
            }
        });

        return { pretax401k, roth401k, insurance, hsa, total: pretax401k + roth401k + insurance + hsa };
    }, [incomes, year]);

    const monthlyPaycheckDeductions = deductionBreakdown.total;

    // Take-home calculation
    const totalWithheld = monthlyTaxes + monthlyPaycheckDeductions;
    const takeHome = totalMonthlyIncome - totalWithheld;
    const disposableAfterExpenses = takeHome - totalMonthlyFixedExpenses;

    // ========== CONTRIBUTION LIMITS ==========

    const getAccountContributionLimit = useCallback((account: AnyAccount): number | null => {
        if (!(account instanceof InvestedAccount)) return null;
        const age = year - state.demographics.birthYear;

        switch (account.taxType) {
            case 'Traditional 401k':
            case 'Roth 401k':
                return get401kLimit(year, age);
            case 'Traditional IRA':
            case 'Roth IRA':
                return getIRALimit(year, age);
            case 'HSA':
                return getHSALimit(year, age, 'individual');
            default:
                return null;
        }
    }, [year, state.demographics.birthYear]);

    // Priority warnings for exceeding IRS limits
    const priorityWarnings = useMemo(() => {
        const warnings: Record<string, { message: string; annual: number; limit: number }> = {};

        state.priorities.forEach(item => {
            if (item.capType !== 'FIXED' && item.capType !== 'MAX') return;
            if (!item.accountId) return;

            const account = accounts.find(a => a.id === item.accountId);
            if (!account) return;

            const limit = getAccountContributionLimit(account);
            if (limit === null) return;

            let annualAmount = 0;
            if (item.capType === 'FIXED') {
                annualAmount = (item.capValue || 0) * 12;
            } else if (item.capType === 'MAX') {
                annualAmount = item.capValue || 0;
            }

            if (annualAmount > limit) {
                const accountType = (account as InvestedAccount).taxType;
                warnings[item.id] = {
                    message: `Exceeds ${year} ${accountType} limit`,
                    annual: annualAmount,
                    limit: limit
                };
            }
        });

        return warnings;
    }, [state.priorities, accounts, year, getAccountContributionLimit]);

    // ========== UI STATE ==========

    const [showHelp, setShowHelp] = useState(false);
    const [showPaycheckDetails, setShowPaycheckDetails] = useState(false);
    const [showExpenseDetails, setShowExpenseDetails] = useState(false);
    const [showAddForm, setShowAddForm] = useState(false);

    // Add form state
    const [newName, setNewName] = useState('');
    const [newAccount, setNewAccount] = useState<AnyAccount | null>(null);
    const [newCapType, setNewCapType] = useState<CapType>('MAX');
    const [newCapValue, setNewCapValue] = useState<number>(0);

    // Edit state
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editAccountId, setEditAccountId] = useState<string>('');
    const [editCapType, setEditCapType] = useState<CapType>('MAX');
    const [editCapValue, setEditCapValue] = useState<number>(0);

    // Account limit helpers
    const newAccountLimit = newAccount ? getAccountContributionLimit(newAccount) : null;
    const newAccountHasLimit = newAccountLimit !== null;
    const editAccount = accounts.find(a => a.id === editAccountId);
    const editAccountLimit = editAccount ? getAccountContributionLimit(editAccount) : null;
    const editAccountHasLimit = editAccountLimit !== null;

    // ========== HANDLERS ==========

    const handleAccountChange = useCallback((accountId: string) => {
        const selectedAccount = accounts.find(a => a.id === accountId) || null;
        setNewAccount(selectedAccount);

        if (newCapType === 'MAX' && selectedAccount) {
            const limit = getAccountContributionLimit(selectedAccount);
            if (limit !== null) setNewCapValue(limit);
        }
    }, [accounts, newCapType, getAccountContributionLimit]);

    const handleCapTypeChange = useCallback((capType: CapType) => {
        setNewCapType(capType);

        if (capType === 'MAX' && newAccount) {
            const limit = getAccountContributionLimit(newAccount);
            if (limit !== null) {
                setNewCapValue(limit);
            } else {
                setNewCapValue(0);
            }
        } else {
            setNewCapValue(0);
        }
    }, [newAccount, getAccountContributionLimit]);

    const handleAdd = () => {
        if (!newAccount) return;

        let finalName = newName;
        if (!finalName) {
            // Use friendly labels for cap types in default name
            const capTypeLabels: Record<CapType, string> = {
                'MAX': 'Max Out',
                'FIXED': 'Fixed',
                'REMAINDER': 'Remainder',
                'MULTIPLE_OF_EXPENSES': 'Emergency Fund'
            };
            finalName = `${newAccount.name} (${capTypeLabels[newCapType]})`;
        }

        let finalCapValue = newCapValue;
        if (newCapType === 'MAX' && newAccountHasLimit) {
            finalCapValue = newAccountLimit;
        }

        const newBucket: PriorityBucket = {
            id: `bucket-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            name: finalName,
            type: 'INVESTMENT',
            accountId: newAccount.id,
            capType: newCapType,
            capValue: finalCapValue
        };

        dispatch({ type: 'ADD_PRIORITY', payload: newBucket });
        setNewName('');
        setNewCapType('MAX');
        setNewCapValue(0);
        setNewAccount(null);
        setShowAddForm(false);
    };

    const handleStartEdit = (item: PriorityBucket) => {
        setEditingId(item.id);
        setEditName(item.name);
        setEditAccountId(item.accountId || '');
        setEditCapType(item.capType);
        setEditCapValue(item.capValue || 0);
    };

    const handleEditCapTypeChange = useCallback((capType: CapType) => {
        setEditCapType(capType);

        if (capType === 'MAX' && editAccount) {
            const limit = getAccountContributionLimit(editAccount);
            if (limit !== null) {
                setEditCapValue(limit);
            } else {
                setEditCapValue(0);
            }
        }
    }, [editAccount, getAccountContributionLimit]);

    const handleEditAccountChange = useCallback((accountId: string) => {
        setEditAccountId(accountId);

        if (editCapType === 'MAX') {
            const account = accounts.find(a => a.id === accountId);
            if (account) {
                const limit = getAccountContributionLimit(account);
                if (limit !== null) setEditCapValue(limit);
            }
        }
    }, [accounts, editCapType, getAccountContributionLimit]);

    const handleSaveEdit = () => {
        if (!editingId) return;

        const updatedPriority = state.priorities.find(p => p.id === editingId);
        if (!updatedPriority) return;

        let finalCapValue = editCapValue;
        if (editCapType === 'MAX' && editAccountHasLimit && editAccountLimit !== null) {
            finalCapValue = editAccountLimit;
        }

        const updated: PriorityBucket = {
            ...updatedPriority,
            name: editName,
            accountId: editAccountId,
            capType: editCapType,
            capValue: finalCapValue
        };

        dispatch({ type: 'UPDATE_PRIORITY', payload: updated });
        setEditingId(null);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
    };

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        const items = Array.from(state.priorities);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        dispatch({ type: 'SET_PRIORITIES', payload: items });
    };

    // ========== WATERFALL CALCULATION ==========

    const waterfallItems = useMemo(() => {
        let currentRemaining = disposableAfterExpenses;

        return state.priorities.map(item => {
            let cost = 0;
            let displayInfo = "";

            switch (item.capType) {
                case 'FIXED':
                    cost = item.capValue || 0;
                    displayInfo = `Fixed Amount`;
                    break;
                case 'REMAINDER':
                    cost = currentRemaining;
                    displayInfo = `Everything Remaining`;
                    break;
                case 'MULTIPLE_OF_EXPENSES': {
                    const targetAccount = accounts.find(a => a.id === item.accountId);
                    const targetAmount = (item.capValue || 0) * totalMonthlyFixedExpenses;

                    if (targetAccount) {
                        const currentBalance = targetAccount.amount;
                        cost = Math.max(0, targetAmount - currentBalance);
                        displayInfo = `${item.capValue}x Expenses (Target: ${formatMoney(targetAmount)} - Current: ${formatMoney(currentBalance)})`;
                    } else {
                        cost = 0;
                        displayInfo = `${item.capValue}x Expenses (No Account Linked)`;
                    }
                    break;
                }
                case 'MAX': {
                    const annualLimit = item.capValue || 23000;
                    const monthlyLimit = annualLimit / 12;
                    cost = Math.max(0, monthlyLimit);
                    displayInfo = `Max Out (Annual Limit: ${formatMoney(annualLimit)})`;
                    break;
                }
            }

            const actualDed = Math.min(cost, Math.max(0, currentRemaining));
            currentRemaining -= actualDed;

            return {
                ...item,
                actualDed,
                remainingAfter: currentRemaining,
                displayInfo
            };
        });
    }, [state.priorities, disposableAfterExpenses, totalMonthlyFixedExpenses, accounts, formatMoney]);

    const finalRemaining = waterfallItems.length > 0
        ? waterfallItems[waterfallItems.length - 1].remainingAfter
        : disposableAfterExpenses;

    // ========== RENDER ==========

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 pb-24 text-white">
            <div className="w-full px-4 sm:px-8 max-w-4xl">

                {/* Header */}
                <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-2">
                    <h2 className="text-2xl font-bold">Paycheck Allocator</h2>
                    <button
                        onClick={() => setShowHelp(!showHelp)}
                        className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {showHelp ? 'Hide help' : 'How this works'}
                    </button>
                </div>

                {/* Help Section */}
                {showHelp && (
                    <div className="mb-6 bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 text-sm">
                        <h3 className="font-semibold text-blue-300 mb-2">How the Paycheck Allocator Works</h3>
                        <p className="text-gray-300 mb-3">
                            This page shows where your money goes each month. After taxes, deductions, and expenses are taken out,
                            you decide how to allocate the rest through your <strong>priorities</strong>.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div className="space-y-2">
                                <h4 className="font-semibold text-gray-200">Priority Types:</h4>
                                <ul className="text-gray-400 space-y-1">
                                    <li><span className="text-white">Max Out</span> - Fill to IRS annual limit (IRA, HSA)</li>
                                    <li><span className="text-white">Fixed</span> - Contribute set amount monthly</li>
                                    <li><span className="text-white">Emergency Fund</span> - Build to X months of expenses</li>
                                    <li><span className="text-white">Everything Remaining</span> - Catch-all for leftover</li>
                                </ul>
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-semibold text-gray-200">Tips:</h4>
                                <ul className="text-gray-400 space-y-1">
                                    <li>Drag priorities to reorder - higher = funded first</li>
                                    <li>Add a "Remainder" bucket so unallocated money is saved</li>
                                    <li>401k contributions are managed on the Income page (payroll deductions)</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* Paycheck Summary (Collapsible) */}
                <div className="mb-4">
                    <button
                        onClick={() => setShowPaycheckDetails(!showPaycheckDetails)}
                        aria-expanded={showPaycheckDetails}
                        className="w-full flex items-center justify-between p-4 bg-[#18181b] rounded-xl border border-gray-800 hover:border-gray-700 transition-colors"
                    >
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <span className="uppercase tracking-wide font-semibold">Monthly Take-Home</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-green-400 font-mono">{formatMoney(totalMonthlyIncome)}</span>
                                <span className="text-gray-500">gross</span>
                                <span className="text-gray-600">→</span>
                                <span className="text-red-400 font-mono">-{formatMoney(totalWithheld)}</span>
                                <span className="text-gray-500">withheld</span>
                                <span className="text-gray-600">→</span>
                                <span className="text-white font-bold font-mono">{formatMoney(takeHome)}</span>
                            </div>
                            <ChevronIcon expanded={showPaycheckDetails} />
                        </div>
                    </button>

                    {showPaycheckDetails && (
                        <div className="mt-2 p-4 bg-gray-900/50 rounded-xl border border-gray-800 space-y-2 text-sm">
                            <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">Withholding Breakdown</div>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                <div className="flex justify-between">
                                    <span className="text-gray-400">Federal Tax</span>
                                    <span className="text-red-300 font-mono">-{formatMoney(federalTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">State Tax</span>
                                    <span className="text-red-300 font-mono">-{formatMoney(stateTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-gray-400">FICA (SS + Medicare)</span>
                                    <span className="text-red-300 font-mono">-{formatMoney(ficaTax)}</span>
                                </div>
                                {deductionBreakdown.pretax401k > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Pre-tax 401k</span>
                                        <span className="text-blue-300 font-mono">-{formatMoney(deductionBreakdown.pretax401k)}</span>
                                    </div>
                                )}
                                {deductionBreakdown.roth401k > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Roth 401k</span>
                                        <span className="text-blue-300 font-mono">-{formatMoney(deductionBreakdown.roth401k)}</span>
                                    </div>
                                )}
                                {deductionBreakdown.insurance > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">Health Insurance</span>
                                        <span className="text-blue-300 font-mono">-{formatMoney(deductionBreakdown.insurance)}</span>
                                    </div>
                                )}
                                {deductionBreakdown.hsa > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-400">HSA</span>
                                        <span className="text-blue-300 font-mono">-{formatMoney(deductionBreakdown.hsa)}</span>
                                    </div>
                                )}
                            </div>
                            <div className="border-t border-gray-700 pt-2 mt-2 flex justify-between font-semibold">
                                <span className="text-gray-300">Total Withheld</span>
                                <span className="text-red-400 font-mono">-{formatMoney(totalWithheld)}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Main Allocation Section */}
                <div className="mb-2">
                    <h3 className="text-lg font-semibold text-white mb-4">
                        Allocate Your <span className="text-green-400">{formatMoney(takeHome)}</span>
                    </h3>

                    {/* Expenses Summary (Collapsible) */}
                    {expenses.length > 0 && (
                        <div className="mb-4">
                            <button
                                onClick={() => setShowExpenseDetails(!showExpenseDetails)}
                                aria-expanded={showExpenseDetails}
                                className="w-full flex items-center justify-between p-3 bg-gray-900/50 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors"
                            >
                                <span className="text-gray-300 font-medium">Committed Expenses</span>
                                <div className="flex items-center gap-3">
                                    <span className="text-red-300 font-mono">-{formatMoney(totalMonthlyFixedExpenses)}</span>
                                    <ChevronIcon expanded={showExpenseDetails} />
                                </div>
                            </button>

                            {showExpenseDetails && (
                                <div className="mt-2 p-3 bg-gray-900/30 rounded-xl border border-gray-800 space-y-1 text-sm">
                                    {expenses.map(exp => (
                                        <div key={exp.id} className="flex justify-between py-1">
                                            <span className="text-gray-400">{exp.name}</span>
                                            <span className="text-red-300 font-mono">-{formatMoney(exp.getMonthlyAmount(year))}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Available for Priorities */}
                    <div className="flex justify-between items-center mb-4 px-1">
                        <span className="text-sm text-gray-400">Available for priorities</span>
                        <span className="text-green-400 font-mono font-semibold">{formatMoney(disposableAfterExpenses)}</span>
                    </div>

                    {/* Priorities Section */}
                    <div className="bg-[#18181b] rounded-xl border border-gray-800 p-4">
                        <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Your Priorities</h4>

                        <DragDropContext onDragEnd={onDragEnd}>
                            <Droppable droppableId="priorities-list">
                                {(provided) => (
                                    <div {...provided.droppableProps} ref={provided.innerRef} className="space-y-2">
                                        {waterfallItems.map((item, index) => (
                                            <Draggable key={item.id} draggableId={item.id} index={index}>
                                                {(provided, snapshot) => (
                                                    <div
                                                        ref={provided.innerRef}
                                                        {...provided.draggableProps}
                                                        style={provided.draggableProps.style}
                                                        className={snapshot.isDragging ? 'z-50' : ''}
                                                    >
                                                        <div className={`rounded-lg border px-3 py-2 ${
                                                            snapshot.isDragging
                                                            ? 'bg-gray-800 border-green-500 shadow-2xl'
                                                            : 'bg-gray-900 border-gray-700 hover:border-gray-600'
                                                        }`}>
                                                            {editingId === item.id ? (
                                                                /* Edit Mode */
                                                                <div className="space-y-3 py-2">
                                                                    <NameInput
                                                                        id={`edit-name-${item.id}`}
                                                                        label="Name"
                                                                        value={editName}
                                                                        onChange={setEditName}
                                                                    />
                                                                    <DropdownInput
                                                                        id={`edit-account-${item.id}`}
                                                                        label="Destination Account"
                                                                        value={editAccountId}
                                                                        onChange={handleEditAccountChange}
                                                                        options={allocatableAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                                                    />
                                                                    <div className="grid grid-cols-2 gap-3">
                                                                        <DropdownInput
                                                                            id={`edit-type-${item.id}`}
                                                                            label="Type"
                                                                            value={editCapType}
                                                                            onChange={(val) => handleEditCapTypeChange(val as CapType)}
                                                                            options={[
                                                                                { value: 'MAX', label: 'Max Out (Annual)' },
                                                                                { value: 'FIXED', label: 'Fixed (Monthly)' },
                                                                                { value: 'MULTIPLE_OF_EXPENSES', label: 'Emergency Fund' },
                                                                                { value: 'REMAINDER', label: 'Everything Remaining' }
                                                                            ]}
                                                                        />
                                                                        {editCapType === 'FIXED' && (
                                                                            <CurrencyInput
                                                                                id={`edit-value-${item.id}`}
                                                                                label="Monthly Amount"
                                                                                value={editCapValue}
                                                                                onChange={setEditCapValue}
                                                                            />
                                                                        )}
                                                                        {editCapType === 'MAX' && (
                                                                            <CurrencyInput
                                                                                id={`edit-value-${item.id}`}
                                                                                label="Annual Limit"
                                                                                value={editAccountHasLimit && editAccountLimit !== null ? editAccountLimit : editCapValue}
                                                                                onChange={editAccountHasLimit ? () => {} : setEditCapValue}
                                                                                disabled={editAccountHasLimit}
                                                                            />
                                                                        )}
                                                                        {editCapType === 'MULTIPLE_OF_EXPENSES' && (
                                                                            <NumberInput
                                                                                id={`edit-value-${item.id}`}
                                                                                label="Months"
                                                                                value={editCapValue}
                                                                                onChange={setEditCapValue}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex gap-2 justify-end pt-2">
                                                                        <button
                                                                            onClick={handleCancelEdit}
                                                                            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                                                        >
                                                                            Cancel
                                                                        </button>
                                                                        <button
                                                                            onClick={handleSaveEdit}
                                                                            className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                                                                        >
                                                                            Save
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                /* View Mode */
                                                                <div className="flex items-center">
                                                                    <div {...provided.dragHandleProps} className="mr-3 cursor-grab text-gray-500 hover:text-white shrink-0">
                                                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                            <line x1="8" y1="6" x2="21" y2="6"></line>
                                                                            <line x1="8" y1="12" x2="21" y2="12"></line>
                                                                            <line x1="8" y1="18" x2="21" y2="18"></line>
                                                                            <line x1="3" y1="6" x2="3.01" y2="6"></line>
                                                                            <line x1="3" y1="12" x2="3.01" y2="12"></line>
                                                                            <line x1="3" y1="18" x2="3.01" y2="18"></line>
                                                                        </svg>
                                                                    </div>

                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="font-medium text-gray-200 truncate">{item.name}</div>
                                                                        <div className="text-xs text-blue-400 truncate">{item.displayInfo}</div>
                                                                        {priorityWarnings[item.id] && (
                                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                                <svg className="w-3 h-3 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                                                </svg>
                                                                                <span className="text-xs text-amber-400">
                                                                                    {priorityWarnings[item.id].message}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <div className="flex flex-col items-end shrink-0 mx-3">
                                                                        <span className="text-blue-300 font-mono text-sm">-{formatMoney(item.actualDed)}</span>
                                                                        <span className={`text-xs ${item.remainingAfter < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                                                                            {formatMoney(item.remainingAfter)} left
                                                                        </span>
                                                                    </div>

                                                                    <div className="flex gap-1 shrink-0">
                                                                        <button
                                                                            onClick={() => handleStartEdit(item)}
                                                                            className="text-gray-500 hover:text-blue-400 p-1.5 hover:bg-blue-500/10 rounded transition-colors"
                                                                            title="Edit"
                                                                        >
                                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                                                            </svg>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => dispatch({type: 'REMOVE_PRIORITY', payload: item.id})}
                                                                            className="text-gray-500 hover:text-red-400 p-1.5 hover:bg-red-500/10 rounded transition-colors"
                                                                            title="Delete"
                                                                        >
                                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                <path d="M18 6L6 18M6 6l12 12"></path>
                                                                            </svg>
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </Draggable>
                                        ))}
                                        {provided.placeholder}
                                    </div>
                                )}
                            </Droppable>
                        </DragDropContext>

                        {/* Empty State */}
                        {waterfallItems.length === 0 && !showAddForm && (
                            <div className="text-center py-6 text-gray-500">
                                <p className="mb-2">No priorities set up yet</p>
                                <p className="text-xs text-gray-600">Add priorities to control where your money goes</p>
                            </div>
                        )}

                        {/* Inline Add Form */}
                        {showAddForm ? (
                            <div className="mt-3 p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-3">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-semibold text-gray-300">Add Priority</span>
                                    <button
                                        onClick={() => setShowAddForm(false)}
                                        className="text-gray-500 hover:text-white"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 6L6 18M6 6l12 12"></path>
                                        </svg>
                                    </button>
                                </div>
                                <NameInput
                                    id="new-bucket-name"
                                    label="Description (Optional)"
                                    value={newName}
                                    onChange={setNewName}
                                    placeholder="e.g. Max out Roth IRA"
                                />
                                <DropdownInput
                                    id="new-bucket-account"
                                    label="Destination Account"
                                    value={newAccount?.id ?? ''}
                                    onChange={handleAccountChange}
                                    options={allocatableAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <DropdownInput
                                        id="new-cap-type"
                                        label="Type"
                                        value={newCapType}
                                        onChange={(val) => handleCapTypeChange(val as CapType)}
                                        options={[
                                            { value: 'MAX', label: 'Max Out (Annual)' },
                                            { value: 'FIXED', label: 'Fixed (Monthly)' },
                                            { value: 'MULTIPLE_OF_EXPENSES', label: 'Emergency Fund' },
                                            { value: 'REMAINDER', label: 'Everything Remaining' }
                                        ]}
                                    />
                                    {newCapType === 'FIXED' && (
                                        <CurrencyInput
                                            id="new-cap-val-fixed"
                                            label="Monthly Amount"
                                            value={newCapValue}
                                            onChange={setNewCapValue}
                                        />
                                    )}
                                    {newCapType === 'MAX' && (
                                        <div>
                                            <CurrencyInput
                                                id="new-cap-val-max"
                                                label="Annual Limit"
                                                value={newAccountHasLimit ? newAccountLimit : newCapValue}
                                                onChange={newAccountHasLimit ? () => {} : setNewCapValue}
                                                disabled={newAccountHasLimit}
                                            />
                                            {newAccountHasLimit && (
                                                <p className="text-xs text-emerald-400 mt-1">
                                                    Auto-set to {year} IRS limit
                                                </p>
                                            )}
                                        </div>
                                    )}
                                    {newCapType === 'MULTIPLE_OF_EXPENSES' && (
                                        <NumberInput
                                            id="new-cap-val-mult"
                                            label="Months of Expenses"
                                            value={newCapValue}
                                            onChange={setNewCapValue}
                                        />
                                    )}
                                </div>
                                <div className="flex gap-2 justify-end pt-2">
                                    <button
                                        onClick={() => setShowAddForm(false)}
                                        className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleAdd}
                                        disabled={!newAccount}
                                        className="px-3 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowAddForm(true)}
                                className="mt-3 w-full py-2.5 border-2 border-dashed border-gray-700 hover:border-gray-600 rounded-lg text-gray-400 hover:text-white transition-colors flex items-center justify-center gap-2"
                            >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="12" y1="5" x2="12" y2="19"></line>
                                    <line x1="5" y1="12" x2="19" y2="12"></line>
                                </svg>
                                Add Priority
                            </button>
                        )}
                    </div>

                    {/* Unallocated */}
                    <div className={`mt-4 px-4 py-3 rounded-xl border flex justify-between items-center ${
                        finalRemaining > 0
                            ? 'border-amber-700/50 bg-amber-900/10'
                            : finalRemaining === 0
                                ? 'border-green-700/50 bg-green-900/10'
                                : 'border-red-700/50 bg-red-900/10'
                    }`}>
                        <div>
                            <span className="text-gray-300 font-medium">Unallocated</span>
                            {finalRemaining > 0 && (
                                <p className="text-xs text-amber-400 mt-0.5">Consider adding a "Remainder" priority</p>
                            )}
                        </div>
                        <span className={`font-mono text-lg font-bold ${
                            finalRemaining > 0 ? 'text-amber-400' : finalRemaining === 0 ? 'text-green-400' : 'text-red-400'
                        }`}>
                            {formatMoney(finalRemaining)}
                            {finalRemaining === 0 && ' ✓'}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}
