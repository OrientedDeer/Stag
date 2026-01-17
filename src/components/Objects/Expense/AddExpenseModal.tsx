import React, { useState, useContext } from "react";
import { ExpenseContext } from "./ExpenseContext";
import {
	RentExpense,
	MortgageExpense,
	LoanExpense,
	DependentExpense,
	HealthcareExpense,
	VacationExpense,
	SubscriptionExpense,
	TransportExpense,
	EmergencyExpense,
	FoodExpense,
	CharityExpense,
	OtherExpense,
} from "./models";
import { AccountContext } from "../Accounts/AccountContext";
import { DebtAccount, PropertyAccount } from "../../Objects/Accounts/models";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { StyledInput } from "../../Layout/InputFields/StyleUI";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";

const generateUniqueId = () =>
	`EXS-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddExpenseModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const AddExpenseModal: React.FC<AddExpenseModalProps> = ({
	isOpen,
	onClose,
}) => {
	const { dispatch: expenseDispatch } = useContext(ExpenseContext);
	const { dispatch: accountDispatch } = useContext(AccountContext);
	const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
	const [step, setStep] = useState<"select" | "details">("select");
	const [selectedType, setSelectedType] = useState<any>(null);
	const [name, setName] = useState("");
	const [amount, setAmount] = useState<number>(0);
	const [frequency, setFrequency] = useState<"Weekly" | "Monthly" | "Annually">("Monthly");

	// --- Specialized Fields State ---
	const [valuation, setValuation] = useState<number>(0);
	const [loanBalance, setLoanBalance] = useState<number>(0);
	const [apr, setApr] = useState<number>(6.23);
	const [interestType, setInterestType] = useState<"Compounding" | "Simple">("Compounding");
	const [termLength, setTermLength] = useState<number>(30);
	const [propertyTaxes, setPropertyTaxes] = useState<number>(0.85);
	const [valuationDeduction, setValuationDeduction] = useState<number>(89850);
	const [maintenance, setMaintenance] = useState<number>(1);
	const [utilities, setUtilities] = useState<number>(180);
	const [homeOwnersInsurance, setHomeOwnersInsurance] = useState<number>(0.56);
	const [pmi, setPmi] = useState<number>(0.58);
	const [hoaFee, setHoaFee] = useState<number>(0);
	const [startingLoanBalance, setStartingLoanBalance] = useState<number>(0);
	// Default to January 1st of current year
	const [startDate, setStartDate] = useState(`${new Date().getFullYear()}-01-01`);
	const [endDate, setEndDate] = useState<string>("");
	const [payment, setPayment] = useState<number>(0);
	const [extraPayment, setExtraPayment] = useState<number>(0);
	const [isTaxDeductible, setIsTaxDeductible] = useState<"Yes" | "No" | 'Itemized'>("No");
	const [taxDeductibleAmount, setTaxDeductibleAmount] = useState<number>(0);
	const [isDiscretionary, setIsDiscretionary] = useState<boolean>(false);
	const [dateError, setDateError] = useState<string | undefined>();

	// Validate end date is after start date
	const validateDates = (start: string, end: string) => {
		if (start && end && new Date(end) < new Date(start)) {
			setDateError("End date must be after start date");
		} else {
			setDateError(undefined);
		}
	};

	const id = generateUniqueId();

	const handleClose = () => {
		setStep("select");
		setSelectedType(null);
		setName("");
		setAmount(0);
		setFrequency("Monthly");
		setInterestType("Compounding");
		setIsTaxDeductible("No");
		setTaxDeductibleAmount(0);
		setIsDiscretionary(false);
        setStartDate(`${new Date().getFullYear()}-01-01`);
        setEndDate("");
		setDateError(undefined);
		onClose();
	};

	const handleCancelOrBack = () => {
		if (step === "details") {
			setStep("select");
			setSelectedType(null);
		} else {
			handleClose();
		}
	};

	const handleTypeSelect = (typeClass: any) => {
		setSelectedType(() => typeClass);
		// Set sensible defaults based on expense type
		if (typeClass === CharityExpense) {
			setIsTaxDeductible("Itemized");
		}
		// Default discretionary for non-essential expense types
		const discretionaryTypes = [VacationExpense, SubscriptionExpense, CharityExpense, OtherExpense];
		setIsDiscretionary(discretionaryTypes.includes(typeClass));
		setStep("details");
	};

	const handleAdd = () => {
		if (!selectedType || !name.trim() || dateError) return;

		const finalStartDate = startDate ? new Date(`${startDate}T00:00:00.000Z`) : undefined;
		const finalEndDate = endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined;

		let newExpense;

		if (selectedType === RentExpense) {
			newExpense = new RentExpense(
				id,
				name.trim(),
				payment,
				utilities,
				frequency,
				finalStartDate,
				finalEndDate
			);
		} else if (selectedType === MortgageExpense) {
			const newAccount = new PropertyAccount(
				'ACC' + id.substring(3),
				name.trim(),
				valuation,
				'Financed',
				loanBalance,
				loanBalance,
				id
			)
			accountDispatch({type: "ADD_ACCOUNT", payload: newAccount})
            newExpense = new MortgageExpense(
                id,
				name.trim(),
				frequency,
				valuation,
				loanBalance,
				startingLoanBalance,
				apr,
				termLength,
				propertyTaxes,
				valuationDeduction,
				maintenance,
				utilities,
				homeOwnersInsurance,
				pmi,
				hoaFee,
				isTaxDeductible,
				isTaxDeductible ? taxDeductibleAmount : 0,
				'ACC' + id.substring(3),
				finalStartDate,
				payment,
				extraPayment,
				finalEndDate
            );
        } else if (selectedType === LoanExpense) {
			const newAccount = new DebtAccount(
				'ACC' + id.substring(3),
				name.trim(),
				amount,
				id
			)
			accountDispatch({type: "ADD_ACCOUNT", payload: newAccount})

			newExpense = new LoanExpense(
				id,
				name.trim(),
				amount,
				frequency,
				apr,
				interestType,
				payment,
				isTaxDeductible,
				isTaxDeductible ? taxDeductibleAmount : 0,
				'ACC' + id.substring(3),
				finalStartDate,
				finalEndDate
			);
		} else if (selectedType === DependentExpense) {
			newExpense = new DependentExpense(
				id,
				name.trim(),
				amount,
				frequency,
				isTaxDeductible,
				isTaxDeductible ? taxDeductibleAmount : 0,
				finalStartDate,
				finalEndDate
			);
		} else if (selectedType === HealthcareExpense) {
			newExpense = new HealthcareExpense(
				id,
				name.trim(),
				amount,
				frequency,
				isTaxDeductible,
				isTaxDeductible ? taxDeductibleAmount : 0,
				finalStartDate,
				finalEndDate
			);
		} else if (selectedType === CharityExpense) {
			newExpense = new CharityExpense(
				id,
				name.trim(),
				amount,
				frequency,
				isTaxDeductible,
				isTaxDeductible !== 'No' ? taxDeductibleAmount : 0,
				finalStartDate,
				finalEndDate
			);
		} else if (
			selectedType === TransportExpense ||
			selectedType === OtherExpense
		) {
			newExpense = new selectedType(
				id,
				name.trim(),
				amount,
				frequency,
				finalStartDate,
				finalEndDate
			);
		} else {
			newExpense = new selectedType(id, name.trim(), amount, frequency, finalStartDate, finalEndDate);
		}

		// Set discretionary flag
		if (newExpense) {
			newExpense.isDiscretionary = isDiscretionary;
		}

		expenseDispatch({ type: "ADD_EXPENSE", payload: newExpense });
		handleClose();
	};

	if (!isOpen) return null;

	const expenseCategories = [
		{ label: "Rent", class: RentExpense },
		{ label: "Mortgage", class: MortgageExpense },
		{ label: "Loan", class: LoanExpense },
		{ label: "Dependent", class: DependentExpense },
		{ label: "Healthcare", class: HealthcareExpense },
		{ label: "Vacation", class: VacationExpense },
		{ label: "Subscription", class: SubscriptionExpense },
		{ label: "Emergency", class: EmergencyExpense },
		{ label: "Transport", class: TransportExpense },
		{ label: "Food", class: FoodExpense },
		{ label: "Charity", class: CharityExpense },
		{ label: "Other", class: OtherExpense },
	];

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
			onClick={onClose}
		>
			<div
				ref={modalRef}
				role="dialog"
				aria-modal="true"
				aria-labelledby="add-expense-modal-title"
				className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg"
				onClick={(e) => e.stopPropagation()}
				onKeyDown={handleKeyDown}
			>
				<h2 id="add-expense-modal-title" className="text-xl font-bold mb-6 border-b border-gray-800 pb-3">
					{step === "select"
						? "Select Expense Type"
						: `New ${selectedType.name.replace("Expense", "")}`}
				</h2>

				{step === "select" ? (
					<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
						{expenseCategories.map((cat) => (
							<button
								key={cat.label}
								onClick={() => handleTypeSelect(cat.class)}
								className="flex items-center justify-center p-2 h-12 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl border border-gray-700 transition-all font-medium text-md text-center"
							>
								{cat.label}
							</button>
						))}
					</div>
				) : (
					<div className="space-y-4">
						{/* Name */}
						<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
							<div className="col-span-2">
								<NameInput
									label="Expense Name"
									id={id}
									value={name}
									onChange={setName}
								/>
							</div>
							<div className="col-span-2 lg:col-span-1">
                            <DropdownInput
                                label="Frequency"
                                id={`${id}-frequency`}
                                value={frequency}
                                onChange={(val) => setFrequency(val as any)}
                                options={["Daily", "Weekly", "Monthly", "Annually"]}
                            />
							</div>
						</div>

						{/* Start and End Dates */}
						<div className="grid grid-cols-2 gap-4">
							<div>
								<StyledInput
									label="Start Date"
									id={`${id}-start-date`}
									type="date"
									value={startDate}
									onChange={(e) => {
										const val = e.target.value === "" ? "" : e.target.value;
										setStartDate(val);
										validateDates(val, endDate);
									}}
									tooltip="Defaults to model full year expenses. Change to model partial year expenses."
								/>
							</div>
							<div>
								<StyledInput
									label="End Date (Optional)"
									id={`${id}-end-date`}
									type="date"
									value={endDate}
									onChange={(e) => {
										const val = e.target.value === "" ? "" : e.target.value;
										setEndDate(val);
										validateDates(startDate, val);
									}}
									error={dateError}
								/>
							</div>
						</div>

						{/* Discretionary Toggle */}
						<div className="flex items-center">
							<ToggleInput
								id={`${id}-discretionary`}
								label="Discretionary"
								enabled={isDiscretionary}
								setEnabled={setIsDiscretionary}
								tooltip="Discretionary expenses can be reduced during Guyton-Klinger guardrail triggers in retirement, and are affected by lifestyle creep."
							/>
						</div>

						{/* Common Fields Grid */}
						<div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            {(!(selectedType === RentExpense || selectedType === MortgageExpense || selectedType === LoanExpense)) && (
								<CurrencyInput
									id={`${id}-amount`}
									label="Amount"
									value={amount}
									onChange={setAmount}
								/>
							)}
							{((selectedType === LoanExpense)) && (
								<CurrencyInput
									id={`${id}-balance`}
									label="Balance"
									value={amount}
									onChange={setAmount}
								/>
							)}

							{selectedType === RentExpense && (
								<>
									<CurrencyInput id={`${id}-rent-payment`} label="Rent Payment" value={payment} onChange={setPayment} />
									<CurrencyInput id={`${id}-utilities`} label="Utilities" value={utilities} onChange={setUtilities} />
								</>
							)}

							{selectedType === MortgageExpense && (
								<>
									<CurrencyInput id={`${id}-valuation`} label="Valuation" value={valuation} onChange={setValuation} tooltip="Current market value of the property." />
									<CurrencyInput id={`${id}-starting-loan-balance`} label="Starting Loan Balance" value={startingLoanBalance} onChange={setStartingLoanBalance} tooltip="Original loan amount when the mortgage was taken out." />
									<CurrencyInput id={`${id}-loan-balance`} label="Current Loan Balance" value={loanBalance} onChange={setLoanBalance} tooltip="Remaining amount owed on the mortgage today." />
									<PercentageInput id={`${id}-apr`} label="APR" value={apr} onChange={setApr} max={50} tooltip="Annual Percentage Rate - the yearly interest rate on your loan." />
									<NumberInput id={`${id}-term-length`} label="Term Length (years)" value={termLength} onChange={setTermLength} tooltip="Total length of the mortgage (typically 15 or 30 years)." />
									<PercentageInput id={`${id}-property-tax-rate`} label="Property Tax Rate" value={propertyTaxes} onChange={setPropertyTaxes} max={20} tooltip="Annual property tax as a percentage of home value. Varies by location (0.5-2.5% typical)." />
									<CurrencyInput id={`${id}-valuation-deduction`} label="Valuation Deduction" value={valuationDeduction} onChange={setValuationDeduction} tooltip="Homestead exemption or other deductions that reduce taxable property value." />
									<PercentageInput id={`${id}-maintenance`} label="Maintenance" value={maintenance} onChange={setMaintenance} max={20} tooltip="Annual maintenance budget as % of home value. 1% is a common rule of thumb." />
									<CurrencyInput id={`${id}-utilities`} label="Utilities" value={utilities} onChange={setUtilities} tooltip="Monthly utility costs (electric, gas, water, etc.)." />
									<PercentageInput id={`${id}-homeowners-insurance`} label="Homeowners Insurance" value={homeOwnersInsurance} onChange={setHomeOwnersInsurance} max={20} tooltip="Annual insurance as % of home value. Typically 0.3-0.6%." />
									<PercentageInput id={`${id}-pmi`} label="PMI" value={pmi} onChange={setPmi} max={20} tooltip="Private Mortgage Insurance. Required if down payment < 20%. Usually 0.5-1% of loan annually. Set to 0 if not applicable." />
									<CurrencyInput id={`${id}-hoa-fee`} label="HOA Fee" value={hoaFee} onChange={setHoaFee} tooltip="Monthly Homeowners Association fee, if applicable." />
									<CurrencyInput id={`${id}-extra-payment`} label="Extra Payment" value={extraPayment} onChange={setExtraPayment} tooltip="Additional monthly payment toward principal to pay off the mortgage faster." />
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["No", "Yes", "Itemized"]}
										tooltip="Yes: always deductible. Itemized: only if you itemize deductions instead of taking standard deduction."
									/>
								</>
							)}

							{selectedType === LoanExpense && (
								<>
									<PercentageInput id={`${id}-apr`} label="APR" value={apr} onChange={setApr} max={50} tooltip="Annual Percentage Rate - the yearly interest rate on your loan." />
									<DropdownInput
										id={`${id}-interest-type`}
										label="Interest Type"
										value={interestType}
										onChange={(val) => setInterestType(val as "Compounding" | "Simple")}
										options={["Simple", "Compounding"]}
										tooltip="Compounding: interest accrues on principal + unpaid interest. Simple: interest only on original principal."
									/>

									<CurrencyInput id={`${id}-payment`} label="Payment" value={payment} onChange={setPayment} tooltip="Your regular payment amount (per frequency)." />

									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["No", "Yes", "Itemized"]}
										tooltip="Yes: always deductible. Itemized: only if you itemize deductions instead of taking standard deduction."
									/>
									{(isTaxDeductible === "Yes" || isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} tooltip="Amount of this expense that can be deducted from taxable income." />
									)}
								</>
							)}

							{selectedType === HealthcareExpense && (
								<>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["No", "Yes", "Itemized"]}
										tooltip="Yes: pre-tax (like HSA contributions). Itemized: only if you itemize deductions."
									/>
									{(isTaxDeductible === "Yes" || isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} tooltip="Amount of this expense that can be deducted from taxable income." />
									)}
								</>
							)}

							{selectedType === DependentExpense && (
								<>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["Yes", "No", "Itemized"]}
										tooltip="Yes: qualifies for dependent care FSA or tax credit. Itemized: only if you itemize."
									/>
									{isTaxDeductible === "Yes" && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} tooltip="Amount eligible for dependent care tax benefits." />
									)}
								</>
							)}

							{selectedType === CharityExpense && (
								<>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["Itemized", "Yes", "No"]}
										tooltip="Charitable donations are typically deductible if you itemize. Select 'Itemized' for standard charitable deductions."
									/>
									{(isTaxDeductible === "Yes" || isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} tooltip="Amount of charitable donation that can be deducted from taxable income." />
									)}
								</>
							)}
						</div>
					</div>
				)}

				<div className="flex justify-end gap-3 mt-8">
					<button
						onClick={handleCancelOrBack}
						className="px-5 py-2.5 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
					>
						{step === "details" ? "Back" : "Cancel"}
					</button>
					{step === "details" && (
						<button
							onClick={handleAdd}
							disabled={!name.trim() || !!dateError}
							title={!name.trim() ? "Enter a name" : dateError ? "Fix date error" : undefined}
							className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
						>
							Add Expense
						</button>
					)}
				</div>
			</div>
		</div>
	);
};

export default AddExpenseModal;