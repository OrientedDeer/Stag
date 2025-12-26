import { useContext, useState } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, PropertyAccount, DebtAccount, ACCOUNT_COLORS_BACKGROUND} from "./models";
import { AccountContext, AllAccountKeys } from "./AccountContext";
import { ExpenseContext } from "../Expense/ExpenseContext";
import { StyledSelect, StyledDisplay } from "../Layout/StyleUI";
import { CurrencyInput } from "../Layout/CurrencyInput"; // Import your new component
import DeleteAccountControl from '../../components/Accounts/DeleteAccountUI';
import { EditHistoryModal } from "./EditHistoryModal";
import { NameInput } from "../Layout/NameInput";

const AccountCard = ({ account }: { account: AnyAccount }) => {
	const { dispatch: accountDispatch } = useContext(AccountContext);
	const { expenses, dispatch: expenseDispatch } = useContext(ExpenseContext);
	const [isHistoryOpen, setIsHistoryOpen] = useState(false);

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

	return (
		<div className="w-full">
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
                </div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
				<CurrencyInput
					id={`${account.id}-amount`}
					label="Current Amount"
					value={account.amount}
					onChange={(val) => handleFieldUpdate("amount", val)}
				/>

				{account instanceof InvestedAccount && (
					<CurrencyInput
						id={`${account.id}-non-vested-amount`}
						label="Non-Vested Contrib."
						value={account.NonVestedAmount}
						onChange={(val) => handleFieldUpdate("NonVestedAmount", val)}
					/>
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
					<StyledDisplay
						label="Linked to Expense"
						blankValue="No expense found, try re-adding"
						value={getLinkedAccount()}
					/>
				)}
			</div>
			<EditHistoryModal 
                accountId={account.id} 
                isOpen={isHistoryOpen} 
                onClose={() => setIsHistoryOpen(false)} 
            />
		</div>
	);
};

export default AccountCard;