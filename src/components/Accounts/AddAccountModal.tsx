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
// 1. Import the reusable component
import { CurrencyInput } from "../Layout/CurrencyInput";

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
        setVestedAmount(0);
        setOwnershipType('Owned');
        setLoanAmount(0);
        onClose();
    };

    const handleAdd = () => {
        if (!name.trim() || !selectedType) return;

        const id = generateUniqueAccId();
        let newAccount;

        if (selectedType === SavedAccount) {
            newAccount = new selectedType(id, name.trim(), amount);
        } else if (selectedType === InvestedAccount) {
            newAccount = new selectedType(id, name.trim(), amount, vestedAmount);
        } else if (selectedType === PropertyAccount) {
            if (ownershipType == "Financed"){
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
                    id
                )
                expenseDispatch({type: "ADD_EXPENSE", payload: newExpense})
            }
            newAccount = new selectedType(id, name.trim(), amount, ownershipType, loanAmount);
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
                id
            )
            expenseDispatch({type: "ADD_EXPENSE", payload: newExpense})

            newAccount = new selectedType(id, name.trim(), amount, 'EXS' + id.substring(3));
        }

        accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
        handleClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-md overflow-y-auto text-white">
                <div className="space-y-4"> {/* Increased space-y slightly for better breathing room with the new Inputs */}
                    
                    {/* Common Fields */}
                    <div>
                        <label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
                            Account Name
                        </label>
                        <input
                            autoFocus
                            className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4"> {/* Changed to grid-cols-2 for better fit with the boxed inputs */}
                        
                        {/* 2. Replace raw inputs with CurrencyInput */}
                        <CurrencyInput
                            label="Amount"
                            value={amount}
                            onChange={setAmount} // Directly pass the setter!
                        />

                        {/* --- Specialized Fields --- */}
                        {selectedType === PropertyAccount && (
                            <div>
                                {/* Keeping standard select for now as we don't have a CurrencySelect component */}
                                <label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">Status</label>
                                <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2">
                                    <select 
                                        className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                                        value={ownershipType} 
                                        onChange={(e) => setOwnershipType(e.target.value as any)}
                                    >
                                        <option value="Owned" className="bg-gray-950">Owned</option>
                                        <option value="Financed" className="bg-gray-950">Financed</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {ownershipType == "Financed" && (
                            <CurrencyInput
                                label="Loan Amount"
                                value={loanAmount}
                                onChange={setLoanAmount}
                            />
                        )}

                        {selectedType === InvestedAccount && (
                            <CurrencyInput
                                label="Employer Contrib."
                                value={vestedAmount}
                                onChange={setVestedAmount}
                            />
                        )}
                    </div>
                </div>

                <div className="flex justify-end gap-3 mt-8">
                    <button
						onClick={handleClose}
						className="px-5 py-2.5 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
					>
						Cancel
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