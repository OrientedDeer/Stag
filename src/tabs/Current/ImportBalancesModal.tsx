import React, { useContext, useMemo, useState, useCallback } from 'react';
import { AccountContext, AccountDispatchContext } from '../../components/Objects/Accounts/AccountContext';
import { DropdownInput } from '../../components/Layout/InputFields/DropdownInput';
import { CurrencyInput } from '../../components/Layout/InputFields/CurrencyInput';
import { formatCurrency } from '../../components/Objects/Budget/budgetUtils';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import {
    parseBalancesCSV,
    autoMatchAccount,
    loadAccountMap,
    saveAccountMap,
    type BalanceRow,
} from '../../services/simplefinBalances';

interface ImportBalancesModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const SKIP = '__skip__';

type Stage = 'upload' | 'review' | 'done';

// How a single CSV account is applied: to zero accounts (skip), one account
// (full balance), or several (split, with an explicit dollar allocation each).
interface RowPlan {
    targetIds: string[]; // [] = skip
    amounts: Record<string, number>; // only meaningful when targetIds.length >= 2
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const ImportBalancesModal: React.FC<ImportBalancesModalProps> = ({ isOpen, onClose }) => {
    const { accounts } = useContext(AccountContext);
    const { dispatch } = useContext(AccountDispatchContext);
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const [stage, setStage] = useState<Stage>('upload');
    const [rows, setRows] = useState<BalanceRow[]>([]);
    const [errors, setErrors] = useState<string[]>([]);
    const [plans, setPlans] = useState<Record<string, RowPlan>>({});
    const [result, setResult] = useState<string[]>([]);

    const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

    const sortedAccounts = useMemo(
        () => [...accounts].sort((a, b) => a.name.localeCompare(b.name)),
        [accounts]
    );

    // Distribute `total` across `ids` weighted by each account's current balance
    // (even split if they're all empty). Last account absorbs the rounding remainder.
    const splitByWeight = useCallback(
        (total: number, ids: string[]): Record<string, number> => {
            const out: Record<string, number> = {};
            if (ids.length === 0) return out;
            const raw = ids.map((id) => Math.abs(accountById.get(id)?.amount ?? 0));
            const sum = raw.reduce((a, b) => a + b, 0);
            const weights = sum > 0 ? raw : ids.map(() => 1);
            const wsum = weights.reduce((a, b) => a + b, 0);
            let allocated = 0;
            ids.forEach((id, i) => {
                if (i === ids.length - 1) {
                    out[id] = round2(total - allocated);
                } else {
                    const v = round2((total * weights[i]) / wsum);
                    out[id] = v;
                    allocated += v;
                }
            });
            return out;
        },
        [accountById]
    );

    const reset = useCallback(() => {
        setStage('upload');
        setRows([]);
        setErrors([]);
        setPlans({});
        setResult([]);
    }, []);

    const handleClose = useCallback(() => {
        reset();
        onClose();
    }, [reset, onClose]);

    const handleFile = useCallback(
        async (file: File) => {
            const content = await file.text();
            const parsed = parseBalancesCSV(content);

            const saved = loadAccountMap();
            const appAccounts = accounts.map((a) => ({ id: a.id, name: a.name }));
            const seeded: Record<string, RowPlan> = {};
            const claimed = new Set<string>(); // app accounts already assigned to a row

            // Pass 1: remembered mappings win (filtered to accounts that still exist).
            for (const row of parsed.rows) {
                const remembered = (saved[row.account] ?? []).filter((id) => accountById.has(id));
                seeded[row.account] = { targetIds: remembered, amounts: {} };
                remembered.forEach((id) => claimed.add(id));
            }

            // Pass 2: auto-match the rest, skipping accounts another row already claimed.
            for (const row of parsed.rows) {
                if (seeded[row.account].targetIds.length === 0) {
                    const auto = autoMatchAccount(row.account, appAccounts);
                    if (auto && !claimed.has(auto)) {
                        seeded[row.account].targetIds = [auto];
                        claimed.add(auto);
                    }
                }
                const { targetIds } = seeded[row.account];
                if (targetIds.length >= 2) {
                    seeded[row.account].amounts = splitByWeight(row.balance, targetIds);
                }
            }

            setRows(parsed.rows);
            setErrors(parsed.errors);
            setPlans(seeded);
            if (parsed.rows.length > 0) setStage('review');
        },
        [accounts, accountById, splitByWeight]
    );

    const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) void handleFile(file);
        e.target.value = ''; // allow re-selecting the same file
    };

    // Every app account already chosen by any row — used to hide already-imported
    // accounts from all dropdowns so the same account can't be a target twice.
    const allSelectedIds = useMemo(() => {
        const used = new Set<string>();
        for (const row of rows) {
            for (const id of plans[row.account]?.targetIds ?? []) used.add(id);
        }
        return used;
    }, [rows, plans]);

    // --- plan mutators -----------------------------------------------------

    const setTargets = useCallback(
        (row: BalanceRow, targetIds: string[]) => {
            setPlans((prev) => ({
                ...prev,
                [row.account]: {
                    targetIds,
                    amounts: targetIds.length >= 2 ? splitByWeight(row.balance, targetIds) : {},
                },
            }));
        },
        [splitByWeight]
    );

    const selectTarget = (row: BalanceRow, idx: number, value: string) => {
        const plan = plans[row.account];
        let next: string[];
        if (idx === 0 && value === SKIP) {
            next = [];
        } else {
            next = [...plan.targetIds];
            next[idx] = value;
        }
        setTargets(row, next);
    };

    const addSplit = (row: BalanceRow) => {
        const plan = plans[row.account];
        // Default the new slot to the first account not already used anywhere.
        const next = sortedAccounts.find((a) => !allSelectedIds.has(a.id));
        if (!next) return;
        setTargets(row, [...plan.targetIds, next.id]);
    };

    const removeTarget = (row: BalanceRow, idx: number) => {
        const plan = plans[row.account];
        setTargets(row, plan.targetIds.filter((_, i) => i !== idx));
    };

    const setAmount = (row: BalanceRow, appId: string, val: number) => {
        setPlans((prev) => {
            const plan = prev[row.account];
            return { ...prev, [row.account]: { ...plan, amounts: { ...plan.amounts, [appId]: val } } };
        });
    };

    // --- validation --------------------------------------------------------

    // Account options for a given target slot, excluding any account already
    // chosen by another slot or another row — except this slot's own current
    // value, which must stay present so the selection remains valid.
    const optionsFor = (row: BalanceRow, idx: number) => {
        const current = plans[row.account]?.targetIds[idx];
        const base = sortedAccounts
            .filter((a) => !allSelectedIds.has(a.id) || a.id === current)
            .map((a) => ({ value: a.id, label: a.name }));
        return idx === 0 ? [{ value: SKIP, label: "— Don't import —" }, ...base] : base;
    };

    const allocatedFor = (plan: RowPlan) =>
        plan.targetIds.reduce((sum, id) => sum + (plan.amounts[id] ?? 0), 0);

    const rowValid = (row: BalanceRow): boolean => {
        const plan = plans[row.account];
        if (!plan || plan.targetIds.length <= 1) return true; // skip or single is always fine
        return Math.abs(allocatedFor(plan) - row.balance) < 0.01;
    };

    const matchedCount = rows.filter((r) => (plans[r.account]?.targetIds.length ?? 0) >= 1).length;
    const allValid = rows.every((r) => rowValid(r));

    // --- apply -------------------------------------------------------------

    const handleApply = useCallback(() => {
        const updatedNames: string[] = [];
        const mapToPersist: Record<string, string[]> = {};

        for (const row of rows) {
            const plan = plans[row.account];
            if (!plan || plan.targetIds.length === 0) continue;

            plan.targetIds.forEach((appId) => {
                const account = accountById.get(appId);
                if (!account) return;
                const value =
                    plan.targetIds.length === 1 ? row.balance : round2(plan.amounts[appId] ?? 0);

                // Mirror the manual balance-edit flow in AccountCard: update the
                // current balance and log a same-day history snapshot.
                dispatch({
                    type: 'UPDATE_ACCOUNT_FIELD',
                    payload: { id: appId, field: 'amount', value },
                });
                dispatch({ type: 'ADD_AMOUNT_SNAPSHOT', payload: { id: appId, amount: value } });
                updatedNames.push(account.name);
            });

            mapToPersist[row.account] = plan.targetIds;
        }

        saveAccountMap({ ...loadAccountMap(), ...mapToPersist });
        setResult(updatedNames);
        setStage('done');
    }, [rows, plans, accountById, dispatch]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                onKeyDown={handleKeyDown}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-3xl shadow-2xl max-h-[85vh] flex flex-col"
            >
                <div className="flex justify-between items-center mb-4 border-b border-gray-800 pb-3">
                    <h2 className="text-xl font-bold text-white">Import Account Balances</h2>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white text-2xl leading-none"
                        aria-label="Close"
                    >
                        ×
                    </button>
                </div>

                {stage === 'upload' && (
                    <div className="flex flex-col gap-4">
                        <p className="text-gray-300 text-sm">
                            Select the <span className="font-mono text-gray-200">balances</span> CSV produced by
                            stag-feed. We'll match each account to one of yours and update its current balance.
                        </p>
                        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-700 rounded-xl p-10 cursor-pointer hover:border-green-600 hover:bg-gray-800/40 transition-colors">
                            <span className="text-gray-300 font-semibold">Choose CSV file</span>
                            <span className="text-gray-500 text-xs">FetchedAt, Org, Account, Balance, …</span>
                            <input type="file" accept=".csv,text/csv" onChange={onFileChange} className="hidden" />
                        </label>
                        {errors.length > 0 && (
                            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-red-400 text-sm">
                                {errors.map((err, i) => (
                                    <div key={i}>{err}</div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {stage === 'review' && (
                    <>
                        <div className="flex-1 overflow-y-auto custom-scrollbar -mx-1 px-1">
                            <p className="text-gray-400 text-sm mb-3">
                                Confirm where each imported account goes. Use{' '}
                                <span className="text-gray-300">Split</span> to divide one balance (e.g. a 401k)
                                across multiple accounts. Unmatched rows default to{' '}
                                <span className="text-gray-300">Don't import</span>.
                            </p>
                            <div className="space-y-2">
                                {rows.map((row) => {
                                    const plan = plans[row.account];
                                    const targetIds = plan?.targetIds ?? [];
                                    const isSplit = targetIds.length >= 2;
                                    const canAddSplit =
                                        targetIds.length >= 1 && allSelectedIds.size < accounts.length;
                                    const allocated = plan ? allocatedFor(plan) : 0;
                                    const remaining = round2(row.balance - allocated);
                                    return (
                                        <div
                                            key={row.account}
                                            className="bg-gray-800/40 border border-gray-800 rounded-lg p-3"
                                        >
                                            <div className="flex justify-between items-start gap-3 mb-2">
                                                <div className="min-w-0">
                                                    <div className="text-white text-sm truncate">{row.account}</div>
                                                    <div className="text-gray-500 text-xs truncate">
                                                        {row.org}
                                                        {row.balanceDate ? ` · ${row.balanceDate}` : ''}
                                                    </div>
                                                </div>
                                                <div className="text-right font-mono text-sm text-gray-200 whitespace-nowrap">
                                                    {formatCurrency(row.balance)}
                                                </div>
                                            </div>

                                            <div className="space-y-2">
                                                {(targetIds.length === 0 ? [SKIP] : targetIds).map(
                                                    (target, idx) => {
                                                        const acct =
                                                            target !== SKIP ? accountById.get(target) : undefined;
                                                        return (
                                                            <div
                                                                key={`${row.account}-${idx}`}
                                                                className="flex items-center gap-2"
                                                            >
                                                                <div className="flex-1 min-w-0">
                                                                    <DropdownInput
                                                                        label=""
                                                                        value={target}
                                                                        onChange={(val) =>
                                                                            selectTarget(row, idx, val)
                                                                        }
                                                                        options={optionsFor(row, idx)}
                                                                    />
                                                                </div>
                                                                {isSplit && acct && (
                                                                    <div className="w-32 shrink-0">
                                                                        <CurrencyInput
                                                                            label=""
                                                                            value={plan.amounts[target] ?? 0}
                                                                            onChange={(val) =>
                                                                                setAmount(row, target, val)
                                                                            }
                                                                        />
                                                                    </div>
                                                                )}
                                                                {targetIds.length > 1 && (
                                                                    <button
                                                                        onClick={() => removeTarget(row, idx)}
                                                                        className="text-gray-500 hover:text-red-400 text-xl leading-none shrink-0 px-1"
                                                                        aria-label="Remove split target"
                                                                    >
                                                                        ×
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    }
                                                )}
                                            </div>

                                            <div className="flex justify-between items-center mt-2 min-h-5">
                                                {canAddSplit ? (
                                                    <button
                                                        onClick={() => addSplit(row)}
                                                        className="text-xs font-semibold text-green-400 hover:text-green-300"
                                                    >
                                                        + Split across another account
                                                    </button>
                                                ) : (
                                                    <span />
                                                )}
                                                {isSplit && (
                                                    <span
                                                        className={`text-xs font-mono ${
                                                            Math.abs(remaining) < 0.01
                                                                ? 'text-gray-500'
                                                                : 'text-yellow-300'
                                                        }`}
                                                    >
                                                        {formatCurrency(allocated)} of{' '}
                                                        {formatCurrency(row.balance)}
                                                        {Math.abs(remaining) >= 0.01 &&
                                                            ` · ${formatCurrency(remaining)} left`}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {errors.length > 0 && (
                                <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-yellow-300 text-sm mt-3">
                                    {errors.map((err, i) => (
                                        <div key={i}>{err}</div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex justify-between items-center gap-3 mt-4 pt-3 border-t border-gray-800">
                            <button
                                onClick={() => setStage('upload')}
                                className="text-gray-400 hover:text-white text-sm font-semibold px-3 py-2"
                            >
                                ← Back
                            </button>
                            <button
                                onClick={handleApply}
                                disabled={matchedCount === 0 || !allValid}
                                className="bg-green-600 px-5 py-2.5 rounded-xl text-white font-bold hover:bg-green-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Update {matchedCount} account{matchedCount === 1 ? '' : 's'}
                            </button>
                        </div>
                    </>
                )}

                {stage === 'done' && (
                    <div className="flex flex-col gap-4">
                        {result.length > 0 ? (
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4 text-blue-400 text-sm">
                                Updated {result.length} account balance{result.length === 1 ? '' : 's'}:
                                <ul className="mt-2 list-disc list-inside text-blue-300">
                                    {result.map((name, i) => (
                                        <li key={`${name}-${i}`}>{name}</li>
                                    ))}
                                </ul>
                            </div>
                        ) : (
                            <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 text-yellow-300 text-sm">
                                No balances were updated.
                            </div>
                        )}
                        <div className="flex justify-end">
                            <button
                                onClick={handleClose}
                                className="bg-green-600 px-5 py-2.5 rounded-xl text-white font-bold hover:bg-green-700 transition-colors"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ImportBalancesModal;
