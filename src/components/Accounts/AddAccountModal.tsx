import React, { useState, useContext } from "react";
import { AccountContext } from "./AccountContext";
import { 
    SavedAccount, 
    InvestedAccount, 
    PropertyAccount, 
    DebtAccount 
} from './models';
import { ExpenseContext } from "../Expense/ExpenseContext";
import { LoanExpense, MortgageExpense } from "../Expense/models";
// 1. Import the reusable component
import { CurrencyInput } from "../Layout/CurrencyInput";
import { NameInput } from "../Layout/NameInput";
import { DropdownInput } from "../Layout/DropdownInput";

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
    const [NonVestedAmount, setNonVestedAmount] = useState<number>(0);
    const [ownershipType, setOwnershipType] = useState<'Financed' | 'Owned'>('Owned');
    const [loanAmount, setLoanAmount] = useState<number>(0);
    const [startingLoanAmount, setStartingLoanAmount] = useState<number>(0);
    const id = generateUniqueAccId();

    const handleClose = () => {
        setName("");
        setAmount(0);
        setNonVestedAmount(0);
        setOwnershipType('Owned');
        setLoanAmount(0);
        setStartingLoanAmount(0);
        onClose();
    };

    const handleAdd = () => {
        if (!name.trim() || !selectedType) return;

        let newAccount;

        if (selectedType === SavedAccount) {
            newAccount = new selectedType(id, name.trim(), amount);
        } else if (selectedType === InvestedAccount) {
            newAccount = new selectedType(id, name.trim(), amount, NonVestedAmount);
        } else if (selectedType === PropertyAccount) {
            if (ownershipType == "Financed"){
                const newExpense = new MortgageExpense(
                    'EXS' + id.substring(3),
                    name.trim(),
                    'Monthly',
                    amount,
                    loanAmount,
                    startingLoanAmount,
                    6.23,
                    30,
                    0.85,
                    89850,
                    1,
                    180,
                    0.56,
                    0.58,
                    0,
                    'Itemized',
                    0,
                    id,
                    new Date(),
                    0,
                    0
                )
                expenseDispatch({type: "ADD_EXPENSE", payload: newExpense})
            }
            newAccount = new PropertyAccount(id, 
                                            name.trim(),
                                            amount, 
                                            ownershipType, 
                                            loanAmount, 
                                            startingLoanAmount,
                                            'EXS' + id.substring(3));
        } else if (selectedType === DebtAccount) {
            const newExpense = new LoanExpense(
                'EXS' + id.substring(3),
                name.trim(),
                amount,
                "Monthly",
                0,
                "Compounding",
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm min-w-max">
			<div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-md overflow-y-auto text-white">
                <div className="space-y-4">
                    
                    {/* Common Fields */}
                    <div>
                        <NameInput 
                            label="Account Name"
                            id={id}
                            value={name}
                            onChange={setName}
                        />
                    </div>

                    {selectedType === PropertyAccount && (
                        <div className="grid grid-cols-3 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={amount}
                                onChange={setAmount}
                            />
                            <DropdownInput
                                id={`${id}-ownership-type`}
                                label="Ownership Type"
                                onChange={(val) => setOwnershipType(val as "Owned" | "Financed" | "Owned")}
                                options={["Owned", "Financed"]}
                                value={ownershipType}
                            />
                            {ownershipType == "Financed" && (
                                <>
                                    <CurrencyInput
                                        id={`${id}-loan-amount`}
                                        label="Loan Amount"
                                        value={loanAmount}
                                        onChange={setLoanAmount}
                                    />
                                    <CurrencyInput
                                        id={`${id}-starting-loan-amount`}
                                        label="Starting Loan Amount"
                                        value={startingLoanAmount}
                                        onChange={setStartingLoanAmount}
                                    />
                                </>
                            )}
                        </div>
                    )}
                    {selectedType === InvestedAccount && (
                        <div className="grid grid-cols-3 gap-4">
                                <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={amount}
                                onChange={setAmount}
                            />
                            <CurrencyInput
                                id={`${id}-non-vested-amount`}
                                label="Non-Vested Contrib."
                                value={NonVestedAmount}
                                onChange={setNonVestedAmount}
                            />
                        </div>
                    )}
                    {!(selectedType === InvestedAccount || selectedType === PropertyAccount) && (
                        <div className="grid grid-cols-1 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={amount}
                                onChange={setAmount}
                            />
                        </div>
                    )}
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