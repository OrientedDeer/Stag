import { useState, useContext, useMemo, useCallback, useEffect } from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { AssumptionsContext, PriorityBucket, CapType, getBirthYear } from '../../components/Objects/Assumptions/AssumptionsContext';
import { AccountContext } from '../../components/Objects/Accounts/AccountContext';
import { IncomeContext } from '../../components/Objects/Income/IncomeContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AnyAccount, InvestedAccount, DebtAccount, DeficitDebtAccount } from '../../components/Objects/Accounts/models';
import { TaxContext } from '../../components/Objects/Taxes/TaxContext';
import { calculateFederalTaxFromIncomes, calculateStateTax, calculateFicaTax } from '../../components/Objects/Taxes/TaxService';
import { WorkIncome } from '../../components/Objects/Income/models';
import { formatCompactCurrency } from './tabs/FutureUtils';
import { get401kLimit, getIRALimit, getHSALimit } from '../../data/ContributionLimits';
import { getActiveExpenses } from '../../components/Objects/Budget/budgetUtils';
import { isLongTermGoal, getGoalFundMonthlyCap } from '../../components/Objects/Expense/models';

// UI Components
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { NameInput } from '../../components/Layout/InputFields/NameInput';
import { NumberInput } from '../../components/Layout/InputFields/NumberInput';
import { ChevronIcon } from '../../components/Layout/Icons/ChevronIcon';
import { Tooltip } from '../../components/Layout/InputFields/Tooltip';
import { Panel, Button } from "../../components/Layout/Primitives";
import { useReceiptToast } from '../../components/Layout/Overlays/ReceiptToast';

