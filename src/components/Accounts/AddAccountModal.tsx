import React, { useState, useContext } from "react";
import { AccountContext } from "./AccountContext";
import { 
    SavedAccount, 
    InvestedAccount, 
    PropertyAccount, 
    DebtAccount 
} from './models';
import { ExpenseContext } from "../Expense/ExpenseContext";
import { LoanExpense } from "../Expense/models";

const generateUniqueAccId = () =>
    `ACC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddAccountModalProps {
    isOpen: boolean;
    selectedType: any;
    onClose: () => void;
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({
    isOpen,
    selectedType,
    onClose,
}) => {
    const { dispatch: accountDispatch } = useContext(AccountContext);
    const { dispatch: expenseDispatch } = useContext(ExpenseContext);
    const [name, setName] = useState("");
    const [amount, setAmount] = useState<number>(0);
    const [vestedAmount, setVestedAmount] = useState<number>(0);
    const [ownershipType, setOwnershipType] = useState<'Financed' | 'Owned'>('Owned');
    const [loanAmount, setLoanAmount] = useState<number>(0);

    const handleClose = () => {
        setName("");
        setAmount(0);
        onClose();
    };

    const handleAdd = () => {
        if (!name.trim() || !selectedType) return;

        const id = generateUniqueAccId();

        let newAccount;

        // Logic to handle specialized constructors from models.tsx
        if (selectedType === SavedAccount) {
            newAccount = new selectedType(
                id,
                name.trim(),
                amount,
            );
        } else if (selectedType === InvestedAccount) {
            newAccount = new selectedType(
                id,
                name.trim(),
                amount,
                vestedAmount,
            );
        } else if (selectedType === PropertyAccount) {
            newAccount = new selectedType(
                id,
                name.trim(),
                amount,
                ownershipType,
                loanAmount,
            );
        } else if (selectedType === DebtAccount) {
            const newExpense = new LoanExpense(
                'EXS' + id.substring(3),
                name.trim(),
                amount,
                "Monthly",
                0,
                "Compounding",
                new Date(),
                0,
                "No",
                0,
                2,
                id
            )
            expenseDispatch({type: "ADD_EXPENSE", payload: newExpense})

            newAccount = new selectedType(
                id,
                name.trim(),
                amount,
                'EXS' + id.substring(3),
            );
        }

        accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
        handleClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-md overflow-y-auto text-white">
                <div className="space-y-0.5">
                    {/* Common Fields */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">
                            Account Name
                        </label>
                        <input
                            autoFocus
                            className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">
                                Amount
                            </label>
                            <input
                                type="number"
                                className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none"
                                value={amount}
                                onChange={(e) => setAmount(Number(e.target.value))}
                            />
                        </div>
                        {/* --- Specialized Fields based on models.tsx --- */}
                        {selectedType === PropertyAccount && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Status</label>
                                <select className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg pl-2 focus:border-green-300 outline-none appearance-none" value={ownershipType} onChange={(e) => setOwnershipType(e.target.value as any)}>
                                    <option value="Owned">Owned</option>
                                    <option value="Financed">Financed</option>
                                </select>
                            </div>
                        )}
                        {ownershipType == "Financed" && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Loan Amount</label>
                                <input type="number" className="w-full h-8 bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={loanAmount} onChange={(e) => setLoanAmount(Number(e.target.value))} />
                            </div>
                        )}
                        {selectedType === InvestedAccount && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Employer Contrib.</label>
                                <input type="number" className="w-full h-8 bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={vestedAmount} onChange={(e) => setVestedAmount(Number(e.target.value))} />
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-8">
                    <button
						onClick={handleClose}
						className="px-5 py-2.5 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
					>
						{"Cancel"}
					</button>
                    <button
                        onClick={handleAdd}
                        disabled={!name.trim()}
                        className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                        Add Account
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddAccountModal;
