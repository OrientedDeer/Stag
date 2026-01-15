import React, { useState, useContext } from "react";
import { AccountContext } from "./AccountContext";
import {
    SavedAccount,
    InvestedAccount,
    PropertyAccount,
    DebtAccount,
    TaxType,
    TaxTypeEnum
} from './models';
import { ExpenseContext } from "../Expense/ExpenseContext";
import { LoanExpense, MortgageExpense } from "../Expense/models";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";

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
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    const [name, setName] = useState("");
    const [amount, setAmount] = useState<number>(0);
    const [employerBalance, setEmployerBalance] = useState<number>(0);
    const [tenureYears, setTenureYears] = useState<number>(0);
    const [vestedPerYear, setVestedPerYear] = useState<number>(0.2);
    const [isFullyVested, setIsFullyVested] = useState<boolean>(false);
    const [expenseRatio, setExpenseRatio] = useState<number>(0.1);
    const [ownershipType, setOwnershipType] = useState<'Financed' | 'Owned'>('Owned');
    const [loanAmount, setLoanAmount] = useState<number>(0);
    const [startingLoanAmount, setStartingLoanAmount] = useState<number>(0);
    const [apr, setApr] = useState<number>(0);
    const [taxType, setTaxType] = useState<TaxType>('Brokerage');
    const [isContributionEligible, setIsContributionEligible] = useState<boolean>(true);
    const [useCustomROR, setUseCustomROR] = useState<boolean>(false);
    const [customROR, setCustomROR] = useState<number>(7.0);

    const id = generateUniqueAccId();

    const handleClose = () => {
        setName("");
        setAmount(0);
        setEmployerBalance(0);
        setTenureYears(0);
        setVestedPerYear(0.2);
        setIsFullyVested(false);
        setExpenseRatio(0.1);
        setOwnershipType('Owned');
        setLoanAmount(0);
        setStartingLoanAmount(0);
        setApr(0);
        setTaxType('Brokerage');
        setIsContributionEligible(true);
        setUseCustomROR(false);
        setCustomROR(7.0);
        onClose();
    };

    const handleAdd = () => {
        if (!selectedType || !name.trim()) return;

        let newAccount;

        if (selectedType === SavedAccount) {
            newAccount = new selectedType(id, name.trim(), amount, apr);
        } else if (selectedType === InvestedAccount) {
            // If fully vested, use 100% per year with 1 year tenure
            const finalTenure = isFullyVested ? 1 : tenureYears;
            const finalVestedPerYear = isFullyVested ? 1.0 : vestedPerYear;
            const finalCustomROR = useCustomROR ? customROR : undefined;
            newAccount = new selectedType(id, name.trim(), amount, employerBalance, finalTenure, expenseRatio, taxType, isContributionEligible, finalVestedPerYear, amount, finalCustomROR);
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
                apr,
                "Compounding",
                0,
                "No",
                0,
                id,
                new Date(),
            )
            expenseDispatch({type: "ADD_EXPENSE", payload: newExpense})

            newAccount = new selectedType(id, name.trim(), amount, 'EXS' + id.substring(3), apr);
        }

        accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
        handleClose();
    };

    if (!isOpen) return null;

    // Get modal title based on account type
    const getModalTitle = () => {
        if (selectedType === SavedAccount) return 'Add Cash Account';
        if (selectedType === InvestedAccount) return 'Add Investment Account';
        if (selectedType === PropertyAccount) return 'Add Property';
        if (selectedType === DebtAccount) return 'Add Debt';
        return 'Add Account';
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={onClose}
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-account-modal-title"
                className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={handleKeyDown}
            >
                <h2 id="add-account-modal-title" className="text-xl font-bold text-white mb-4">
                    {getModalTitle()}
                </h2>
                <div className="space-y-4">
                    <div>
                        <NameInput
                            label="Account Name"
                            id={id}
                            value={name}
                            onChange={setName}
                        />
                    </div>

                    {selectedType === PropertyAccount && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
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
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                                <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={amount}
                                onChange={setAmount}
                            />
                            <PercentageInput
                                id={`${id}-expense-ratio`}
                                label="Expense Ratio"
                                value={expenseRatio}
                                onChange={setExpenseRatio}
                                max={5}
                                tooltip="Annual fee charged by the fund. Example: 0.15% = $15 per $10,000 invested per year."
                            />
                            <DropdownInput
                                id={`${id}-tax-type`}
                                label="Tax Type"
                                value={taxType}
                                onChange={(val) => setTaxType(val as TaxType)}
                                options={TaxTypeEnum as any}
                                tooltip="Tax treatment: Brokerage (taxable), Traditional (pre-tax, taxed on withdrawal), Roth (post-tax, tax-free growth)."
                            />
                            {(taxType === 'Roth 401k' || taxType === 'Traditional 401k') && (
                                <>
                                    <CurrencyInput
                                        id={`${id}-employer-balance`}
                                        label="Employer Balance"
                                        value={employerBalance}
                                        onChange={setEmployerBalance}
                                        tooltip="Amount contributed by your employer (401k match). Subject to vesting schedule."
                                    />
                                    <ToggleInput
                                        id={`${id}-fully-vested`}
                                        label="100% Vested"
                                        enabled={isFullyVested}
                                        setEnabled={setIsFullyVested}
                                        tooltip="Check if employer contributions are fully vested. Hides vesting schedule fields."
                                    />
                                    {!isFullyVested && (
                                        <>
                                            <NumberInput
                                                id={`${id}-tenure-years`}
                                                label="Tenure (Years)"
                                                value={tenureYears}
                                                onChange={setTenureYears}
                                                tooltip="Years you've worked at this employer. Used to calculate vested amount."
                                            />
                                            <PercentageInput
                                                id={`${id}-vested-per-year`}
                                                label="Vested Per Year"
                                                value={vestedPerYear}
                                                onChange={setVestedPerYear}
                                                tooltip="Percentage of employer match that vests each year. Example: 20% means fully vested after 5 years."
                                            />
                                        </>
                                    )}
                                </>
                            )}
                            <ToggleInput
                                id={`${id}-contribution-eligible`}
                                label="Contribution Eligible"
                                enabled={isContributionEligible}
                                setEnabled={setIsContributionEligible}
                                tooltip="Can you still contribute to this account? Turn off for accounts from previous employers."
                            />
                            <ToggleInput
                                id={`${id}-use-custom-ror`}
                                label="Custom Return Rate"
                                enabled={useCustomROR}
                                setEnabled={setUseCustomROR}
                                tooltip="Override global return rate assumptions with a custom rate for this account."
                            />
                            {useCustomROR && (
                                <PercentageInput
                                    id={`${id}-custom-ror`}
                                    label="Return Rate"
                                    value={customROR}
                                    onChange={setCustomROR}
                                    max={30}
                                    tooltip="Expected annual return rate for this account. Overrides the global assumption."
                                />
                            )}
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
                            <PercentageInput
                                id={`${id}-apr`}
                                label="APR"
                                value={apr}
                                onChange={setApr}
                                max={50}
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
                        title={!name.trim() ? "Enter a name" : undefined}
                        className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        Add Account
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AddAccountModal;