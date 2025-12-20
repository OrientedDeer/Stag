import React, { useContext, useState, useEffect } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, PropertyAccount, DebtAccount, ACCOUNT_COLORS_BACKGROUND} from "./models";
import { AccountContext, AllAccountKeys } from "./AccountContext";
import { ExpenseContext } from "../Expense/ExpenseContext";
import { StyledInput, StyledSelect } from "../Layout/StyleUI";
import DeleteAccountControl from '../../components/Accounts/DeleteAccountUI';

const formatCurrency = (value: number | string): string => {
	if (value === null || value === undefined || value === 0 || value === "")
		return "0.00";
	const num = typeof value === "string" ? parseFloat(value) : value;
	if (isNaN(num)) return "0.00";

	return num.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
};
const isFullyFormatted = (value: string) =>
	value.includes(",") || value.includes("0.");

const AccountCard = ({ account }: { account: AnyAccount }) => {
	const { dispatch: accountDispatch } = useContext(AccountContext);
	const { dispatch: expenseDispatch } = useContext(ExpenseContext);
	const [focusedField, setFocusedField] = useState<string | null>(null);
	const [localCurrencyValues, setLocalCurrencyValues] = useState<
		Record<string, string>
	>({});
	useEffect(() => {
		if (!focusedField) {
			setLocalCurrencyValues({
				amount: formatCurrency(account.amount),
				vestedAmount:
					account instanceof InvestedAccount
						? formatCurrency(account.vestedAmount)
						: "0.00",
				loanAmount:
					account instanceof PropertyAccount
						? formatCurrency(account.loanAmount)
						: "0.00",
			});
		}
	}, [account, focusedField]);
	const handleGlobalUpdate = (field: AllAccountKeys, value: any = null) => {
		const stringValue = localCurrencyValues[field.toString()] || "0";
		const cleanNumericValue = stringValue.replace(/[^0-9.]/g, "");
		const numericValue = parseFloat(cleanNumericValue);
		
		const finalValue = value !== null ? value : /* retrieve from local state logic */ 0; 
        
		accountDispatch({
			type: "UPDATE_ACCOUNT_FIELD",
			payload: { id: account.id, field, value: finalValue },
		});

		if (account instanceof DebtAccount){
			if(field == "name"){
				expenseDispatch({
					type: "UPDATE_EXPENSE_FIELD",
					payload: { id: account.linkedAccountId, field, value },
				});
			} else if(field == "amount"){
				expenseDispatch({
					type: "UPDATE_EXPENSE_FIELD",
					payload: { id: account.linkedAccountId, field, value },
				});
			}
		}

		if (isNaN(numericValue)) return;
		accountDispatch({
			type: "UPDATE_ACCOUNT_FIELD",
			payload: { id: account.id, field, value: numericValue },
		});
		setLocalCurrencyValues((prev) => ({
			...prev,
			[field]: formatCurrency(numericValue),
		}));
	};
	const handleLocalChange = (
		e: React.ChangeEvent<HTMLInputElement>,
		field: AllAccountKeys
	) => {
		const rawValue = e.target.value;
		setLocalCurrencyValues((prev) => ({
			...prev,
			[field]: rawValue,
		}));
	};
	const handleBlurAmount = (field: AllAccountKeys) => {
		handleGlobalUpdate(field);
		setFocusedField(null);
		const numericValue =
			parseFloat(
				localCurrencyValues.amount.replace(/[^0-9.]/g, "").replace("$", "")
			) || 0;
		accountDispatch({
			type: "ADD_AMOUNT_SNAPSHOT",
			payload: { id: account.id, amount: numericValue },
		});
	};
	const handleBlur = (field: AllAccountKeys) => {
		handleGlobalUpdate(field);
		setFocusedField(null);
	};
	const handleFocus = (field: AllAccountKeys) => {
		setFocusedField(field.toString());
		const currentValue = localCurrencyValues[field.toString()] || "0.00";
		const cleanString = currentValue.replace("$", "").replace(/,/g, "");

		setLocalCurrencyValues((prev) => ({
			...prev,
			[field]: cleanString,
		}));
	};
	const handleUpdate = (field: AllAccountKeys, value: any) => {
		accountDispatch({
			type: "UPDATE_ACCOUNT_FIELD",
			payload: { id: account.id, field, value },
		});
	};
	const getDescriptor = () => {
		if (account instanceof SavedAccount) return "SAVINGS";
		if (account instanceof InvestedAccount) return "INVESTMENT";
		if (account instanceof PropertyAccount) return "PROPERTY";
		if (account instanceof DebtAccount) return "DEBT";
		return "ACCOUNT";
	};

	const getIconBg = () => {
		if (account instanceof SavedAccount)
			return ACCOUNT_COLORS_BACKGROUND["Saved"];
		if (account instanceof InvestedAccount)
			return ACCOUNT_COLORS_BACKGROUND["Invested"];
		if (account instanceof PropertyAccount)
			return ACCOUNT_COLORS_BACKGROUND["Property"];
		if (account instanceof DebtAccount)
			return ACCOUNT_COLORS_BACKGROUND["Debt"];
		return "bg-gray-500";
	};
	const getLocalValue = (field: string) => {
		let value = localCurrencyValues[field] || "";
		if (focusedField !== field) {
			if (!isFullyFormatted(value)) {
				value = formatCurrency(parseFloat(value) || 0);
			}
		} else {
			value = value.replace("$", "").replace(/,/g, "");
		}
		return `$${value}`;
	};

	return (
		<div className="w-full">
			<div className="flex gap-4 mb-4">
				<div
					className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-sm font-bold text-white`}
				>
					{getDescriptor().slice(0, 1)}
				</div>
				<div className="grow"> 
					<input
						type="text"
						value={account.name}
						onChange={(e) => handleUpdate("name", e.target.value)}
						className="text-xl font-bold text-white bg-transparent focus:outline-none focus:ring-1 focus:ring-green-300 rounded p-1 -m-1 w-full" 
					/>
				</div>
				{!(account instanceof DebtAccount) && (
					<div className="text-chart-Red-75 ml-auto">
						<DeleteAccountControl accountId={account.id} linkedId="" />
					</div>
				)}
				{(account instanceof DebtAccount) && (
					<div className="text-chart-Red-75 ml-auto">
						<DeleteAccountControl accountId={account.id} linkedId={account.linkedAccountId} />
					</div>
				)}
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
				<StyledInput
					label="Current Amount ($)"
					type="text"
					value={getLocalValue("amount")}
					onChange={(e) => handleLocalChange(e, "amount")}
					onFocus={() => handleFocus("amount")}
					onBlur={() => handleBlurAmount("amount")}
				/>
				{account instanceof InvestedAccount && (
					<StyledInput
						label="Employer Contrib. ($)"
						type="text"
						value={getLocalValue("vestedAmount")}
						onChange={(e) => handleLocalChange(e, "vestedAmount")}
						onFocus={() => handleFocus("vestedAmount")}
						onBlur={() => handleBlur("vestedAmount")}
					/>
				)}
				{account instanceof PropertyAccount && (
					<>
						<StyledSelect
							label="Status"
							value={account.ownershipType}
							onChange={(e) => handleUpdate("ownershipType", e.target.value)}
							options={["Financed", "Owned"]}
						/>
						{account.ownershipType === "Financed" && (
							<>
								<StyledInput
									label="Loan Amount ($)"
									type="text"
									value={getLocalValue("loanAmount")}
									onChange={(e) => handleLocalChange(e, "loanAmount")}
									onFocus={() => handleFocus("loanAmount")}
									onBlur={() => handleBlur("loanAmount")}
								/>
							</>
						)}
					</>
				)}
			</div>
		</div>
	);
};

export default AccountCard;