export default function PriorityTab() {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { accounts } = useContext(AccountContext);
    const { incomes } = useContext(IncomeContext);
    const { expenses } = useContext(ExpenseContext);
    const { state: taxState } = useContext(TaxContext);
    const { show: showReceipt } = useReceiptToast();

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
            // #60 C: only UNLINKED debts are offered as a paydown priority. A
            // linked debt (backed by a LoanExpense) accelerates via the loan's
            // own extra_payment, and the system DeficitDebt is engine-managed —
            // both are excluded so surplus never double-drives them.
            if (acc instanceof DebtAccount) {
                return !(acc instanceof DeficitDebtAccount) && !acc.linkedAccountId;
            }
            return true; // Include non-invested accounts (savings, etc.)
        });
    }, [accounts]);

    // Helper: is this priority bucket targeting a (paydown-eligible) debt?
    const isDebtAccount = useCallback((accountId: string | undefined): boolean => {
        if (!accountId) return false;
        const acc = accounts.find(a => a.id === accountId);
        return acc instanceof DebtAccount && !(acc instanceof DeficitDebtAccount);
    }, [accounts]);

    // ========== CALCULATIONS ==========

    const totalMonthlyIncome = useMemo(() =>
        incomes.reduce((sum, inc) => sum + (inc.getMonthlyAmount(year)), 0),
    [incomes, year]);

    // Use today's active expenses (raw monthly), not the year's prorated average.
    // Otherwise a mid-year expense end/start would skew both the disposable-income
    // calc and the MULTIPLE_OF_EXPENSES emergency-fund target.
    const totalMonthlyFixedExpenses = useMemo(() => {
        const today = new Date();
        const activeToday = getActiveExpenses(expenses, today.getMonth() + 1, today.getFullYear());
        return activeToday.reduce((sum, exp) => sum + exp.getMonthlyAmount(), 0);
    }, [expenses]);

    // Tax calculations (monthly). Tax fns only read `state.macro` (inflation)
    // and `state.milestones` (age). Narrowing the deps avoids recomputing on
    // unrelated assumption updates like priority reorders.
    /* eslint-disable react-hooks/exhaustive-deps */
    const federalTax = useMemo(() => calculateFederalTaxFromIncomes(taxState, incomes, expenses, 0, year, state) / 12, [taxState, incomes, expenses, year, state.macro, state.milestones]);
    const stateTax = useMemo(() => calculateStateTax(taxState, incomes, expenses, year, state) / 12, [taxState, incomes, expenses, year, state.macro, state.milestones]);
    const ficaTax = useMemo(() => calculateFicaTax(taxState, incomes, year, state) / 12, [taxState, incomes, year, state.macro, state.milestones]);
    /* eslint-enable react-hooks/exhaustive-deps */
    const monthlyTaxes = federalTax + stateTax + ficaTax;

    // Paycheck deductions (401k, insurance, HSA)
    const age = state.milestones ? year - getBirthYear(state.milestones) : undefined;
    const deductionBreakdown = useMemo(() => {
        let pretax401k = 0;
        let roth401k = 0;
        let insurance = 0;
        let hsa = 0;

        incomes.forEach(inc => {
            if (inc instanceof WorkIncome) {
                const effective401k = age !== undefined
                    ? inc.getEffective401k(year, age)
                    : { preTax: inc.preTax401k, roth: inc.roth401k };
                pretax401k += inc.getProratedMonthly(effective401k.preTax, year);
                roth401k += inc.getProratedMonthly(effective401k.roth, year);
                insurance += inc.getProratedMonthly(inc.insurance, year);
                hsa += inc.getProratedMonthly(inc.hsaContribution || 0, year);
            }
        });

        return { pretax401k, roth401k, insurance, hsa, total: pretax401k + roth401k + insurance + hsa };
    }, [incomes, year, age]);

    const monthlyPaycheckDeductions = deductionBreakdown.total;

    // Committed goal set-asides: the simulation counts these with living
    // expenses (funded directly into each goal's reserved fund), so they come
    // off the top here too — before any priority bucket sees surplus. Note
    // goals report $0 from getMonthlyAmount, so they're not already counted
    // in totalMonthlyFixedExpenses.
    const totalGoalSetAsides = useMemo(() =>
        expenses.reduce((sum, e) =>
            isLongTermGoal(e) && e.goalAccountId
                ? sum + (getGoalFundMonthlyCap(expenses, e.goalAccountId, year) ?? 0)
                : sum,
        0),
    [expenses, year]);

    // Take-home calculation
    const totalWithheld = monthlyTaxes + monthlyPaycheckDeductions;
    const takeHome = totalMonthlyIncome - totalWithheld;
    const disposableAfterExpenses = takeHome - totalMonthlyFixedExpenses - totalGoalSetAsides;

    // ========== CONTRIBUTION LIMITS ==========

    const getAccountContributionLimit = useCallback((account: AnyAccount): number | null => {
        if (!(account instanceof InvestedAccount)) return null;
        const age = year - getBirthYear(state.milestones);

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
    }, [year, state.milestones]);

    // Legacy migration: goals used to create a savings-priority bucket here.
    // Goal funding is now a committed transfer inside the simulation (counted
    // with living expenses), so any surviving goal-fund bucket is removed —
    // it would only confuse the allocation view (the sim already zeroes them).
    const goalFundIds = useMemo(() =>
        new Set(expenses.filter(e => isLongTermGoal(e) && e.goalAccountId).map(e => e.goalAccountId!)),
    [expenses]);
    useEffect(() => {
        state.priorities
            .filter(p => p.accountId && goalFundIds.has(p.accountId))
            .forEach(p => dispatch({ type: 'REMOVE_PRIORITY', payload: p.id }));
    }, [state.priorities, goalFundIds, dispatch]);

    // Buckets that can never receive surplus: the waterfall runs top-down and a
    // REMAINDER bucket takes everything left, so anything below the first
    // REMAINDER is dead — flag it so the user drags it above.
    const unreachableIds = useMemo(() => {
        const ids = new Set<string>();
        // A debt bucket is stored as REMAINDER but only consumes its own balance
        // (the engine caps it and continues), so it does NOT make lower buckets
        // unreachable. Only a real "Everything Remaining" bucket does that.
        const remainderIdx = state.priorities.findIndex(
            p => p.capType === 'REMAINDER' && !isDebtAccount(p.accountId)
        );
        if (remainderIdx !== -1) {
            state.priorities.slice(remainderIdx + 1).forEach(p => ids.add(p.id));
        }
        return ids;
    }, [state.priorities, isDebtAccount]);

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

    // #60 C: when the selected destination is a debt, the cap-type/value inputs
    // are hidden — a debt bucket simply pays its balance to $0.
    const newIsDebtSelected = newAccount instanceof DebtAccount && !(newAccount instanceof DeficitDebtAccount);
    const editIsDebtSelected = isDebtAccount(editAccountId);

    // Destination dropdown options, labeling debts as a paydown.
    const accountOptions = useMemo(() =>
        allocatableAccounts.map(acc => ({
            value: acc.id,
            label: (acc instanceof DebtAccount && !(acc instanceof DeficitDebtAccount))
                ? `Pay down: ${acc.name}`
                : acc.name,
        })),
    [allocatableAccounts]);

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

        // #60 C: a debt-paydown bucket has no cap type — it pays the balance to
        // $0. Persist a stable REMAINDER capType (the engine ignores capType for
        // debts) and a clear "Pay down: <name>" default label.
        const newIsDebt = newAccount instanceof DebtAccount && !(newAccount instanceof DeficitDebtAccount);

        let finalName = newName;
        if (!finalName) {
            if (newIsDebt) {
                finalName = `Pay down: ${newAccount.name}`;
            } else {
                // Use friendly labels for cap types in default name
                const capTypeLabels: Record<CapType, string> = {
                    'MAX': 'Max Out',
                    'FIXED': 'Fixed',
                    'REMAINDER': 'Remainder',
                    'MULTIPLE_OF_EXPENSES': 'Emergency Fund'
                };
                finalName = `${newAccount.name} (${capTypeLabels[newCapType]})`;
            }
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
            capType: newIsDebt ? 'REMAINDER' : newCapType,
            capValue: newIsDebt ? 0 : finalCapValue
        };

        dispatch({ type: 'ADD_PRIORITY', payload: newBucket });
        showReceipt({ message: 'Allocation added — projection updated' });
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

        const editIsDebt = isDebtAccount(editAccountId);

        let finalCapValue = editCapValue;
        if (editCapType === 'MAX' && editAccountHasLimit && editAccountLimit !== null) {
            finalCapValue = editAccountLimit;
        }

        const updated: PriorityBucket = {
            ...updatedPriority,
            name: editName,
            accountId: editAccountId,
            // #60 C: a debt bucket pays to $0 — store a stable REMAINDER capType.
            capType: editIsDebt ? 'REMAINDER' : editCapType,
            capValue: editIsDebt ? 0 : finalCapValue
        };

        dispatch({ type: 'UPDATE_PRIORITY', payload: updated });
        setEditingId(null);
    };

    const handleCancelEdit = () => {
        setEditingId(null);
    };

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;
        if (result.destination.index === result.source.index) return;
        const items = Array.from(state.priorities);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        dispatch({ type: 'SET_PRIORITIES', payload: items });
        showReceipt({ message: 'Allocation order changed — projection updated' });
    };

    // ========== WATERFALL CALCULATION ==========

    const waterfallItems = useMemo(() => {
        let currentRemaining = disposableAfterExpenses;

        return state.priorities.map(item => {
            let cost = 0;
            // Short label shown inline; provenance string explains the cost +
            // the min(cost, remaining) clamp in a tooltip (built below).
            let label = "";
            let wantedNote = "";

            const surplusBefore = Math.max(0, currentRemaining);

            // #60 C: a debt-paydown bucket ignores cap types — its cost is its
            // current balance (pay to $0). Shown here as the displayed balance;
            // the engine sizes the actual payment against the post-interest
            // balance so it truly clears.
            const debtAccount = isDebtAccount(item.accountId)
                ? (accounts.find(a => a.id === item.accountId) as DebtAccount | undefined)
                : undefined;
            if (debtAccount) {
                cost = Math.max(0, debtAccount.amount);
                label = `Pay down ${debtAccount.name}`;
                wantedNote = `Pay down ${formatMoney(debtAccount.amount)} balance (${debtAccount.apr}% APR)`;
                const actualDed = Math.min(cost, Math.max(0, currentRemaining));
                currentRemaining -= actualDed;
                const clamped = actualDed < cost - 0.005;
                const provenance = clamped
                    ? `${wantedNote} · ${formatMoney(surplusBefore)} surplus left · funded ${formatMoney(actualDed)}`
                    : wantedNote;
                return { ...item, actualDed, remainingAfter: currentRemaining, label, provenance };
            }

            switch (item.capType) {
                case 'FIXED':
                    cost = item.capValue || 0;
                    label = 'Fixed monthly';
                    wantedNote = `Wanted ${formatMoney(cost)}/mo`;
                    break;
                case 'REMAINDER':
                    cost = currentRemaining;
                    label = 'Everything remaining';
                    wantedNote = `Wanted everything left (${formatMoney(Math.max(0, cost))})`;
                    break;
                case 'MULTIPLE_OF_EXPENSES': {
                    const targetAccount = accounts.find(a => a.id === item.accountId);
                    const targetAmount = (item.capValue || 0) * totalMonthlyFixedExpenses;

                    if (targetAccount) {
                        const currentBalance = targetAccount.amount;
                        cost = Math.max(0, targetAmount - currentBalance);
                        label = `Emergency fund (${item.capValue}× expenses)`;
                        wantedNote = `Target = ${item.capValue} months × ${formatMoney(totalMonthlyFixedExpenses)} monthly expenses = ${formatMoney(targetAmount)}. Balance ${formatMoney(currentBalance)}, so ${formatMoney(cost)} still needed`;
                    } else {
                        cost = 0;
                        label = `Emergency fund (${item.capValue}× expenses)`;
                        wantedNote = 'No account linked — nothing funded';
                    }
                    break;
                }
                case 'MAX': {
                    // Prefer the stored cap; otherwise fall back to the account's
                    // live IRS limit (401k/IRA/HSA) rather than a stale hardcoded
                    // $23k. An account with no contribution limit (e.g. a taxable
                    // brokerage, capValue persisted as 0) plans $0 and is flagged
                    // as needing a cap — the engine doesn't deduct a phantom max.
                    const maxAccount = accounts.find(a => a.id === item.accountId);
                    const liveLimit = maxAccount ? getAccountContributionLimit(maxAccount) : null;
                    const annualLimit = item.capValue || liveLimit || 0;
                    const monthlyLimit = annualLimit / 12;
                    cost = Math.max(0, monthlyLimit);
                    label = 'Max out (IRS annual limit)';
                    wantedNote = annualLimit > 0
                        ? `Annual limit ${formatMoney(annualLimit)} ÷ 12 = ${formatMoney(monthlyLimit)}/mo`
                        : 'No contribution limit for this account — set a cap to fund it';
                    break;
                }
            }

            const actualDed = Math.min(cost, Math.max(0, currentRemaining));
            currentRemaining -= actualDed;

            // Explain the funded amount whenever the surplus clamp bit (the
            // bucket wanted more than was left), so a partially-funded bucket
            // showing a smaller number than typed isn't a mystery.
            const clamped = actualDed < cost - 0.005;
            const provenance = clamped
                ? `${wantedNote} · ${formatMoney(surplusBefore)} surplus left · funded ${formatMoney(actualDed)}`
                : wantedNote;

            return {
                ...item,
                actualDed,
                remainingAfter: currentRemaining,
                label,
                provenance,
            };
        });
    }, [state.priorities, disposableAfterExpenses, totalMonthlyFixedExpenses, accounts, getAccountContributionLimit, formatMoney, isDebtAccount]);

    const finalRemaining = waterfallItems.length > 0
        ? waterfallItems[waterfallItems.length - 1].remainingAfter
        : disposableAfterExpenses;

    // ========== RENDER ==========

    return (
        <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24 text-white">
            <div className="w-full px-4 sm:px-8 max-w-4xl">

                {/* Header */}
                <div className="flex items-center justify-between mb-6 border-b border-border-subtle pb-2">
                    <h2 className="text-2xl font-bold">Allocation</h2>
                    <button
                        onClick={() => setShowHelp(!showHelp)}
                        className="text-xs text-content-muted hover:text-white flex items-center gap-1 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {showHelp ? 'Hide help' : 'How this works'}
                    </button>
                </div>

                {/* Help Section */}
                {showHelp && (
                    <div className="mb-6 bg-info-tint/20 border border-info-strong/50 rounded-xl p-4 text-sm">
                        <h3 className="font-semibold text-info-bright mb-2">How Allocation Works</h3>
                        <p className="text-content-default mb-3">
                            This page shows where your money goes each month. After taxes, deductions, and expenses are taken out,
                            you decide how to allocate the rest through your <strong>priorities</strong>.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div className="space-y-2">
                                <h4 className="font-semibold text-content-emphasis">Priority Types:</h4>
                                <ul className="text-content-muted space-y-1">
                                    <li><span className="text-white">Max Out</span> - Fill to IRS annual limit (IRA, HSA)</li>
                                    <li><span className="text-white">Fixed</span> - Contribute set amount monthly</li>
                                    <li><span className="text-white">Emergency Fund</span> - Build to X months of expenses</li>
                                    <li><span className="text-white">Everything Remaining</span> - Catch-all for leftover</li>
                                </ul>
                            </div>
                            <div className="space-y-2">
                                <h4 className="font-semibold text-content-emphasis">Tips:</h4>
                                <ul className="text-content-muted space-y-1">
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
                        className="w-full flex items-center justify-between p-4 bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle hover:border-border-default transition-colors"
                    >
                        <div className="flex items-center gap-2 text-sm text-content-muted">
                            <span className="uppercase tracking-wide font-semibold">Monthly Take-Home</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-positive font-mono">{formatMoney(totalMonthlyIncome)}</span>
                                <span className="text-content-subtle">gross</span>
                                <span className="text-content-faint">→</span>
                                <span className="text-negative font-mono">-{formatMoney(totalWithheld)}</span>
                                <span className="text-content-subtle">withheld</span>
                                <span className="text-content-faint">→</span>
                                <span className="text-white font-bold font-mono">{formatMoney(takeHome)}</span>
                            </div>
                            <ChevronIcon expanded={showPaycheckDetails} className="w-5 h-5" />
                        </div>
                    </button>

                    {showPaycheckDetails && (
                        <Panel className="mt-2 bg-surface-raised/50 space-y-2 text-sm">
                            <div className="text-xs text-content-subtle uppercase tracking-wide mb-2">Withholding Breakdown</div>
                            <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                                <div className="flex justify-between">
                                    <span className="text-content-muted">Federal Tax</span>
                                    <span className="text-negative-bright font-mono">-{formatMoney(federalTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">State Tax</span>
                                    <span className="text-negative-bright font-mono">-{formatMoney(stateTax)}</span>
                                </div>
                                <div className="flex justify-between">
                                    <span className="text-content-muted">FICA (SS + Medicare)</span>
                                    <span className="text-negative-bright font-mono">-{formatMoney(ficaTax)}</span>
                                </div>
                                {deductionBreakdown.pretax401k > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-content-muted">Pre-tax 401k</span>
                                        <span className="text-info-bright font-mono">-{formatMoney(deductionBreakdown.pretax401k)}</span>
                                    </div>
                                )}
                                {deductionBreakdown.roth401k > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-content-muted">Roth 401k</span>
                                        <span className="text-info-bright font-mono">-{formatMoney(deductionBreakdown.roth401k)}</span>
                                    </div>
                                )}
                                {deductionBreakdown.insurance > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-content-muted">Health Insurance</span>
                                        <span className="text-info-bright font-mono">-{formatMoney(deductionBreakdown.insurance)}</span>
                                    </div>
                                )}
                                {deductionBreakdown.hsa > 0 && (
                                    <div className="flex justify-between">
                                        <span className="text-content-muted">HSA</span>
                                        <span className="text-info-bright font-mono">-{formatMoney(deductionBreakdown.hsa)}</span>
                                    </div>
                                )}
                            </div>
                            <div className="border-t border-border-default pt-2 mt-2 flex justify-between font-semibold">
                                <span className="text-content-default">Total Withheld</span>
                                <span className="text-negative font-mono">-{formatMoney(totalWithheld)}</span>
                            </div>
                        </Panel>
                    )}
                </div>

                {/* Main Allocation Section */}
                <div className="mb-2">
                    <h3 className="text-lg font-semibold text-white mb-4">
                        Allocate Your <span className="text-positive">{formatMoney(takeHome)}</span>
                    </h3>

                    {/* Expenses Summary (Collapsible) */}
                    {expenses.length > 0 && (
                        <div className="mb-4">
                            <button
                                onClick={() => setShowExpenseDetails(!showExpenseDetails)}
                                aria-expanded={showExpenseDetails}
                                className="w-full flex items-center justify-between p-3 bg-surface-raised/50 rounded-xl border border-border-subtle hover:border-border-default transition-colors"
                            >
                                <span className="text-content-default font-medium">Committed Expenses</span>
                                <div className="flex items-center gap-3">
                                    {/* Today's active expenses — deliberately different from the
                                        Dashboard's "avg/mo this year" (annual total / 12). */}
                                    <span className="text-negative-bright font-mono">-{formatMoney(totalMonthlyFixedExpenses + totalGoalSetAsides)}</span>
                                    <span className="text-content-subtle text-sm">this month</span>
                                    <ChevronIcon expanded={showExpenseDetails} className="w-5 h-5" />
                                </div>
                            </button>

                            {showExpenseDetails && (
                                <Panel padding="sm" className="mt-2 bg-surface-raised/30 space-y-1 text-sm">
                                    {expenses.map(exp => {
                                        // Goals report $0 as an expense; their committed
                                        // monthly set-aside is the real outflow.
                                        const isGoal = isLongTermGoal(exp);
                                        const monthly = isGoal && exp.goalAccountId
                                            ? (getGoalFundMonthlyCap(expenses, exp.goalAccountId, year) ?? 0)
                                            : exp.getMonthlyAmount(year);
                                        return (
                                            <div key={exp.id} className="flex justify-between py-1">
                                                <span className="text-content-muted">{exp.name}{isGoal ? ' (goal set-aside)' : ''}</span>
                                                <span className="text-negative-bright font-mono">-{formatMoney(monthly)}</span>
                                            </div>
                                        );
                                    })}
                                </Panel>
                            )}
                        </div>
                    )}

                    {/* Available for Priorities */}
                    <div className="flex justify-between items-center mb-4 px-1">
                        <span className="text-sm text-content-muted">Available for priorities</span>
                        <span className="text-positive font-mono font-semibold">{formatMoney(disposableAfterExpenses)}</span>
                    </div>

                    {/* Priorities Section */}
                    <div className="bg-[var(--c-surface-raised)] rounded-xl border border-border-subtle p-4">
                        <h4 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">Your Priorities</h4>

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
                                                            ? 'bg-surface-overlay border-positive-soft shadow-2xl'
                                                            : 'bg-surface-raised border-border-default hover:border-border-strong'
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
                                                                        options={accountOptions}
                                                                    />
                                                                    {editIsDebtSelected ? (
                                                                        <p className="text-xs text-content-muted">
                                                                            Paid down to $0 at this rank — drag to reorder.
                                                                        </p>
                                                                    ) : (
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
                                                                    )}
                                                                    <div className="flex gap-2 justify-end pt-2">
                                                                        <Button
                                                                            onClick={handleCancelEdit}
                                                                            variant="secondary" size="sm"
                                                                        >
                                                                            Cancel
                                                                        </Button>
                                                                        <Button
                                                                            onClick={handleSaveEdit}
                                                                            variant="positive" size="sm"
                                                                        >
                                                                            Save
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                /* View Mode */
                                                                <div className="flex items-center">
                                                                    <div {...provided.dragHandleProps} className="mr-3 cursor-grab text-content-subtle hover:text-white shrink-0">
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
                                                                        <div className="font-medium text-content-emphasis truncate">{item.name}</div>
                                                                        <div className="flex items-center gap-1 text-xs text-info">
                                                                            <span className="truncate">{item.label}</span>
                                                                            <Tooltip text={item.provenance} />
                                                                        </div>
                                                                        {unreachableIds.has(item.id) && (
                                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                                <svg className="w-3 h-3 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                                                </svg>
                                                                                <span className="text-xs text-warning">
                                                                                    Never funded — an "Everything Remaining" bucket above takes all surplus. Drag this above it.
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                        {priorityWarnings[item.id] && (
                                                                            <div className="flex items-center gap-1 mt-0.5">
                                                                                <svg className="w-3 h-3 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                                                                </svg>
                                                                                <span className="text-xs text-warning">
                                                                                    {priorityWarnings[item.id].message}
                                                                                </span>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    <div className="flex flex-col items-end shrink-0 mx-3">
                                                                        <div className="flex items-center gap-1">
                                                                            <span className="text-info-bright font-mono text-sm">-{formatMoney(item.actualDed)}</span>
                                                                            <Tooltip text={item.provenance} />
                                                                        </div>
                                                                        <span className={`text-xs ${item.remainingAfter < 0 ? 'text-negative' : 'text-content-subtle'}`}>
                                                                            {formatMoney(item.remainingAfter)} left
                                                                        </span>
                                                                    </div>

                                                                    <div className="flex gap-1 shrink-0">
                                                                        <button
                                                                            onClick={() => handleStartEdit(item)}
                                                                            className="text-content-subtle hover:text-info p-1.5 hover:bg-info-tint/10 rounded transition-colors"
                                                                            title="Edit"
                                                                        >
                                                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                                                            </svg>
                                                                        </button>
                                                                        <button
                                                                            onClick={() => {
                                                                                dispatch({ type: 'REMOVE_PRIORITY', payload: item.id });
                                                                                showReceipt({ message: `Removed "${item.name}" — projection updated` });
                                                                            }}
                                                                            className="text-content-subtle hover:text-negative p-1.5 hover:bg-negative-soft/10 rounded transition-colors"
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
                            <div className="text-center py-6 text-content-subtle">
                                <p className="mb-2">No priorities set up yet</p>
                                <p className="text-xs text-content-faint">Add priorities to control where your money goes</p>
                            </div>
                        )}

                        {/* Inline Add Form */}
                        {showAddForm ? (
                            <div className="mt-3 p-4 bg-surface-raised rounded-lg border border-border-default space-y-3">
                                <div className="flex justify-between items-center mb-2">
                                    <span className="text-sm font-semibold text-content-default">Add Priority</span>
                                    <button
                                        onClick={() => setShowAddForm(false)}
                                        className="text-content-subtle hover:text-white"
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
                                    options={accountOptions}
                                />
                                {newIsDebtSelected ? (
                                    <p className="text-xs text-content-muted">
                                        This debt is paid down to $0 when the waterfall reaches its
                                        rank — drag it where you want the payoff to happen.
                                    </p>
                                ) : (
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
                                                <p className="text-xs text-positive mt-1">
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
                                )}
                                <div className="flex gap-2 justify-end pt-2">
                                    <Button
                                        onClick={() => setShowAddForm(false)}
                                        variant="secondary" size="sm"
                                    >
                                        Cancel
                                    </Button>
                                    <Button
                                        onClick={handleAdd}
                                        disabled={!newAccount}
                                        variant="positive" size="sm"
                                    >
                                        Add
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowAddForm(true)}
                                className="mt-3 w-full py-2.5 border-2 border-dashed border-border-default hover:border-border-strong rounded-lg text-content-muted hover:text-white transition-colors flex items-center justify-center gap-2"
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
                            ? 'border-warning-strong/50 bg-warning-tint/10'
                            : finalRemaining === 0
                                ? 'border-positive-strong/50 bg-positive-tint/10'
                                : 'border-negative-strong/50 bg-negative-tint/10'
                    }`}>
                        <div>
                            <span className="text-content-default font-medium">Unallocated</span>
                            {finalRemaining > 0 && (
                                <p className="text-xs text-warning mt-0.5">Consider adding a "Remainder" priority</p>
                            )}
                        </div>
                        <span className={`font-mono text-lg font-bold ${
                            finalRemaining > 0 ? 'text-warning' : finalRemaining === 0 ? 'text-positive' : 'text-negative'
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
