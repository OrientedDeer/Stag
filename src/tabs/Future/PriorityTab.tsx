import { useState, useContext, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, PriorityBucket, CapType } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AnyAccount } from '../../components/Objects/Accounts/models';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { calculateFederalTax, calculateStateTax, calculateFicaTax } from '../../components/Objects/Taxes/TaxService';
import { WorkIncome } from '../../components/Objects/Income/models';

// UI Components
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { NameInput } from '../../components/Layout/InputFields/NameInput';
import { NumberInput } from '../../components/Layout/InputFields/NumberInput';

// Helper to format currency
const formatMoney = (amount: number) => 
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2, minimumFractionDigits: 2}).format(amount);

export default function PriorityTab() {
  const { state, dispatch } = useContext(AssumptionsContext);
  const { accounts } = useContext(AccountContext);
  const { incomes } = useContext(IncomeContext);
  const { expenses } = useContext(ExpenseContext);
  const { state: taxState } = useContext(TaxContext);
  
  const year = new Date().getFullYear();

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


  // 2. Local State for "Add New" form
  const [newName, setNewName] = useState('');
  const [newAccount, setNewAccount] = useState<AnyAccount | null>(null);
  const [newCapType, setNewCapType] = useState<CapType>('MAX');
  const [newCapValue, setNewCapValue] = useState<number>(0);

  // 3. Local State for Editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editCapType, setEditCapType] = useState<CapType>('MAX');
  const [editCapValue, setEditCapValue] = useState<number>(0);

  const handleAdd = () => {
    if(!newAccount) return;

    let finalName = newName;
    if (!finalName) {
        finalName = `${newAccount.name} (${newCapType})`;
    }
    
    const newBucket: PriorityBucket = {
        id: `bucket-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: finalName,
        type: 'INVESTMENT',
        accountId: newAccount?.id,
        capType: newCapType,
        capValue: newCapValue
    };

    dispatch({ type: 'ADD_PRIORITY', payload: newBucket });
    setNewName('');
    setNewCapValue(0);
    setNewAccount(null);
  };

  const handleStartEdit = (item: PriorityBucket) => {
    setEditingId(item.id);
    setEditName(item.name);
    setEditCapType(item.capType);
    setEditCapValue(item.capValue || 0);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;

    const updatedPriority = state.priorities.find(p => p.id === editingId);
    if (!updatedPriority) return;

    const updated: PriorityBucket = {
      ...updatedPriority,
      name: editName,
      capType: editCapType,
      capValue: editCapValue
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

  return (
    <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 text-white">
      <div className="w-full px-8 max-w-7xl">
        <h2 className="text-2xl font-bold mb-6 border-b border-gray-800 pb-2">
            Cashflow Waterfall
        </h2>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* --- LEFT COLUMN: CREATE BUCKET --- */}
            <div className="bg-gray-900 border border-gray-800 p-6 rounded-2xl h-fit shadow-xl">
                <h3 className="text-lg font-semibold mb-6 text-gray-300">Add Priority Step</h3>
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
                        label="Link Account"
                        value={newAccount?.id ?? ''}
                        onChange={(id) => {
                            const selectedAccount = accounts.find(a => a.id === id) || null;
                            setNewAccount(selectedAccount);
                        }}
                        options={[
                            ...accounts.map(acc => ({ value: acc.id, label: acc.name }))
                        ]}
                    />

                    <div className="pt-4 border-t border-gray-800">
                        <h4 className="text-xs uppercase text-gray-500 font-semibold mb-2">Limit Rule</h4>
                        <div className="space-y-3">
                            <DropdownInput
                                id="new-cap-type"
                                label="Type"
                                value={newCapType}
                                onChange={(val) => {
                                    setNewCapType(val as CapType);
                                    setNewCapValue(0);
                                }}
                                options={['MAX', 'FIXED', 'MULTIPLE_OF_EXPENSES', 'REMAINDER']}
                            />

                            {(newCapType === 'FIXED' || newCapType === 'MAX') && (
                                <CurrencyInput
                                    id="new-cap-val-fixed"
                                    label={newCapType === 'MAX' ? "Annual Limit" : "Monthly Amount"}
                                    value={newCapValue}
                                    onChange={setNewCapValue}
                                />
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
                            <span className="text-xs text-gray-500">Federal, State, FICA</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-red-300 font-mono">-{formatMoney(monthlyTaxes)}</span>
                            <span className="text-xs text-gray-500">Remaining: {formatMoney(totalMonthlyIncome - monthlyTaxes)}</span>
                        </div>
                    </div>
                </div>

                {/* 401k / Paycheck Deductions */}
                <div className="space-y-2 opacity-80">
                    <div className="bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-2 flex justify-between items-center">
                        <div className="flex flex-col">
                            <span className="font-semibold text-gray-300">Income Deductions</span>
                            <span className="text-xs text-gray-500">Pre-tax & Roth</span>
                        </div>
                        <div className="flex flex-col items-end">
                            <span className="text-red-300 font-mono">-{formatMoney(monthlyPaycheckDeductions)}</span>
                            <span className="text-xs text-gray-500">Remaining: {formatMoney(startingDisposable)}</span>
                        </div>
                    </div>
                </div>

                {/* 2. EXISTING EXPENSES (READ ONLY) */}
                <div className="space-y-2 opacity-80">
                    <h4 className="text-xs uppercase text-gray-500 font-semibold ml-2">Mandatory Expenses</h4>
                    {expenses.map((exp) => {
                        const monthlyCost = exp.getMonthlyAmount(year);
                        runningBalanceForDisplay -= monthlyCost;
                        
                        return (
                            <div key={exp.id} className="bg-gray-900/50 border border-gray-800 rounded-xl px-3 py-2 flex justify-between items-center">
                                <div className="flex flex-col">
                                    <span className="font-semibold text-gray-300">{exp.name}</span>
                                    <span className="text-xs text-gray-500">Existing Expense</span>
                                </div>
                                <div className="flex flex-col items-end">
                                    <span className="text-red-300 font-mono">-{formatMoney(monthlyCost)}</span>
                                    <span className="text-xs text-gray-500">Remaining: {formatMoney(runningBalanceForDisplay)}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* 3. PRIORITIES (DRAGGABLE) */}
                <div className="space-y-2">
                    <h4 className="text-xs uppercase text-gray-500 font-semibold ml-2 mt-6">Priorities Flow</h4>
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
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <DropdownInput
                                                                    id={`edit-type-${item.id}`}
                                                                    label="Type"
                                                                    value={editCapType}
                                                                    onChange={(val) => setEditCapType(val as CapType)}
                                                                    options={['MAX', 'FIXED', 'MULTIPLE_OF_EXPENSES', 'REMAINDER']}
                                                                />
                                                                {(editCapType === 'FIXED' || editCapType === 'MAX') && (
                                                                    <CurrencyInput
                                                                        id={`edit-value-${item.id}`}
                                                                        label={editCapType === 'MAX' ? "Annual Limit" : "Monthly Amount"}
                                                                        value={editCapValue}
                                                                        onChange={setEditCapValue}
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
                                                            <div {...provided.dragHandleProps} className="mr-4 cursor-grab text-gray-600 hover:text-white shrink-0">
                                                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                                            </div>

                                                            {/* Info */}
                                                            <div className="flex-1 min-w-0">
                                                                <div className="font-bold text-gray-200 truncate">{item.name}</div>
                                                                <div className="text-xs text-blue-400 truncate">
                                                                    {item.displayInfo}
                                                                </div>
                                                            </div>

                                                            {/* Math */}
                                                            <div className="flex flex-col items-end shrink-0 mx-3">
                                                                <span className="text-blue-300 font-mono text-sm">-{formatMoney(item.actualDed)}</span>
                                                                <span className={`text-xs whitespace-nowrap ${item.remainingAfter < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                                                                    Remaining: {formatMoney(item.remainingAfter)}
                                                                </span>
                                                            </div>

                                                            {/* Actions */}
                                                            <div className="flex gap-1 shrink-0">
                                                                <button
                                                                    onClick={() => handleStartEdit(item)}
                                                                    className="text-gray-600 hover:text-blue-400 p-2 hover:bg-blue-500/10 rounded transition-colors"
                                                                    title="Edit"
                                                                >
                                                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                                                                </button>
                                                                <button
                                                                    onClick={() => dispatch({type: 'REMOVE_PRIORITY', payload: item.id})}
                                                                    className="text-gray-600 hover:text-red-500 p-2 hover:bg-red-500/10 rounded transition-colors"
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
                        : 'text-gray-500'
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