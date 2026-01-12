import { useContext, useState } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, PropertyAccount, DebtAccount, ACCOUNT_COLORS_BACKGROUND, TaxTypeEnum} from "./models";
import { AccountContext, AllAccountKeys } from "./AccountContext";
import { ExpenseContext } from "../Expense/ExpenseContext";
import { StyledSelect, StyledDisplay } from "../../Layout/InputFields/StyleUI";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput"; // Import your new component
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import DeleteAccountControl from './DeleteAccountUI';
import { EditHistoryModal } from "./EditHistoryModal";
import { NameInput } from "../../Layout/InputFields/NameInput";

// Chevron icon component
const ChevronIcon = ({ expanded, className = '' }: { expanded: boolean; className?: string }) => (
    <svg
        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${expanded ? 'rotate-180' : ''} ${className}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
    >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
);

const AccountCard = ({ account }: { account: AnyAccount }) => {
	const { dispatch: accountDispatch } = useContext(AccountContext);
	const { expenses, dispatch: expenseDispatch } = useContext(ExpenseContext);
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    const handleFieldUpdate = (field: AllAccountKeys, value: any) => {
        accountDispatch({
            type: "UPDATE_ACCOUNT_FIELD",
            payload: { id: account.id, field, value },
        });

        if (account instanceof DebtAccount && account.linkedAccountId) {
            if (field === "name") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "name", value },
                });
            }
            if (field === "amount") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "amount", value },
                });
            }
            if (field === "apr") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "apr", value },
                });
            }
        }

		if (account instanceof PropertyAccount && account.linkedAccountId) {
            if (field === "name") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "name", value },
                });
            }
            if (field === "amount") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "valuation", value },
                });
            }
			if (field === "loanAmount") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "loan_balance", value },
                });
            }
            if (field === "startingLoanBalance") {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "starting_loan_balance", value },
                });
            }
        }
        
        if (field === "amount" && typeof value === 'number') {
             accountDispatch({
                type: "ADD_AMOUNT_SNAPSHOT",
                payload: { id: account.id, amount: value },
            });
        }
    };

	const getDescriptor = () => {
		if (account instanceof SavedAccount) return "SAVINGS";
		if (account instanceof InvestedAccount) return "INVESTMENT";
		if (account instanceof PropertyAccount) return "PROPERTY";
		if (account instanceof DebtAccount) return "DEBT";
		return "ACCOUNT";
	};

	const getIconBg = () => {
		if (account instanceof SavedAccount) return ACCOUNT_COLORS_BACKGROUND["Saved"];
		if (account instanceof InvestedAccount) return ACCOUNT_COLORS_BACKGROUND["Invested"];
		if (account instanceof PropertyAccount) return ACCOUNT_COLORS_BACKGROUND["Property"];
		if (account instanceof DebtAccount) return ACCOUNT_COLORS_BACKGROUND["Debt"];
		return "bg-gray-500";
	};

	const getLinkedAccount = () => {
		if (account instanceof DebtAccount || account instanceof PropertyAccount){
			const linkedAccount = expenses.find((exp) => exp.id === account.linkedAccountId);
			return linkedAccount?.name;
		}
	}

    // Get display amount for collapsed view
    const getDisplayAmount = () => {
        return `$${account.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

	return (
		<div className="w-full">
            {/* Collapsed View */}
            {!isExpanded ? (
                <div
                    onClick={() => setIsExpanded(true)}
                    className="flex items-center gap-4 p-4 bg-[#18181b] rounded-xl border border-gray-800 cursor-pointer hover:border-gray-600 transition-colors"
                >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-md font-bold text-white flex-shrink-0`}>
                        {getDescriptor().slice(0, 1)}
                    </div>
                    <div className="font-semibold text-white truncate flex-1">
                        {account.name}
                    </div>
                    <div className="text-gray-300 text-sm whitespace-nowrap">
                        {getDisplayAmount()}
                    </div>
                    <ChevronIcon expanded={false} />
                </div>
            ) : (
                <>
                    {/* Expanded Header */}
                    <div className="flex gap-4 mb-4">
                        <div className={`w-8 h-8 mt-1 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-md font-bold text-white`}>
                            {getDescriptor().slice(0, 1)}
                        </div>
                        <div className="grow">
                            <NameInput
                                label=""
                                id={account.id}
                                value={account.name}
                                onChange={(val) => handleFieldUpdate("name", val)}
                            />
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                            <button
                                onClick={() => setIsHistoryOpen(true)}
                                className="text-gray-500 hover:text-white transition-colors p-1"
                                title="Edit History"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                            </button>
                            <div className="text-chart-Red-75">
                                <DeleteAccountControl accountId={account.id} />
                            </div>
                            <button
                                onClick={() => setIsExpanded(false)}
                                className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
                            >
                                <ChevronIcon expanded={true} />
                            </button>
                        </div>
                    </div>

                    {/* Expanded Content */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
				<CurrencyInput
					id={`${account.id}-amount`}
					label="Current Amount"
					value={account.amount}
					onChange={(val) => handleFieldUpdate("amount", val)}
				/>

				{account instanceof SavedAccount && (
					<PercentageInput
						id={`${account.id}-apr`}
						label="APR"
						value={account.apr}
						onChange={(val) => handleFieldUpdate("apr", val)}
					/>
				)}

				{account instanceof InvestedAccount && (
					<>
						<PercentageInput
							id={`${account.id}-expense-ratio`}
							label="Expense Ratio"
							value={account.expenseRatio}
							onChange={(val) => handleFieldUpdate("expenseRatio", val)}
							tooltip="Annual fee charged by the fund. Example: 0.15% = $15 per $10,000 invested per year."
						/>
						<StyledSelect
							id={`${account.id}-tax-type`}
							label="Tax Type"
							value={account.taxType}
							onChange={(e) => handleFieldUpdate("taxType", e.target.value)}
							options={TaxTypeEnum as any}
							tooltip="Tax treatment: Brokerage (taxable), Traditional (pre-tax, taxed on withdrawal), Roth (post-tax, tax-free growth)."
						/>
						{(account.taxType === 'Roth 401k' || account.taxType === 'Traditional 401k') && (
							<>
								<CurrencyInput
									id={`${account.id}-employer-balance`}
									label="Employer Balance"
									value={account.employerBalance}
									onChange={(val) => handleFieldUpdate("employerBalance", val)}
									tooltip="Amount contributed by your employer (401k match). Subject to vesting schedule."
								/>
								<NumberInput
									id={`${account.id}-tenure-years`}
									label="Tenure (Years)"
									value={account.tenureYears}
									onChange={(val) => handleFieldUpdate("tenureYears", val)}
									tooltip="Years you've worked at this employer. Used to calculate vested amount."
								/>
								<StyledDisplay
									label="Non-Vested Amount"
									value={account.nonVestedAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
									tooltip="Employer contributions you'd lose if you left today."
								/>
								<StyledDisplay
									label="Vested Amount"
									value={account.vestedAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
									tooltip="Employer contributions that are yours to keep."
								/>
							</>
						)}
						<PercentageInput
							id={`${account.id}-vested-per-year`}
							label="Vesting Schedule (per year)"
							value={account.vestedPerYear}
							onChange={(val) => handleFieldUpdate("vestedPerYear", val)}
							tooltip="Percentage of employer match that vests each year. Example: 20% means fully vested after 5 years."
						/>
						<ToggleInput
							id={`${account.id}-contribution-eligible`}
							label="Contribution Eligible"
							enabled={account.isContributionEligible}
							setEnabled={(val) => handleFieldUpdate("isContributionEligible", val)}
							tooltip="Can you still contribute to this account? Turn off for accounts from previous employers."
						/>
					</>
				)}

				{account instanceof PropertyAccount && (
					<>
						<StyledSelect
							id={`${account.id}-status`}
							label="Status"
							value={account.ownershipType}
							onChange={(e) => handleFieldUpdate("ownershipType", e.target.value)}
							options={["Financed", "Owned"]}
						/>
						{account.ownershipType === "Financed" && (
							<>
								<CurrencyInput
									id={`${account.id}-loan-amount`}
									label="Loan Amount"
									value={account.loanAmount}
									onChange={(val) => handleFieldUpdate("loanAmount", val)}
								/>
								<CurrencyInput
									id={`${account.id}-starting-loan-balance`}
									label="Starting Loan Balance"
									value={account.startingLoanBalance}
									onChange={(val) => handleFieldUpdate("startingLoanBalance", val)}
								/>
							</>
						)}
						<StyledDisplay
							label="Linked to Expense"
							blankValue="No expense found, try re-adding"
							value={getLinkedAccount()}
						/>
					</>
				)}
				{account instanceof DebtAccount && (
					<>
						<PercentageInput
							id={`${account.id}-apr`}
							label="APR"
							value={account.apr}
							onChange={(val) => handleFieldUpdate("apr", val)}
						/>
						<StyledDisplay
							label="Linked to Expense"
							blankValue="No expense found, try re-adding"
							value={getLinkedAccount()}
						/>
					</>
				)}
			        </div>
                </>
            )}
			<EditHistoryModal
                accountId={account.id}
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
            />
		</div>
	);
};

export default AccountCard;