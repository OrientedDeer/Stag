import React, { useContext, useState, useEffect } from "react";
import { 
    AnyExpense, 
    DefaultExpense,
    EXPENSE_COLORS_BACKGROUND, 
	SecondaryExpense
} from "./models";
import { ExpenseContext, AllExpenseKeys } from "./ExpenseContext";
import { StyledInput, StyledSelect } from "../Layout/StyleUI";
import DeleteExpenseControl from './DeleteExpenseUI';

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

const ExpenseCard = ({ expense }: { expense: AnyExpense }) => {
	const { dispatch } = useContext(ExpenseContext);
	const [focusedField, setFocusedField] = useState<string | null>(null);
	
    // We only need local state for the amount field to handle currency formatting while typing
    const [localAmount, setLocalAmount] = useState<string>("0.00");

	useEffect(() => {
		if (focusedField !== "amount") {
			setLocalAmount(formatCurrency(expense.amount));
		}
	}, [expense.amount, focusedField]);

	const handleGlobalUpdate = (field: AllExpenseKeys, value: any) => {
		dispatch({
			type: "UPDATE_EXPENSE_FIELD",
			payload: { id: expense.id, field, value },
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

    const handleDateChange = (field: AllExpenseKeys, dateString: string) => {
        if (!dateString) return;
        // Create date as UTC or local? Usually inputs return YYYY-MM-DD. 
        // new Date(dateString) creates a date in UTC if YYYY-MM-DD is passed? 
        // Actually new Date("2023-01-01") is treated as UTC usually. 
        // But for simplicity in this app, simple parsing is often enough.
        const newDate = new Date(dateString);
        handleGlobalUpdate(field, newDate);
    };

	const getDescriptor = () => {
		if (expense instanceof DefaultExpense) return "DEFAULT";
		if (expense instanceof SecondaryExpense) return "SECONDARY";
		return "EXPENSE";
	};

	const getIconBg = () => {
		if (expense instanceof DefaultExpense) return EXPENSE_COLORS_BACKGROUND["Default"];
		if (expense instanceof SecondaryExpense) return EXPENSE_COLORS_BACKGROUND["Secondary"];
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
						value={expense.name}
						onChange={(e) => handleGlobalUpdate("name", e.target.value)}
						className="text-xl font-bold text-white bg-transparent focus:outline-none focus:ring-1 focus:ring-green-300 rounded p-1 -m-1 w-full" 
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteExpenseControl expenseId={expense.id} />
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
                    value={expense.frequency}
                    onChange={(e) => handleGlobalUpdate("frequency", e.target.value)}
                    options={["Weekly", "BiWeekly", "Monthly", "Annually"]}
                />

                <StyledInput
                    label="End Date"
                    type="date"
                    value={formatDate(expense.endDate)}
                    onChange={(e) => handleDateChange("endDate", e.target.value)}
                />
			</div>
		</div>
	);
};

export default ExpenseCard;