import { useContext } from "react";
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
import { IncomeContext } from "../Income/IncomeContext";
import { AccountContext } from "../Accounts/AccountContext"; // Import Account Context for syncing
import { StyledInput, StyledSelect } from "../Layout/StyleUI";
import { CurrencyInput } from "../Layout/CurrencyInput"; // Import new component
import DeleteExpenseControl from './DeleteExpenseUI';

// Helper to format Date objects to YYYY-MM-DD
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
    const { dispatch: accountDispatch } = useContext(AccountContext);
	const { incomes } = useContext(IncomeContext);

	const isHousing = expense instanceof HousingExpense;

    // --- UNIFIED UPDATER ---
	const handleFieldUpdate = (field: AllExpenseKeys, value: any) => {
        // 1. Update Expense
		expenseDispatch({
			type: "UPDATE_EXPENSE_FIELD",
			payload: { id: expense.id, field, value },
		});

        // 2. Sync Logic (Loan Expense -> Debt Account)
        if (expense instanceof LoanExpense && expense.linkedAccountId) {
            const accId = expense.linkedAccountId;
            
            if (field === 'name') {
                accountDispatch({ type: 'UPDATE_ACCOUNT_FIELD', payload: { id: accId, field: 'name', value }});
            }
            if (field === 'amount') {
                 // Sync monthly payment on account side
                accountDispatch({ type: 'UPDATE_ACCOUNT_FIELD', payload: { id: accId, field: 'amount', value }});
            }
        }
	};

    const handleDateChange = (field: AllExpenseKeys, dateString: string) => {
        if (!dateString) return;
        handleFieldUpdate(field, new Date(dateString));
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
						onChange={(e) => handleFieldUpdate("name", e.target.value)}
						className="text-xl font-bold text-white bg-transparent focus:outline-none focus:ring-1 focus:ring-green-300 rounded p-1 -m-1 w-full" 
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteExpenseControl expenseId={expense.id}/>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {/* Logic for Housing: 
                    Housing expenses calculate 'amount' as a sum of parts.
                    The main field edits 'payment' (Rent/Mortgage).
                    Other types edit 'amount' directly.
                */}
				<CurrencyInput
					label={isHousing ? "Rent/Mortgage Payment" : "Amount"}
					value={isHousing ? (expense as HousingExpense).payment : expense.amount}
					onChange={(val) => handleFieldUpdate(isHousing ? "payment" : "amount", val)}
				/>
                
                <StyledSelect
                    label="Frequency"
                    value={expense.frequency}
                    onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                    options={["Daily", "Weekly", "BiWeekly", "Monthly", "Annually"]}
                />
                
				{(expense instanceof HousingExpense ||
					expense instanceof DependentExpense ||
					expense instanceof HealthcareExpense ||
					expense instanceof VacationExpense ||
					expense instanceof IncomeDeductionExpense ||
					expense instanceof TransportExpense
				) && (
					<StyledInput
						label="Inflation (%)"
						type="number"
						value={expense.inflation}
						onChange={(e) => handleFieldUpdate("inflation", Number(e.target.value))}
					/>
				)}

                {/* --- Specialized Housing Fields --- */}
                {isHousing && (
					<>
                        <CurrencyInput
                            label="Utilities"
                            value={expense.utilities}
                            onChange={(val) => handleFieldUpdate("utilities", val)}
                        />
                         <CurrencyInput
                            label="Property Taxes"
                            value={expense.property_taxes}
                            onChange={(val) => handleFieldUpdate("property_taxes", val)}
                        />
                         <CurrencyInput
                            label="Maintenance"
                            value={expense.maintenance}
                            onChange={(val) => handleFieldUpdate("maintenance", val)}
                        />
						<div className="text-xs text-gray-500 italic mt-1">
							Total: ${expense.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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
						onChange={(e) => handleFieldUpdate("apr", Number(e.target.value))} 
					/>
					<StyledSelect 
						label="Interest Type" 
						value={expense.interest_type} 
						onChange={(e) => handleFieldUpdate("interest_type", e.target.value)} 
						options={["Simple", "Compounding"]} 
					/>
					<StyledInput 
						label="Start Date" 
						type="date" 
						value={formatDate(expense.start_date)} 
						onChange={(e) => handleDateChange("start_date", e.target.value)} 
					/>
                    <CurrencyInput
                        label="Payment"
                        value={expense.payment}
                        onChange={(val) => handleFieldUpdate("payment", val)}
                    />
					<StyledSelect 
						label="Tax Deductible" 
						value={expense.is_tax_deductible} 
						onChange={(e) => handleFieldUpdate("is_tax_deductible", e.target.value)} 
						options={["Yes", "No"]} 
					/>
					{(expense.is_tax_deductible === 'Yes') && (
                        <CurrencyInput
                            label="Deductible Amount"
                            value={expense.tax_deductible}
                            onChange={(val) => handleFieldUpdate("tax_deductible", val)}
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
						onChange={(e) => handleFieldUpdate("is_tax_deductible", e.target.value)} 
						options={["Yes", "No"]} 
					/>
					{(expense.is_tax_deductible === 'Yes') && (
                        <CurrencyInput
                            label="Deductible Amount"
                            value={expense.tax_deductible}
                            onChange={(val) => handleFieldUpdate("tax_deductible", val)}
                        />
					)}
				</>
			)}

			{expense instanceof IncomeDeductionExpense && (
				<StyledSelect
					label="Linked Income Source"
					value={expense.income.name} 
					onChange={(e) => {
						const selectedInc = incomes.find(inc => inc.name === e.target.value);
						if (selectedInc) {
                            // Cast as AllExpenseKeys to satisfy Typescript union constraints
							handleFieldUpdate("income" as AllExpenseKeys, selectedInc);
						}
					}}
					options={incomes.map(inc => inc.name)}
				/>
			)}
			</div>
		</div>
	);
};

export default ExpenseCard;