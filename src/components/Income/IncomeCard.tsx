import React, { useContext, useState, useEffect } from "react";
import { 
    AnyIncome, 
    WorkIncome, 
    SocialSecurityIncome, 
    PassiveIncome, 
    WindfallIncome, 
    RSUIncome,
    INCOME_COLORS_BACKGROUND 
} from "./models";
import { IncomeContext, AllIncomeKeys } from "./IncomeContext";
import { StyledInput, StyledSelect } from "../Layout/StyleUI";
import DeleteIncomeControl from './DeleteIncomeUI';

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

// Helper to format Date objects to YYYY-MM-DD for input fields
const formatDate = (date: Date): string => {
    if (!date) return "";
    try {
        return date.toISOString().split('T')[0];
    } catch (e) {
        return "";
    }
};

const IncomeCard = ({ income }: { income: AnyIncome }) => {
	const { dispatch } = useContext(IncomeContext);
	const [focusedField, setFocusedField] = useState<string | null>(null);
	
    // We only need local state for the amount field to handle currency formatting while typing
    const [localAmount, setLocalAmount] = useState<string>("0.00");

	useEffect(() => {
		if (focusedField !== "amount") {
			setLocalAmount(formatCurrency(income.amount));
		}
	}, [income.amount, focusedField]);

	const handleGlobalUpdate = (field: AllIncomeKeys, value: any) => {
		dispatch({
			type: "UPDATE_INCOME_FIELD",
			payload: { id: income.id, field, value },
		});
	};

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalAmount(e.target.value);
    };

    const handleAmountBlur = () => {
        setFocusedField(null);
        const cleanNumericValue = localAmount.replace(/[^0-9.]/g, "");
		const numericValue = parseFloat(cleanNumericValue);

		if (!isNaN(numericValue)) {
            handleGlobalUpdate("amount", numericValue);
            setLocalAmount(formatCurrency(numericValue));
        }
    };

    const handleAmountFocus = () => {
        setFocusedField("amount");
        const cleanString = localAmount.replace("$", "").replace(/,/g, "");
        setLocalAmount(cleanString);
    };

    const handleDateChange = (field: AllIncomeKeys, dateString: string) => {
        if (!dateString) return;
        // Create date as UTC or local? Usually inputs return YYYY-MM-DD. 
        // new Date(dateString) creates a date in UTC if YYYY-MM-DD is passed? 
        // Actually new Date("2023-01-01") is treated as UTC usually. 
        // But for simplicity in this app, simple parsing is often enough.
        const newDate = new Date(dateString);
        handleGlobalUpdate(field, newDate);
    };

	const getDescriptor = () => {
		if (income instanceof WorkIncome) return "WORK";
		if (income instanceof SocialSecurityIncome) return "SS";
		if (income instanceof PassiveIncome) return "PASSIVE";
		if (income instanceof WindfallIncome) return "WINDFALL";
        if (income instanceof RSUIncome) return "RSU";
		return "INCOME";
	};

	const getIconBg = () => {
		if (income instanceof WorkIncome) return INCOME_COLORS_BACKGROUND["Work"];
		if (income instanceof SocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
		if (income instanceof PassiveIncome) return INCOME_COLORS_BACKGROUND["Passive"];
		if (income instanceof WindfallIncome) return INCOME_COLORS_BACKGROUND["Windfall"];
        if (income instanceof RSUIncome) return INCOME_COLORS_BACKGROUND["RSU"];
		return "bg-gray-500";
	};

	const getLocalAmountValue = () => {
		let value = localAmount;
		if (focusedField !== "amount") {
			if (!isFullyFormatted(value)) {
				value = formatCurrency(parseFloat(value) || 0);
			}
		} 
        // If focused, we just show the raw string (handled in handleAmountFocus)
		return focusedField === "amount" ? value : `$${value}`;
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
						value={income.name}
						onChange={(e) => handleGlobalUpdate("name", e.target.value)}
						className="text-xl font-bold text-white bg-transparent focus:outline-none focus:ring-1 focus:ring-green-300 rounded p-1 -m-1 w-full" 
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteIncomeControl incomeId={income.id} />
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {/* Common Fields */}
				<StyledInput
					label="Amount ($)"
					type="text"
					value={getLocalAmountValue()}
					onChange={handleAmountChange}
					onFocus={handleAmountFocus}
					onBlur={handleAmountBlur}
				/>
                
                <StyledSelect
                    label="Frequency"
                    value={income.frequency}
                    onChange={(e) => handleGlobalUpdate("frequency", e.target.value)}
                    options={["Weekly", "BiWeekly", "Monthly", "Annually"]}
                />

                <StyledInput
                    label="End Date"
                    type="date"
                    value={formatDate(income.endDate)}
                    onChange={(e) => handleDateChange("endDate", e.target.value)}
                />

				{income instanceof SocialSecurityIncome && (
					<StyledInput
						label="Claiming Age"
						type="number"
						value={income.claimingAge}
						onChange={(e) => handleGlobalUpdate("claimingAge", parseFloat(e.target.value))}
					/>
				)}

                {income instanceof PassiveIncome && (
                    <StyledSelect
                        label="Source Type"
                        value={income.sourceType}
                        onChange={(e) => handleGlobalUpdate("sourceType", e.target.value)}
                        options={["Dividend", "Rental", "Royalty", "Other"]}
                    />
                )}

                {income instanceof WindfallIncome && (
                     <StyledInput
                        label="Receipt Date"
                        type="date"
                        value={formatDate(income.receiptDate)}
                        onChange={(e) => handleDateChange("receiptDate", e.target.value)}
                    />
                )}

                {income instanceof RSUIncome && (
                     <StyledInput
                        label="Vesting Date"
                        type="date"
                        value={formatDate(income.vestingDate)}
                        onChange={(e) => handleDateChange("vestingDate", e.target.value)}
                    />
                )}
			</div>
		</div>
	);
};

export default IncomeCard;