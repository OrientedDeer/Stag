// src/components/Accounts/EditHistoryModal.tsx
import React, { useContext, useState } from 'react';
import { AccountContext } from './AccountContext';
import { CurrencyInput } from '../Layout/CurrencyInput';

interface EditHistoryModalProps {
    accountId: string;
    isOpen: boolean;
    onClose: () => void;
}

export const EditHistoryModal: React.FC<EditHistoryModalProps> = ({ accountId, isOpen, onClose }) => {
    const { amountHistory, dispatch } = useContext(AccountContext);
    const history = amountHistory[accountId] || [];

    const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
    const [newAmount, setNewAmount] = useState(0);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-2xl shadow-2xl max-h-[80vh] flex flex-col">
                <div className="flex justify-between items-center mb-6 border-b border-gray-800 pb-3">
                    <h2 className="text-xl font-bold text-white">Edit Balance History</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">&times;</button>
                </div>

                <div className="overflow-y-auto grow space-y-3 pr-2 mb-6">
                    {history.map((entry, index) => (
                        <div key={index} className="flex items-center gap-4 bg-gray-800/40 p-3 rounded-lg border border-gray-700/50">
                            <div className="w-40">
                                <label className="block text-[10px] text-gray-500 uppercase font-bold mb-1">Date</label>
                                <input 
                                    type="date"
                                    value={entry.date}
                                    onChange={(e) => dispatch({
                                        type: 'UPDATE_HISTORY_ENTRY',
                                        payload: { id: accountId, index, date: e.target.value, num: entry.num }
                                    })}
                                    className="bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-white w-full outline-none focus:border-blue-500"
                                />
                            </div>
                            <div className="grow">
                                <CurrencyInput 
                                    label="Amount"
                                    value={entry.num}
                                    onChange={(val) => dispatch({
                                        type: 'UPDATE_HISTORY_ENTRY',
                                        payload: { id: accountId, index, date: entry.date, num: val }
                                    })}
                                />
                            </div>
                            <button 
                                onClick={() => dispatch({ type: 'DELETE_HISTORY_ENTRY', payload: { id: accountId, index }})}
                                className="text-red-500 hover:text-red-400 p-2 mt-4"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                            </button>
                        </div>
                    ))}
                </div>

                <div className="border-t border-gray-800 pt-5">
                    <h3 className="text-[10px] font-bold text-gray-500 uppercase mb-3">Add Manual Entry</h3>
                    <div className="flex items-end gap-4">
                         <div className="w-40">
                            <input 
                                type="date"
                                value={newDate}
                                onChange={(e) => setNewDate(e.target.value)}
                                className="bg-gray-800 border border-gray-700 rounded px-2 py-2 text-sm text-white w-full h-[42px]"
                            />
                        </div>
                        <div className="grow">
                            <CurrencyInput 
                                label="test"
                                value={newAmount}
                                onChange={setNewAmount}
                            />
                        </div>
                        <button 
                            onClick={() => {
                                dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: accountId, date: newDate, num: newAmount }});
                                setNewAmount(0);
                            }}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg h-[42px] text-sm font-bold transition-colors"
                        >
                            Add
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};