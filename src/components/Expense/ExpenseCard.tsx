import React, { useContext, useState, useEffect } from "react";
import { 
    AnyExpense, 
    HousingExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
	IncomeDeductionExpense,
	TransportExpense,
    OtherExpense,
	EXPENSE_COLORS_BACKGROUND
} from './models';
import { ExpenseContext, AllExpenseKeys } from "./ExpenseContext";
import { StyledInput, StyledSelect } from "../Layout/StyleUI";
import DeleteExpenseControl from './DeleteExpenseUI';
import { IncomeContext } from "../Income/IncomeContext";

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
	const { dispatch: expenseDispatch } = useContext(ExpenseContext);
	const { incomes } = useContext(IncomeContext);
	const [focusedField, setFocusedField] = useState<string | null>(null);
	
    // We only need local state for the amount field to handle currency formatting while typing
    const [localAmount, setLocalAmount] = useState<string>("0.00");
	const isHousing = expense instanceof HousingExpense;

	useEffect(() => {
        if (focusedField !== "amount") {
            const val = isHousing ? (expense as HousingExpense).payment : expense.amount;
            setLocalAmount(formatCurrency(val));
        }
    }, [expense.amount, (expense as any).payment, focusedField, isHousing]);

	const handleGlobalUpdate = (field: AllExpenseKeys, value: any) => {
		expenseDispatch({
			type: "UPDATE_EXPENSE_FIELD",
			payload: { id: expense.id, field, value },
		});
		
		expenseDispatch({
			type: "UPDATE_EXPENSE_FIELD",
			payload: { id: expense.id, field, value },
		});
	};

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setLocalAmount(e.target.value);
    };

    const handleAmountBlur = () => {
        setFocusedField(null);
        const numericValue = parseFloat(localAmount.replace(/[^0-9.]/g, ""));

        if (!isNaN(numericValue)) {
            // Update 'payment' for housing, otherwise 'amount'
            handleGlobalUpdate(isHousing ? "payment" : "amount", numericValue);
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
		if (expense instanceof HousingExpense) return "HOUSING";
		if (expense instanceof LoanExpense) return "LOAN";
		if (expense instanceof DependentExpense) return "DEPENDENT";
		if (expense instanceof HealthcareExpense) return "HEALTHCARE";
		if (expense instanceof VacationExpense) return "VACATION";
		if (expense instanceof EmergencyExpense) return "EMERGENCY";
		if (expense instanceof IncomeDeductionExpense) return "INCOME";
		if (expense instanceof TransportExpense) return "TRANSPORT";
		if (expense instanceof OtherExpense) return "OTHER";
		return "EXPENSE";
	};

	const getIconBg = () => {
		if (expense instanceof HousingExpense) return EXPENSE_COLORS_BACKGROUND["Housing"];
		if (expense instanceof LoanExpense) return EXPENSE_COLORS_BACKGROUND["Loan"];
		if (expense instanceof DependentExpense) return EXPENSE_COLORS_BACKGROUND["Dependent"];
		if (expense instanceof HealthcareExpense) return EXPENSE_COLORS_BACKGROUND["Healthcare"];
		if (expense instanceof VacationExpense) return EXPENSE_COLORS_BACKGROUND["Vacation"];
		if (expense instanceof EmergencyExpense) return EXPENSE_COLORS_BACKGROUND["Emergency"];
		if (expense instanceof IncomeDeductionExpense) return EXPENSE_COLORS_BACKGROUND["IncomeDeduction"];
		if (expense instanceof TransportExpense) return EXPENSE_COLORS_BACKGROUND["Transport"];
		if (expense instanceof OtherExpense) return EXPENSE_COLORS_BACKGROUND["Other"];
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
				<div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-sm font-bold text-white`}>
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
				{!(expense instanceof LoanExpense) && (
					<div className="text-chart-Red-75 ml-auto">
						<DeleteExpenseControl expenseId={expense.id} linkedId="" />
					</div>
				)}
				{(expense instanceof LoanExpense) && (
					<div className="text-chart-Red-75 ml-auto">
						<DeleteExpenseControl expenseId={expense.id} linkedId={expense.linkedAccountId} />
					</div>
				)}
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {/* Common Fields */}
				<StyledInput
					label={isHousing ? "Payment ($)" : "Amount ($)"}
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
                    options={["Daily", "Weekly", "BiWeekly", "Monthly", "Annually"]}
                />

                <StyledInput
                    label="Inflation (%)"
                    type="number"
                    value={expense.inflation}
                    onChange={(e) => handleGlobalUpdate("inflation", Number(e.target.value))}
                />

                {/* --- Specialized Housing Fields --- */}
                {isHousing && (
					<>
						<StyledInput label="Utilities ($)" type="number" value={expense.utilities} onChange={(e) => handleGlobalUpdate("utilities", Number(e.target.value))} />
						<StyledInput label="Property Taxes ($)" type="number" value={expense.property_taxes} onChange={(e) => handleGlobalUpdate("property_taxes", Number(e.target.value))} />
						<StyledInput label="Maintenance ($)" type="number" value={expense.maintenance} onChange={(e) => handleGlobalUpdate("maintenance", Number(e.target.value))} />
						<div className="text-xs text-gray-500 italic mt-1">
							Total Housing Amount: ${formatCurrency(expense.amount)}
						</div>
					</>
				)}

                {/* --- Specialized Loan Fields --- */}
                {expense instanceof LoanExpense && (
    			<>
					<StyledInput 
						label="APR (%)" 
						type="number" 
						value={expense.apr} 
						onChange={(e) => handleGlobalUpdate("apr", Number(e.target.value))} 
					/>
					<StyledSelect 
						label="Interest Type" 
						value={expense.interest_type} 
						onChange={(e) => handleGlobalUpdate("interest_type", e.target.value)} 
						options={["Simple", "Compounding"]} 
					/>
					<StyledInput 
						label="Start Date" 
						type="date" 
						value={formatDate(expense.start_date)} 
						onChange={(e) => handleDateChange("start_date", e.target.value)} 
					/>
					<StyledInput 
						label="Payment ($)" 
						type="number" 
						value={expense.payment} 
						onChange={(e) => handleGlobalUpdate("payment", Number(e.target.value))} 
					/>
					<StyledSelect 
						label="Tax Deductible" 
						value={expense.is_tax_deductible} 
						onChange={(e) => handleGlobalUpdate("is_tax_deductible", e.target.value)} 
						options={["Yes", "No"]} 
					/>
					{(expense.is_tax_deductible === 'Yes') && (
						<StyledInput 
							label="Deductible Amount ($)" 
							type="number" 
							value={expense.tax_deductible} 
							onChange={(e) => handleGlobalUpdate("tax_deductible", Number(e.target.value))} 
						/>
					)}
				</>
			)}

            {expense instanceof DependentExpense && (
				<>
					<StyledInput 
						label="Start Date" 
						type="date" 
						value={formatDate(expense.start_date)} 
						onChange={(e) => handleDateChange("start_date", e.target.value)} 
					/>
					<StyledInput 
						label="End Date" 
						type="date" 
						value={formatDate(expense.end_date)} 
						onChange={(e) => handleDateChange("end_date", e.target.value)} 
					/>
					<StyledSelect 
						label="Tax Deductible" 
						value={expense.is_tax_deductible} 
						onChange={(e) => handleGlobalUpdate("is_tax_deductible", e.target.value)} 
						options={["Yes", "No"]} 
					/>
					{(expense.is_tax_deductible === 'Yes') && (
						<StyledInput 
							label="Deductible Amount ($)" 
							type="number" 
							value={expense.tax_deductible} 
							onChange={(e) => handleGlobalUpdate("tax_deductible", Number(e.target.value))} 
						/>
					)}
				</>
			)}

			{expense instanceof IncomeDeductionExpense && (
				<StyledSelect
					label="Linked Income Source"
					// Display the name of the currently linked income
					value={expense.income.name} 
					onChange={(e) => {
						// Find the full income object by the selected name
						const selectedInc = incomes.find(inc => inc.name === e.target.value);
						if (selectedInc) {
							handleGlobalUpdate("income", selectedInc);
						}
					}}
					// Map all income names into the dropdown options
					options={incomes.map(inc => inc.name)}
				/>
			)}
			</div>
		</div>
	);
};

export default ExpenseCard;