import { useContext } from "react";
import { 
    AnyExpense, 
    RentExpense,
	MortgageExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
	TransportExpense,
	FoodExpense,
    OtherExpense,
	EXPENSE_COLORS_BACKGROUND
} from './models';
import { ExpenseContext, AllExpenseKeys } from "./ExpenseContext";
import { AccountContext } from "../Accounts/AccountContext"; // Import Account Context for syncing
import { StyledDisplay, StyledInput, StyledSelect } from "../Layout/StyleUI";
import { CurrencyInput } from "../Layout/CurrencyInput"; // Import new component
import DeleteExpenseControl from './DeleteExpenseUI';
import { PercentageInput } from "../Layout/PercentageInput";
import { NumberInput } from "../Layout/NumberInput";
import { NameInput } from "../Layout/NameInput";

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

	const isHousing = expense instanceof RentExpense || expense instanceof MortgageExpense;

	// --- Equity and PMI Warning Logic ---
    let showPmiWarning = false;
    if (expense instanceof MortgageExpense && expense.valuation > 0) {
        const equity = (expense.valuation - expense.loan_balance) / expense.valuation;
        if (equity > 0.2 && expense.pmi > 0) {
            showPmiWarning = true;
        }
    }
	
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

		if (expense instanceof MortgageExpense) {
			// Create a temporary clone with the new value to calculate the new payment
			const updatedExpense = Object.assign(Object.create(Object.getPrototypeOf(expense)), expense);
			(updatedExpense as any)[field] = value;

			// Recalculate payment using the model's logic
			if (typeof (updatedExpense as any).calculatePayment === 'function') {
				const newPayment = (updatedExpense as any).calculatePayment();
				if (newPayment !== expense.payment) {
					expenseDispatch({
						type: "UPDATE_EXPENSE_FIELD",
						payload: { id: expense.id, field: "payment", value: newPayment },
					});
				}
			}

			if (typeof (updatedExpense as any).calculateDeductible === 'function') {
				const newPayment = (updatedExpense as any).calculateDeductible();
				if (newPayment !== expense.payment) {
					expenseDispatch({
						type: "UPDATE_EXPENSE_FIELD",
						payload: { id: expense.id, field: "tax_deductible", value: newPayment },
					});
				}
			}

			if (field === "name") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "name", value },
                });
            }
            if (field === "valuation") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "amount", value },
                });
            }
            if (field === "loan_balance") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "loanAmount", value },
                });
            }
            if (field === "starting_loan_balance") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "startingLoanBalance", value },
                });
            }
		}
	};

    const handleDateChange = (field: AllExpenseKeys, dateString: string) => {
        if (!dateString) return;
        handleFieldUpdate(field, new Date(`${dateString}T00:00:00.000Z`));
    };

	const getDescriptor = () => {
		if (expense instanceof RentExpense) return "RENT";
		if (expense instanceof MortgageExpense) return "Mortgage";
		if (expense instanceof LoanExpense) return "LOAN";
		if (expense instanceof DependentExpense) return "DEPENDENT";
		if (expense instanceof HealthcareExpense) return "HEALTHCARE";
		if (expense instanceof VacationExpense) return "VACATION";
		if (expense instanceof EmergencyExpense) return "EMERGENCY";
		if (expense instanceof TransportExpense) return "TRANSPORT";
		if (expense instanceof FoodExpense) return "FOOD";
		if (expense instanceof OtherExpense) return "OTHER";
		return "EXPENSE";
	};

	const getIconBg = () => {
		if (expense instanceof RentExpense) return EXPENSE_COLORS_BACKGROUND["Rent"];
		if (expense instanceof MortgageExpense) return EXPENSE_COLORS_BACKGROUND["Mortgage"];
		if (expense instanceof LoanExpense) return EXPENSE_COLORS_BACKGROUND["Loan"];
		if (expense instanceof DependentExpense) return EXPENSE_COLORS_BACKGROUND["Dependent"];
		if (expense instanceof HealthcareExpense) return EXPENSE_COLORS_BACKGROUND["Healthcare"];
		if (expense instanceof VacationExpense) return EXPENSE_COLORS_BACKGROUND["Vacation"];
		if (expense instanceof EmergencyExpense) return EXPENSE_COLORS_BACKGROUND["Emergency"];
		if (expense instanceof TransportExpense) return EXPENSE_COLORS_BACKGROUND["Transport"];
		if (expense instanceof FoodExpense) return EXPENSE_COLORS_BACKGROUND["Food"];
		if (expense instanceof OtherExpense) return EXPENSE_COLORS_BACKGROUND["Other"];
		return "bg-gray-500";
	};

	return (
		<div className="w-full">
			<div className="flex gap-4 mb-4">
				<div className={`w-8 h-8 mt-1 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-md font-bold text-white`}>
					{getDescriptor().slice(0, 1)}
				</div>
				<div className="grow"> 
					<NameInput 
						label=""
						id={expense.id}
						value={expense.name}
						onChange={(val) => handleFieldUpdate("name", val)}
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteExpenseControl expenseId={expense.id}/>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {/* Logic for Housing: 
                    Housing expenses calculate 'amount' as a sum of parts.
                    The main field edits 'payment' (Rent/Mortgage).
                    Other types edit 'amount' directly.
                */}
				{ !(expense instanceof MortgageExpense) && (
					<CurrencyInput
						id={`${expense.id}-amount`}
						label={expense instanceof RentExpense ? "Rent/Mortgage Payment" : "Amount"}
						value={expense instanceof RentExpense ? (expense as RentExpense).payment : expense.amount}
						onChange={(val) => handleFieldUpdate(isHousing ? "payment" : "amount", val)}
					/>
				)}
				{ expense instanceof MortgageExpense && (
					<StyledDisplay
						label="Mortgage Payment"
						value={"$"+expense.payment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2})}
					/>
				)}
                
                <StyledSelect
					id={`${expense.id}-frequency`}
                    label="Frequency"
                    value={expense.frequency}
                    onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                    options={["Daily", "Weekly", "Monthly", "Annually"]}
                />

                {/* --- Specialized Housing Fields --- */}
				{expense instanceof RentExpense && (
					<CurrencyInput
						id={`${expense.id}-utilities`}
						label="Utilities"
						value={expense.utilities}
						onChange={(val) => handleFieldUpdate("utilities", val)}
					/>
				)}

				{(expense instanceof MortgageExpense) && (
					<>
						<CurrencyInput
							id={`${expense.id}-valuation`}
							label="Valuation"
							value={expense.valuation}
							onChange={(val) => handleFieldUpdate("valuation", val)}
						/>
						<CurrencyInput
							id={`${expense.id}-loan-balance`}
							label="Loan Balance"
							value={expense.loan_balance}
							onChange={(val) => handleFieldUpdate("loan_balance", val)}
						/>
						<CurrencyInput
							id={`${expense.id}-starting-loan-balance`}
							label="Starting Loan Balance"
							value={expense.starting_loan_balance}
							onChange={(val) => handleFieldUpdate("starting_loan_balance", val)}
						/>
						<PercentageInput
							id={`${expense.id}-apr`}
							label="APR"
							value={expense.apr}
							onChange={(val) => handleFieldUpdate("apr", val)}
						/>
						<NumberInput
							id={`${expense.id}-term-length`}
							label="Term Length (years)"
							value={expense.term_length}
							onChange={(val) => handleFieldUpdate("term_length", val)}
						/>
						<PercentageInput
							id={`${expense.id}-property-taxes`}
							label="Property Taxes"
							value={expense.property_taxes}
							onChange={(val) => handleFieldUpdate("property_taxes", val)}
						/>
						<CurrencyInput
							id={`${expense.id}-valuation-deduction`}
							label="Valuation Deduction"
							value={expense.valuation_deduction}
							onChange={(val) => handleFieldUpdate("valuation_deduction", val)}
						/>
						<PercentageInput
							id={`${expense.id}-maintenance`}
							label="Maintenance"
							value={expense.maintenance}
							onChange={(val) => handleFieldUpdate("maintenance", val)}
						/>
						<CurrencyInput
							id={`${expense.id}-utilities`}
							label="Utilities"
							value={expense.utilities}
							onChange={(val) => handleFieldUpdate("utilities", val)}
						/>
						<PercentageInput
							id={`${expense.id}-homeowners-insurance`}
							label="Homeowners Insurance"
							value={expense.home_owners_insurance}
							onChange={(val) => handleFieldUpdate("home_owners_insurance", val)}
						/>
						<PercentageInput
							id={`${expense.id}-pmi`}
							label="PMI"
							value={expense.pmi}
							onChange={(val) => handleFieldUpdate("pmi", val)}
						/>
						<CurrencyInput
							id={`${expense.id}-hoa-fee`}
							label="HOA Fee"
							value={expense.hoa_fee}
							onChange={(val) => handleFieldUpdate("hoa_fee", val)}
						/>
						<CurrencyInput
							id={`${expense.id}-extra-payment`}
							label="Extra Payment"
							value={expense.extra_payment}
							onChange={(val) => handleFieldUpdate("extra_payment", val)}
						/>
                        <StyledInput 
							id={`${expense.id}-purchase-date`}
							label="Purchase Date" 
							type="date" 
							value={formatDate(expense.purchaseDate)} 
							onChange={(e) => handleDateChange("purchaseDate", e.target.value)} 
						/>
						<StyledSelect 
							id={`${expense.id}-tax-deductible`}
							label="Tax Deductible" 
							value={expense.is_tax_deductible} 
							onChange={(e) => handleFieldUpdate("is_tax_deductible", e.target.value)} 
							options={["Yes", "No", "Itemized"]} 
						/>
						{(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
							<StyledDisplay
								label="Deductible Amount"
								value={"$"+expense.tax_deductible.toLocaleString(undefined, { minimumFractionDigits: 2 })}
							/>
						)}
						{showPmiWarning && (
                            <div className="text-yellow-500 text-sm col-span-full p-2 rounded-lg bg-yellow-900/20 border border-yellow-700/50">
                                <strong>Warning:</strong> With over 20% equity, you may be eligible to have your PMI removed. Contact your lender to inquire about the process.
                            </div>
                        )}
					</>
				)}
                

                {/* --- Specialized Loan Fields --- */}
                {expense instanceof LoanExpense && (
					<>
						<StyledInput 
							id={`${expense.id}-apr`}
							label="APR (%)" 
							type="number" 
							value={expense.apr} 
							onChange={(e) => handleFieldUpdate("apr", Number(e.target.value))} 
						/>
						<StyledSelect 
							id={`${expense.id}-interest-type`}
							label="Interest Type" 
							value={expense.interest_type} 
							onChange={(e) => handleFieldUpdate("interest_type", e.target.value)} 
							options={["Simple", "Compounding"]} 
						/>
						<CurrencyInput
							id={`${expense.id}-payment`}
							label="Payment"
							value={expense.payment}
							onChange={(val) => handleFieldUpdate("payment", val)}
						/>
						<StyledSelect 
							id={`${expense.id}-tax-deductible`}
							label="Tax Deductible" 
							value={expense.is_tax_deductible} 
							onChange={(e) => handleFieldUpdate("is_tax_deductible", e.target.value)} 
							options={["Yes", "No", "Itemized"]} 
						/>
						{(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
							<CurrencyInput
								id={`${expense.id}-deductible-amount`}
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
							id={`${expense.id}-end-date`}
							label="End Date" 
							type="date" 
							value={formatDate(expense.end_date)} 
							onChange={(e) => handleDateChange("end_date", e.target.value)} 
						/>
						<StyledSelect 
							id={`${expense.id}-tax-deductible`}
							label="Tax Deductible" 
							value={expense.is_tax_deductible} 
							onChange={(e) => handleFieldUpdate("is_tax_deductible", e.target.value)} 
							options={["Yes", "No", "Itemized"]} 
						/>
						{(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
							<CurrencyInput
								id={`${expense.id}-deductible-amount`}
								label="Deductible Amount"
								value={expense.tax_deductible}
								onChange={(val) => handleFieldUpdate("tax_deductible", val)}
							/>
						)}
					</>
				)}

				{expense instanceof DependentExpense && (
					<>
						<StyledSelect 
							id={`${expense.id}-tax-deductible-2`}
							label="Tax Deductible" 
							value={expense.is_tax_deductible} 
							onChange={(e) => handleFieldUpdate("is_tax_deductible", e.target.value)} 
							options={["Yes", "No", "Itemized"]} 
						/>
						{(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
							<CurrencyInput
								id={`${expense.id}-deductible-amount-2`}
								label="Deductible Amount"
								value={expense.tax_deductible}
								onChange={(val) => handleFieldUpdate("tax_deductible", val)}
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
};

export default ExpenseCard;