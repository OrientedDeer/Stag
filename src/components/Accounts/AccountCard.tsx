import { useContext, useState } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, PropertyAccount, DebtAccount, ACCOUNT_COLORS_BACKGROUND} from "./models";
import { AccountContext, AllAccountKeys } from "./AccountContext";
import { ExpenseContext } from "../Expense/ExpenseContext";
import { StyledSelect } from "../Layout/StyleUI";
import { CurrencyInput } from "../Layout/CurrencyInput"; // Import your new component
import DeleteAccountControl from '../../components/Accounts/DeleteAccountUI';
import { EditHistoryModal } from "./EditHistoryModal";

const AccountCard = ({ account }: { account: AnyAccount }) => {
	const { dispatch: accountDispatch } = useContext(AccountContext);
	const { dispatch: expenseDispatch } = useContext(ExpenseContext);
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
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: "amount", value },
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

	return (
		<div className="w-full">
			<div className="flex gap-4 mb-4">
				<div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-md font-bold text-white`}>
					{getDescriptor().slice(0, 1)}
				</div>
				<div className="grow"> 
					<input
						type="text"
						value={account.name}
						onChange={(e) => handleFieldUpdate("name", e.target.value)}
						className="text-xl font-bold text-white bg-transparent focus:outline-none focus:ring-1 focus:ring-green-300 rounded p-1 -m-1 w-full" 
					/>
				</div>
				<div className="flex items-center gap-2 ml-auto">
                    <button 
                        onClick={() => setIsHistoryOpen(true)}
                        className="text-gray-500 hover:text-white transition-colors p-1"
                        title="Edit History"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </button>
                    <div className="text-chart-Red-75">
                        <DeleteAccountControl accountId={account.id} />
                    </div>
                </div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
				<CurrencyInput
					label="Current Amount"
					value={account.amount}
					onChange={(val) => handleFieldUpdate("amount", val)}
				/>

				{account instanceof InvestedAccount && (
					<CurrencyInput
						label="Employer Contrib."
						value={account.vestedAmount}
						onChange={(val) => handleFieldUpdate("vestedAmount", val)}
					/>
				)}

				{account instanceof PropertyAccount && (
					<>
						<StyledSelect
							label="Status"
							value={account.ownershipType}
							onChange={(e) => handleFieldUpdate("ownershipType", e.target.value)}
							options={["Financed", "Owned"]}
						/>
						{account.ownershipType === "Financed" && (
							<CurrencyInput
								label="Loan Amount"
								value={account.loanAmount}
								onChange={(val) => handleFieldUpdate("loanAmount", val)}
							/>
						)}
					</>
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