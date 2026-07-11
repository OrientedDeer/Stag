// src/components/Accounts/EditHistoryModal.tsx
import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccountContext, AccountDispatchContext, type AmountHistoryEntry } from './AccountContext';
import { CurrencyInput } from '../../Layout/InputFields/CurrencyInput';
import { PropertyAccount } from './models';
import { useModalAccessibility } from '../../../hooks/useModalAccessibility';
import { formatDateForInput } from '../../../utils/formatters';
import { Button } from "../../Layout/Primitives";

interface EditHistoryModalProps {
    accountId: string;
    isOpen: boolean;
    onClose: () => void;
}

// A locally-ordered, stably-keyed view of one entry. The store re-sorts
// amountHistory by date on every edit (so reverse().find() consumers read the
// latest balance), but the modal must NOT reorder the row the user is typing in:
// a mid-edit re-sort that shuffles the rendered inputs rebinds the focused input
// to a different entry, and the next keystroke silently rewrites the wrong row
// (#182). So the modal renders from this draft — keyed by a stable `key`, kept in
// a fixed order for the session — instead of reading the re-sorting store order.
interface DraftRow {
    key: number;
    date: string;
    num: number;
}

// Reconcile the store's (sorted) history into the draft while preserving the
// draft's row order and keys. Rows are matched to store entries by value, so a
// pure re-sort (same set of entries) leaves the draft untouched; deletes drop
// the matching row. A genuine add (a store entry that matches no draft row) is
// INSERTED at its date-sorted position among the current rows — before the first
// existing row whose date is greater, else appended — so a new entry lands in
// date order right away instead of only after the modal is reopened. Existing
// rows keep their keys/relative order, so React (which reorders the DOM by key)
// never rebinds a mid-edit input.
function reconcileDraft(
    prev: DraftRow[],
    history: AmountHistoryEntry[],
    makeKey: () => number,
): DraftRow[] {
    const remaining = history.map(e => ({ date: e.date, num: e.num, used: false }));
    const kept: DraftRow[] = [];
    let dropped = 0;
    for (const row of prev) {
        const match = remaining.find(r => !r.used && r.date === row.date && r.num === row.num);
        if (match) {
            match.used = true;
            kept.push(row);
        } else {
            dropped++;
        }
    }
    const added = remaining
        .filter(r => !r.used)
        .map(r => ({ key: makeKey(), date: r.date, num: r.num }));
    if (dropped === 0 && added.length === 0) return prev;
    const result = [...kept];
    for (const row of added) {
        const at = result.findIndex(r => r.date > row.date);
        if (at === -1) result.push(row);
        else result.splice(at, 0, row);
    }
    return result;
}

