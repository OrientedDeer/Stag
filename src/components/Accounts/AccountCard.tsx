import React, { useContext, useState, useEffect } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, PropertyAccount, DebtAccount} from "./models";
import { AccountContext, AllAccountKeys } from "./AccountContext";
import { StyledInput, StyledSelect } from "./AccountUI";
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
	const { dispatch } = useContext(AccountContext);
	const [focusedField, setFocusedField] = useState<string | null>(null);
	const [localCurrencyValues, setLocalCurrencyValues] = useState<
		Record<string, string>
	>({});
	useEffect(() => {
		if (!focusedField) {
			setLocalCurrencyValues({
				balance: formatCurrency(account.balance),
				vestedBalance:
					account instanceof InvestedAccount
						? formatCurrency(account.vestedBalance)
						: "0.00",
				loanBalance:
					account instanceof PropertyAccount
						? formatCurrency(account.loanBalance)
						: "0.00",
				monthlyPayment:
					account instanceof DebtAccount ||
					(account instanceof PropertyAccount &&
						account.ownershipType === "Financed")
						? formatCurrency(account.monthlyPayment)
						: "0.00",
			});
		}
	}, [account, focusedField]);
	const handleGlobalUpdate = (field: AllAccountKeys) => {
		const stringValue = localCurrencyValues[field.toString()] || "0";
		const cleanNumericValue = stringValue.replace(/[^0-9.]/g, "");
		const numericValue = parseFloat(cleanNumericValue);

		if (isNaN(numericValue)) return;
		dispatch({
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
	const handleBlurBalance = (field: AllAccountKeys) => {
		handleGlobalUpdate(field);
		setFocusedField(null);
		const numericValue =
			parseFloat(
				localCurrencyValues.balance.replace(/[^0-9.]/g, "").replace("$", "")
			) || 0;
		dispatch({
			type: "ADD_BALANCE_SNAPSHOT",
			payload: { id: account.id, balance: numericValue },
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
		dispatch({
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

	const ACCOUNT_CATEGORIES = ["Saved", "Invested", "Property", "Debt"] as const;
	type AccountCategory = (typeof ACCOUNT_CATEGORIES)[number];
	const ACCOUNT_COLORS_BACKGROUND: Record<AccountCategory, string> = {
		Saved: "bg-chart-Fuchsia-50",
		Invested: "bg-chart-Blue-50",
		Property: "bg-chart-Yellow-50",
		Debt: "bg-chart-Red-50",
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
		<div className="mb-8">
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
						autoFocus
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteAccountControl accountId={account.id} />
				</div>
			</div>
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
				<StyledInput
					label="Current Balance ($)"
					type="text"
					value={getLocalValue("balance")}
					onChange={(e) => handleLocalChange(e, "balance")}
					onFocus={() => handleFocus("balance")}
					onBlur={() => handleBlurBalance("balance")}
				/>
				{account instanceof InvestedAccount && (
					<StyledInput
						label="Employer Contrib. ($)"
						type="text"
						value={getLocalValue("vestedBalance")}
						onChange={(e) => handleLocalChange(e, "vestedBalance")}
						onFocus={() => handleFocus("vestedBalance")}
						onBlur={() => handleBlur("vestedBalance")}
					/>
				)}
				{account instanceof DebtAccount && (
					<>
						<StyledInput
							label="APR (%)"
							type="number"
							value={account.apr}
							onChange={(e) => handleUpdate("apr", parseFloat(e.target.value))}
						/>
						<StyledInput
							label="Monthly Payment ($)"
							type="text"
							value={getLocalValue("monthlyPayment")}
							onChange={(e) => handleLocalChange(e, "monthlyPayment")}
							onFocus={() => handleFocus("monthlyPayment")}
							onBlur={() => handleBlur("monthlyPayment")}
						/>
						<StyledSelect
							label="Interest Type"
							value={account.interestType}
							onChange={(e) => handleUpdate("interestType", e.target.value)}
							options={["Simple", "Compound"]}
						/>
					</>
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
									label="Loan Balance ($)"
									type="text"
									value={getLocalValue("loanBalance")}
									onChange={(e) => handleLocalChange(e, "loanBalance")}
									onFocus={() => handleFocus("loanBalance")}
									onBlur={() => handleBlur("loanBalance")}
								/>
								<StyledInput
									label="APR (%)"
									type="number"
									value={account.apr}
									onChange={(e) =>
										handleUpdate("apr", parseFloat(e.target.value))
									}
								/>
								<StyledInput
									label="Monthly Payment ($)"
									type="text"
									value={getLocalValue("monthlyPayment")}
									onChange={(e) => handleLocalChange(e, "monthlyPayment")}
									onFocus={() => handleFocus("monthlyPayment")}
									onBlur={() => handleBlur("monthlyPayment")}
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
