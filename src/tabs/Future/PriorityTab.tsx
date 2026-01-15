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

export default function PriorityTab() {
  const { state, dispatch } = useContext(AssumptionsContext);
  const { accounts } = useContext(AccountContext);
  const { incomes } = useContext(IncomeContext);
  const { expenses } = useContext(ExpenseContext);
  const { state: taxState } = useContext(TaxContext);

  const year = new Date().getFullYear();
  const forceExact = state.display?.useCompactCurrency === false;

  // Currency formatter that respects user display settings
  const formatMoney = useCallback((amount: number) =>
    formatCompactCurrency(amount, { forceExact }), [forceExact]);

  // 1. Calculate Baselines
  const totalMonthlyIncome = useMemo(() => 
    incomes.reduce((sum, inc) => sum + (inc.getMonthlyAmount(year)), 0), 
  [incomes, year]);

  const totalMonthlyFixedExpenses = useMemo(() => 
    expenses.reduce((sum, exp) => sum + (exp.getMonthlyAmount(year)), 0), 
  [expenses, year]);

  const monthlyTaxes = useMemo(() => {
    const federalTax = calculateFederalTax(taxState, incomes, expenses, year);
    const stateTax = calculateStateTax(taxState, incomes, expenses, year);
    const ficaTax = calculateFicaTax(taxState, incomes, year);
    return (federalTax + stateTax + ficaTax) / 12;
  }, [taxState, incomes, expenses, year]);

  const monthlyPaycheckDeductions = useMemo(() => {
    return incomes.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            const pretax = inc.getProratedMonthly(inc.preTax401k, year);
            const roth = inc.getProratedMonthly(inc.roth401k, year);
            const insurance = inc.getProratedMonthly(inc.insurance, year);
            return sum + pretax + roth + insurance;
        }
        return sum;
    }, 0);
  }, [incomes, year]);

  const existing401kContribs = useMemo(() => {
    return incomes.reduce((sum, inc) => {
        if (inc instanceof WorkIncome) {
            const pretax = inc.getProratedMonthly(inc.preTax401k, year);
            const roth = inc.getProratedMonthly(inc.roth401k, year);
            return sum + pretax + roth;
        }
        return sum;
    }, 0);
  }, [incomes, year]);

  // Helper to get IRS contribution limit for an account
  const getAccountContributionLimit = useCallback((account: AnyAccount): number | null => {
    if (!(account instanceof InvestedAccount)) return null;

    const age = state.demographics.startAge;

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
        return null; // Brokerage has no limit
    }
  }, [year, state.demographics.startAge]);

  // Calculate warnings for priority buckets that exceed IRS limits
  const priorityWarnings = useMemo(() => {
    const warnings: Record<string, { message: string; annual: number; limit: number }> = {};

    state.priorities.forEach(item => {
      // Only check FIXED and MAX cap types
      if (item.capType !== 'FIXED' && item.capType !== 'MAX') return;
      if (!item.accountId) return;

      const account = accounts.find(a => a.id === item.accountId);
      if (!account) return;

      const limit = getAccountContributionLimit(account);
      if (limit === null) return; // No limit for this account type

      // Calculate annual amount
      let annualAmount = 0;
      if (item.capType === 'FIXED') {
        annualAmount = (item.capValue || 0) * 12; // Monthly to annual
      } else if (item.capType === 'MAX') {
        annualAmount = item.capValue || 0; // Already annual
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

  // 2. Local State for "Add New" form
  const [newName, setNewName] = useState('');
  const [newAccount, setNewAccount] = useState<AnyAccount | null>(null);
  const [newCapType, setNewCapType] = useState<CapType>('MAX');
  const [newCapValue, setNewCapValue] = useState<number>(0);

  // Auto-set capValue to IRS limit when MAX type is selected for eligible accounts
  const newAccountLimit = newAccount ? getAccountContributionLimit(newAccount) : null;
  const newAccountHasLimit = newAccountLimit !== null;

  // Update capValue when account or capType changes to MAX
  const handleAccountChange = useCallback((accountId: string) => {
    const selectedAccount = accounts.find(a => a.id === accountId) || null;
    setNewAccount(selectedAccount);

    // If MAX type and account has a limit, auto-set the value
    if (newCapType === 'MAX' && selectedAccount) {
      const limit = getAccountContributionLimit(selectedAccount);
      if (limit !== null) {
        setNewCapValue(limit);
      }
    }
  }, [accounts, newCapType, getAccountContributionLimit]);

  const handleCapTypeChange = useCallback((capType: CapType) => {
    setNewCapType(capType);

    // If switching to MAX and account has a limit, auto-set the value
    if (capType === 'MAX' && newAccount) {
      const limit = getAccountContributionLimit(newAccount);
      if (limit !== null) {
        setNewCapValue(limit);
      } else {
        setNewCapValue(0); // Reset for accounts without limits
      }
    } else {
      setNewCapValue(0); // Reset for other cap types
    }
  }, [newAccount, getAccountContributionLimit]);

  // 3. Local State for Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editAccountId, setEditAccountId] = useState<string>('');
  const [editCapType, setEditCapType] = useState<CapType>('MAX');
  const [editCapValue, setEditCapValue] = useState<number>(0);

  // Get limit for editing account
  const editAccount = accounts.find(a => a.id === editAccountId);
  const editAccountLimit = editAccount ? getAccountContributionLimit(editAccount) : null;
  const editAccountHasLimit = editAccountLimit !== null;

  const handleEditCapTypeChange = useCallback((capType: CapType) => {
    setEditCapType(capType);

    // If switching to MAX and account has a limit, auto-set the value
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

    // If MAX type and new account has a limit, auto-set the value
    if (editCapType === 'MAX') {
      const account = accounts.find(a => a.id === accountId);
      if (account) {
        const limit = getAccountContributionLimit(account);
        if (limit !== null) {
          setEditCapValue(limit);
        }
      }
    }
  }, [accounts, editCapType, getAccountContributionLimit]);

  const handleAdd = () => {
    if (!newAccount) return;

    let finalName = newName;
    if (!finalName) {
        finalName = `${newAccount.name} (${newCapType})`;
    }

    // For MAX type with IRS-limited accounts, ensure we use the limit
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
  };

  const handleStartEdit = (item: PriorityBucket) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditAccountId(item.accountId || '');
    setEditCapType(item.capType);
    setEditCapValue(item.capValue || 0);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;

    const updatedPriority = state.priorities.find(p => p.id === editingId);
    if (!updatedPriority) return;

    // For MAX type with IRS-limited accounts, ensure we use the limit
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

  // 3. WATERFALL CALCULATION
  const waterfallItems = useMemo(() => {
    let currentRemaining = totalMonthlyIncome - monthlyTaxes - monthlyPaycheckDeductions;

    // Subtract existing expenses from running total logic
    expenses.forEach(exp => {
        currentRemaining -= exp.getMonthlyAmount(year);
    });

    return state.priorities.map(item => {
        let cost = 0;
        let displayInfo = ""; // New field to help UI display the "Why"

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
                // LOGIC UPDATE: Target - Current Balance
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

        // You can't put in more money than you have
        const actualDed = Math.min(cost, Math.max(0, currentRemaining));
        
        // Update running totals
        currentRemaining -= actualDed;

        return {
            ...item,
            actualDed,
            remainingAfter: currentRemaining,
            displayInfo
        };
    });
  }, [state.priorities, totalMonthlyIncome, monthlyTaxes, monthlyPaycheckDeductions, existing401kContribs, expenses, totalMonthlyFixedExpenses, year, accounts]); // Added accounts to dependency

  // Calculate Starting Balance for Display
  const startingDisposable = totalMonthlyIncome - monthlyTaxes - monthlyPaycheckDeductions;
  let runningBalanceForDisplay = startingDisposable;

  const [showHelp, setShowHelp] = useState(false);

  return (
    <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 text-white">
      <div className="w-full px-4 sm:px-8 max-w-7xl">
        <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-2">
            <h2 className="text-2xl font-bold">Allocation</h2>
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

        {/* Expandable Help Section */}
        {showHelp && (
            <div className="mb-6 bg-blue-900/20 border border-blue-800/50 rounded-xl p-4 text-sm">
                <h3 className="font-semibold text-blue-300 mb-2">Understanding the Allocation Waterfall</h3>
                <p className="text-gray-300 mb-3">
                    This screen shows how your monthly income flows through your financial priorities. Money "waterfalls" from top to bottom—each step takes what it needs before passing the remainder to the next.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    <div className="space-y-2">
                        <h4 className="font-semibold text-gray-200">The Flow:</h4>
                        <ol className="list-decimal list-inside text-gray-400 space-y-1">
                            <li><span className="text-green-400">Income</span> — Your total monthly earnings</li>
                            <li><span className="text-red-300">Taxes</span> — Federal, state, and FICA withholdings</li>
                            <li><span className="text-red-300">Deductions</span> — 401k, insurance from paychecks</li>
                            <li><span className="text-red-300">Expenses</span> — Your mandatory monthly expenses</li>
                            <li><span className="text-blue-300">Priorities</span> — Where leftover cash goes</li>
                        </ol>
                    </div>
                    <div className="space-y-2">
                        <h4 className="font-semibold text-gray-200">Priority Types:</h4>
                        <ul className="text-gray-400 space-y-1">
                            <li><span className="text-white">Max Out</span> — Fill to IRS annual limit (401k, IRA)</li>
                            <li><span className="text-white">Fixed</span> — Contribute set amount monthly</li>
                            <li><span className="text-white">Emergency Fund</span> — Build to X months of expenses</li>
                            <li><span className="text-white">Everything Remaining</span> — Catch-all for leftover</li>
                        </ul>
                    </div>
                </div>
                <p className="text-gray-400 mt-3 text-xs">
                    <span className="text-gray-300">Tip:</span> Drag priorities to reorder them. Higher priorities get funded first.
                </p>
            </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* --- LEFT COLUMN: CREATE BUCKET --- */}
            <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl h-fit shadow-xl">
                <h3 className="text-lg font-semibold mb-2 text-gray-300">Add Priority Step</h3>
                <p className="text-xs text-gray-400 mb-6">Define where your discretionary cash goes after taxes and expenses. Drag to reorder priorities.</p>
                <div className="space-y-4">
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
                        options={[
                            ...accounts.map(acc => ({ value: acc.id, label: acc.name }))
                        ]}
                        tooltip="The account where this money will be deposited."
                    />

                    <div className="pt-4 border-t border-gray-800">
                        <h4 className="text-xs uppercase text-gray-400 font-semibold mb-2">Limit Rule</h4>
                        <div className="space-y-3">
                            <DropdownInput
                                id="new-cap-type"
                                label="Type"
                                value={newCapType}
                                onChange={(val) => handleCapTypeChange(val as CapType)}
                                options={[
                                    { value: 'MAX', label: 'Max Out (Annual)' },
                                    { value: 'FIXED', label: 'Fixed (Monthly)' },
                                    { value: 'MULTIPLE_OF_EXPENSES', label: 'Emergency Fund Target' },
                                    { value: 'REMAINDER', label: 'Everything Remaining' }
                                ]}
                                tooltip="Max Out: Contribute up to IRS annual limit. Fixed: Set monthly dollar amount. Emergency Fund: Target months of expenses. Everything Remaining: Deposit all leftover cash."
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
                                            Auto-set to {year} IRS limit for this account type
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
                    </div>

                    <button
                        onClick={handleAdd}
                        disabled={!newAccount}
                        title={!newAccount ? "Select an account" : undefined}
                        className="w-full mt-6 bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-xl transition-colors shadow-lg"
                    >
                        Add Step
                    </button>
                </div>
            </div>

            {/* --- RIGHT COLUMN: WATERFALL LIST --- */}
            <div className="lg:col-span-2 space-y-2">
                
                {/* 1. GROSS INCOME HEADER */}
                <div className="bg-gray-800/50 border border-gray-700 rounded-xl px-3 py-2 flex justify-between items-center">
                    <span className="font-bold text-gray-400">Starting Monthly Income</span>
                    <span className="font-mono text-xl text-green-400">{formatMoney(totalMonthlyIncome)}</span>
                </div>

                {/* TAXES */}
                <div className="space-y-2 opacity-80">
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-2 flex justify-between items-center">
                        <div className="flex flex-col">
                            <span className="font-semibold text-gray-300">Taxes</span>
                            <span className="text-xs text-gray-400">Federal, State, FICA</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-red-300 font-mono">-{formatMoney(monthlyTaxes)}</span>
                            <span className="text-xs text-gray-400">Remaining: {formatMoney(totalMonthlyIncome - monthlyTaxes)}</span>
                        </div>
                    </div>
                </div>

                {/* 401k / Paycheck Deductions */}
                <div className="space-y-2 opacity-80">
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-2 flex justify-between items-center">
                        <div className="flex flex-col">
                            <span className="font-semibold text-gray-300">Income Deductions</span>
                            <span className="text-xs text-gray-400">Pre-tax & Roth</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-red-300 font-mono">-{formatMoney(monthlyPaycheckDeductions)}</span>
                            <span className="text-xs text-gray-400">Remaining: {formatMoney(startingDisposable)}</span>
                        </div>
                    </div>
                </div>

                {/* 2. EXISTING EXPENSES (READ ONLY) */}
                <div className="space-y-2 opacity-80">
                    <h4 className="text-xs uppercase text-gray-400 font-semibold ml-2">Mandatory Expenses</h4>
                    {expenses.map((exp) => {
                        const monthlyCost = exp.getMonthlyAmount(year);
                        runningBalanceForDisplay -= monthlyCost;
                        
                        return (
                            <div key={exp.id} className="bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-2 flex justify-between items-center">
                                <div className="flex flex-col">
                                    <span className="font-semibold text-gray-300">{exp.name}</span>
                                    <span className="text-xs text-gray-400">Existing Expense</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-red-300 font-mono">-{formatMoney(monthlyCost)}</span>
                                    <span className="text-xs text-gray-400">Remaining: {formatMoney(runningBalanceForDisplay)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 3. PRIORITIES (DRAGGABLE) */}
                <div className="space-y-2">
                    <h4 className="text-xs uppercase text-gray-400 font-semibold ml-2 mt-6">Priorities Flow</h4>
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="priorities-list">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="flex flex-col">
                                    {waterfallItems.map((item, index) => (
                                        <Draggable key={item.id} draggableId={item.id} index={index}>
                                            {(provided, snapshot) => (
                                                <div
                                                    ref={provided.innerRef}
                                                    {...provided.draggableProps}
                                                    style={provided.draggableProps.style}
                                                    className={`relative group pb-4 ${snapshot.isDragging ? 'z-50' : ''}`}
                                                >
                                                    <div className={`rounded-xl border px-3 py-3 ${
                                                        snapshot.isDragging
                                                        ? 'bg-gray-800 border-green-500 shadow-2xl'
                                                        : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                                                    }`}>
                                                    {editingId === item.id ? (
                                                        /* EDIT MODE */
                                                        <div className="space-y-3">
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
                                                                options={accounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                                                tooltip="The account where this money will be deposited."
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
                                                                        { value: 'MULTIPLE_OF_EXPENSES', label: 'Emergency Fund Target' },
                                                                        { value: 'REMAINDER', label: 'Everything Remaining' }
                                                                    ]}
                                                                    tooltip="Max Out: Contribute up to IRS annual limit. Fixed: Set monthly dollar amount. Emergency Fund: Target months of expenses. Everything Remaining: Deposit all leftover cash."
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
                                                                    <div>
                                                                        <CurrencyInput
                                                                            id={`edit-value-${item.id}`}
                                                                            label="Annual Limit"
                                                                            value={editAccountHasLimit && editAccountLimit !== null ? editAccountLimit : editCapValue}
                                                                            onChange={editAccountHasLimit ? () => {} : setEditCapValue}
                                                                            disabled={editAccountHasLimit}
                                                                        />
                                                                        {editAccountHasLimit && (
                                                                            <p className="text-xs text-emerald-400 mt-1">
                                                                                Auto-set to {year} IRS limit
                                                                            </p>
                                                                        )}
                                                                    </div>
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
                                                            <div className="flex gap-2 justify-end">
                                                                <button
                                                                    onClick={handleCancelEdit}
                                                                    className="px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                                                                >
                                                                    Cancel
                                                                </button>
                                                                <button
                                                                    onClick={handleSaveEdit}
                                                                    className="px-3 py-1 text-sm bg-green-600 hover:bg-green-500 text-white rounded-lg transition-colors"
                                                                >
                                                                    Save
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        /* VIEW MODE */
                                                        <div className="flex items-center">
                                                            {/* Drag Handle */}
                                                            <div {...provided.dragHandleProps} className="mr-4 cursor-grab text-gray-400 hover:text-white shrink-0">
                                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                                            </div>

                                                            {/* Info */}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-bold text-gray-200 truncate">{item.name}</div>
                                                                <div className="text-xs text-blue-400 truncate">
                                                                    {item.displayInfo}
                                                                </div>
                                                                {/* Contribution limit warning */}
                                                                {priorityWarnings[item.id] && (
                                                                    <div className="flex items-center gap-1 mt-1">
                                                                        <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                                        </svg>
                                                                        <span className="text-xs text-amber-400">
                                                                            {priorityWarnings[item.id].message} ({formatMoney(priorityWarnings[item.id].annual)}/{formatMoney(priorityWarnings[item.id].limit)})
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Math */}
                                                            <div className="flex flex-col items-end shrink-0 mx-3">
                                                                <span className="text-blue-300 font-mono text-sm">-{formatMoney(item.actualDed)}</span>
                                                                <span className={`text-xs whitespace-nowrap ${item.remainingAfter < 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                                                    Remaining: {formatMoney(item.remainingAfter)}
                                                                </span>
                                                            </div>

                                                            {/* Actions */}
                                                            <div className="flex gap-1 shrink-0">
                                                                <button
                                                                    onClick={() => handleStartEdit(item)}
                                                                    className="text-gray-400 hover:text-blue-400 p-2 hover:bg-blue-500/10 rounded transition-colors"
                                                                    title="Edit"
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                                                </button>
                                                                <button
                                                                    onClick={() => dispatch({type: 'REMOVE_PRIORITY', payload: item.id})}
                                                                    className="text-gray-400 hover:text-red-500 p-2 hover:bg-red-500/10 rounded transition-colors"
                                                                    title="Delete"
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
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
                </div>

                {/* 4. FINAL REMAINING */}
                <div className={`mt-4 mb-2 px-3 py-2 rounded-xl border border-dashed flex justify-between items-center ${runningBalanceForDisplay > 0 ? 'border-green-800 bg-green-900/10' : 'border-gray-800 bg-gray-900/50'}`}>
                    <span className="text-gray-400 font-semibold">Unallocated Monthly Cashflow</span>
                    <span className={`font-mono text-xl ${
                        (waterfallItems.length > 0 ? waterfallItems[waterfallItems.length - 1].remainingAfter : runningBalanceForDisplay) > 0 
                        ? 'text-green-400' 
                        : 'text-gray-400'
                    }`}>
                        {formatMoney(waterfallItems.length > 0 ? waterfallItems[waterfallItems.length - 1].remainingAfter : runningBalanceForDisplay)}
                    </span>
                </div>

            </div>
        </div>
      </div>
    </div>
  );
}