export const EditHistoryModal: React.FC<EditHistoryModalProps> = ({ accountId, isOpen, onClose }) => {
    const { accounts, amountHistory } = useContext(AccountContext);
    const { dispatch } = useContext(AccountDispatchContext);
    // Memoised so the reconcile effect below doesn't re-run on every render just
    // because `|| []` minted a fresh empty array.
    const history = useMemo(() => amountHistory[accountId] || [], [amountHistory, accountId]);
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const account = accounts.find(acc => acc.id === accountId);
    const isMortgage = account instanceof PropertyAccount && account.ownershipType === 'Financed';

    const [newDate, setNewDate] = useState(formatDateForInput(new Date()));
    const [newAmount, setNewAmount] = useState(0);

    // Stable-order draft the render reads from. Re-initialised when the modal
    // opens for an account; reconciled with the store on subsequent changes so
    // adds/deletes flow through but a mid-edit re-sort never reorders rows.
    const [draft, setDraft] = useState<DraftRow[]>([]);
    const keyCounter = useRef(0);
    const openedForRef = useRef<string | null>(null);

    useEffect(() => {
        if (!isOpen) {
            openedForRef.current = null;
            return;
        }
        const makeKey = () => keyCounter.current++;
        if (openedForRef.current !== accountId) {
            // Fresh open (or account switch): snapshot the current store order.
            openedForRef.current = accountId;
            setDraft(history.map(e => ({ key: makeKey(), date: e.date, num: e.num })));
        } else {
            setDraft(prev => reconcileDraft(prev, history, makeKey));
        }
    }, [isOpen, accountId, history]);

    // Can only delete if there's more than one entry (always keep at least one)
    const canDeleteEntry = history.length > 1;

    if (!isOpen) return null;

    const handleAddEntry = (e?: React.FormEvent) => {
        e?.preventDefault();
        dispatch({
            type: 'ADD_HISTORY_ENTRY',
            payload: { id: accountId, date: newDate, num: newAmount }
        });
        setNewAmount(0);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                onKeyDown={handleKeyDown}
                className="bg-surface-raised border border-border-subtle rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col"
            >
                <div className="flex justify-between items-center mb-6 border-b border-border-subtle pb-3">
                    <h2 className="text-xl font-bold text-white">Edit Balance History</h2>
                    <Button onClick={onClose} variant="ghost" size="none" className="p-2">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </Button>
                </div>

                <div className="overflow-y-auto grow space-y-3 pr-2 mb-6">
                    {draft.map((row, index) => (
                        <div key={row.key} className="flex items-center gap-4 bg-surface-overlay/40 p-3 rounded-lg border border-border-default/50">
                            <div className="w-40">
                                <label className="block text-[10px] text-content-muted uppercase font-bold mb-1">Date</label>
                                <input
                                    type="date"
                                    value={row.date}
                                    onChange={(e) => {
                                        const nextDate = e.target.value;
                                        // Update the draft in place FIRST so the row keeps its
                                        // stable key/position when the store re-sort comes back
                                        // through reconcileDraft — the focused input never rebinds.
                                        setDraft(d => d.map(r => r.key === row.key ? { ...r, date: nextDate } : r));
                                        // prevDate/prevNum pin the edit to THIS row's entry by its
                                        // pre-edit value; the reducer re-sorts on date change, so a
                                        // bare index can't identify the entry across dispatches.
                                        dispatch({
                                            type: 'UPDATE_HISTORY_ENTRY',
                                            payload: { id: accountId, index, prevDate: row.date, prevNum: row.num, date: nextDate, num: row.num }
                                        });
                                    }}
                                    className="bg-surface-raised border border-border-default rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-accent-soft"
                                />
                            </div>
                            <div className="grow">
                                <CurrencyInput
                                    label={isMortgage ? "Valuation" : "Amount"}
                                    value={row.num}
                                    onChange={(val) => {
                                        setDraft(d => d.map(r => r.key === row.key ? { ...r, num: val } : r));
                                        dispatch({
                                            type: 'UPDATE_HISTORY_ENTRY',
                                            payload: { id: accountId, index, prevDate: row.date, prevNum: row.num, date: row.date, num: val }
                                        });
                                    }}
                                />
                            </div>
                            <button
                                onClick={() => dispatch({ type: 'DELETE_HISTORY_ENTRY', payload: { id: accountId, index, prevDate: row.date, prevNum: row.num }})}
                                className={`p-1 rounded-full text-negative hover:text-negative-bright transition-colors ${!canDeleteEntry ? 'opacity-30 cursor-not-allowed' : ''}`}
                                disabled={!canDeleteEntry}
                                title={!canDeleteEntry ? 'Cannot delete the only entry' : 'Delete entry'}
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                        </div>
                    ))}
                </div>

                <form onSubmit={handleAddEntry} className="border-t border-border-subtle pt-5">
                    <h3 className="text-[10px] font-bold text-content-muted uppercase mb-3">Add Manual Entry</h3>
                    <div className="flex items-end gap-4">
                         <div className="w-40">
                            <input
                                type="date"
                                value={newDate}
                                onChange={(e) => setNewDate(e.target.value)}
                                className="bg-surface-overlay border border-border-default rounded px-2 py-2 text-sm text-white w-full h-[42px]"
                            />
                        </div>
                        <div className="grow">
                            <CurrencyInput
                                label={isMortgage ? "Valuation" : "Amount"}
                                value={newAmount}
                                onChange={setNewAmount}
                            />
                        </div>
                        <Button
                            type="submit"
                            variant="positive" size="lg"
                        >
                            Add
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};