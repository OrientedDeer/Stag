import React, { useState, useContext } from "react";
import { ExpenseContext } from "./ExpenseContext";
import {
	RentExpense,
	MortgageExpense,
	LoanExpense,
	DependentExpense,
	HealthcareExpense,
	VacationExpense,
	TransportExpense,
	EmergencyExpense,
	FoodExpense,
	OtherExpense,
} from "./models";
import { AccountContext } from "../Accounts/AccountContext";
import { DebtAccount, PropertyAccount } from "../Accounts/models";
import { CurrencyInput } from "../Layout/CurrencyInput";
import { PercentageInput } from "../Layout/PercentageInput";
import { DropdownInput } from "../Layout/DropdownInput";
import { NumberInput } from "../Layout/NumberInput";
import { NameInput } from "../Layout/NameInput";

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
	const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
	const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split("T")[0]);
	const [payment, setPayment] = useState<number>(0);
	const [extraPayment, setExtraPayment] = useState<number>(0);
	const [isTaxDeductible, setIsTaxDeductible] = useState<"Yes" | "No" | 'Itemized'>("No");
	const [taxDeductibleAmount, setTaxDeductibleAmount] = useState<number>(0);
	const id = generateUniqueId();

	const handleClose = () => {
		setStep("select");
		setSelectedType(null);
		setName("");
		setAmount(0);
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
		setStep("details");
	};

	const handleAdd = () => {
		if (!name.trim() || !selectedType) return;

		const finalEndDate = new Date(`${endDate}T00:00:00.000Z`);
		const finalPurchaseDate = new Date(`${purchaseDate}T00:00:00.000Z`);

		let newExpense;

		if (selectedType === RentExpense) {
			newExpense = new RentExpense(
				id,
				name.trim(),
				payment,
				utilities,
				frequency
			);
		} else if (selectedType === MortgageExpense) {
			const newAccount = new PropertyAccount(
				'ACC' + id.substring(3),
				name.trim(),
				valuation,
				'Financed',
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
				finalPurchaseDate,
				payment,
				extraPayment
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
				'ACC' + id.substring(3)
			);
		} else if (selectedType === DependentExpense) {
			newExpense = new DependentExpense(
				id,
				name.trim(),
				amount,
				frequency,
				finalEndDate,
				isTaxDeductible,
				isTaxDeductible ? taxDeductibleAmount : 0
			);
		} else if (selectedType === HealthcareExpense) {
			newExpense = new HealthcareExpense(
				id,
				name.trim(),
				amount,
				frequency,
				isTaxDeductible,
				isTaxDeductible ? taxDeductibleAmount : 0
			);
		} else if (
			selectedType === TransportExpense ||
			selectedType === OtherExpense
		) {
			newExpense = new selectedType(
				id,
				name.trim(),
				amount,
				frequency
			);
		} else {
			newExpense = new selectedType(id, name.trim(), amount, frequency);
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
		{ label: "Emergency", class: EmergencyExpense },
		{ label: "Transport", class: TransportExpense },
		{ label: "Food", class: FoodExpense },
		{ label: "Other", class: OtherExpense },
	];

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm min-w-max">
			<div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-md overflow-y-auto text-white">
				<h2 className="text-xl font-bold mb-6 border-b border-gray-800 pb-3">
					{step === "select"
						? "Select Expense Type"
						: `New ${selectedType.name.replace("Expense", "")}`}
				</h2>

				{step === "select" ? (
					<div className="grid grid-cols-3 gap-4">
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
						<div className="grid grid-cols-3 gap-4">
							<div className="col-span-2">
								<NameInput label="Expense Name" id={id} value={name} onChange={setName} />
							</div>
							<div className="col-span-1">
                            <DropdownInput
                                label="Frequency"
                                id={`${id}-frequency`}
                                value={frequency}
                                onChange={(val) => setFrequency(val as any)}
                                options={["Daily", "Weekly", "Monthly", "Annually"]}
                            />
							</div>
						</div>

						{/* Common Fields Grid */}
						<div className="grid grid-cols-3 gap-4">
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
									<CurrencyInput id={`${id}-valuation`} label="Valuation" value={valuation} onChange={setValuation} />
									<CurrencyInput id={`${id}-loan-balance`} label="Loan Balance" value={loanBalance} onChange={setLoanBalance} />
									<PercentageInput id={`${id}-apr`} label="APR" value={apr} onChange={setApr}/>
									<NumberInput id={`${id}-term-length`} label="Term Length (years)" value={termLength} onChange={setTermLength} />
									<PercentageInput id={`${id}-property-tax-rate`} label="Property Tax Rate" value={propertyTaxes} onChange={setPropertyTaxes}/>
									<CurrencyInput id={`${id}-valuation-deduction`} label="Valuation Deduction" value={valuationDeduction} onChange={setValuationDeduction} />
									<PercentageInput id={`${id}-maintenance`} label="Maintenance" value={maintenance} onChange={setMaintenance} />
									<CurrencyInput id={`${id}-utilities`} label="Utilities" value={utilities} onChange={setUtilities} />
									<PercentageInput id={`${id}-homeowners-insurance`} label="Homeowners Insurance" value={homeOwnersInsurance} onChange={setHomeOwnersInsurance} />
									<PercentageInput id={`${id}-pmi`} label="PMI" value={pmi} onChange={setPmi} />
									<CurrencyInput id={`${id}-hoa-fee`} label="HOA Fee" value={hoaFee} onChange={setHoaFee} />
									<CurrencyInput id={`${id}-extra-payment`} label="Extra Payment" value={extraPayment} onChange={setExtraPayment} />
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											Purchase Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
											value={purchaseDate}
											onChange={(e) => setPurchaseDate(e.target.value)}
										/>
									</div>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["No", "Yes", "Itemized"]}
									/>
								</>
							)}

							{selectedType === LoanExpense && (
								<>
									<PercentageInput id={`${id}-apr`} label="APR" value={apr} onChange={setApr}/>
									<DropdownInput
										id={`${id}-interest-type`}
										label="Interest Type"
										value={interestType}
										onChange={(val) => setInterestType(val as "Compounding" | "Simple")}
										options={["Simple", "Compounding"]}
									/>
									
									<CurrencyInput id={`${id}-payment`} label="Payment" value={payment} onChange={setPayment} />
									
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["No", "Yes", "Itemized"]}
									/>
									{(isTaxDeductible === "Yes" || isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} />
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
									/>
									{(isTaxDeductible === "Yes" || isTaxDeductible === "Itemized") && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} />
									)}
								</>
							)}

							{selectedType === DependentExpense && (
								<>
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											End Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
											value={endDate}
											onChange={(e) => setEndDate(e.target.value)}
										/>
									</div>
									<DropdownInput
										id={`${id}-tax-deductible`}
										label="Tax Deductible"
										value={isTaxDeductible}
										onChange={(val) => setIsTaxDeductible(val as "Yes" | "No" | "Itemized")}
										options={["Yes", "No", "Itemized"]}
									/>
									{isTaxDeductible === "Yes" && (
										<CurrencyInput id={`${id}-deductible-amount`} label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} />
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
							disabled={!name.trim()}
							className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
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