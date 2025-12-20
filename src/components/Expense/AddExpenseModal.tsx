import React, { useState, useContext } from "react";
import { ExpenseContext } from "./ExpenseContext";
import {
	HousingExpense,
	LoanExpense,
	DependentExpense,
	HealthcareExpense,
	VacationExpense,
	TransportExpense,
	EmergencyExpense,
	OtherExpense,
	IncomeDeductionExpense,
} from "./models";
import { AccountContext } from "../Accounts/AccountContext";
import { IncomeContext } from "../Income/IncomeContext";
import { DebtAccount } from "../Accounts/models";

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
	const { incomes } = useContext(IncomeContext);
	const [step, setStep] = useState<"select" | "details">("select");
	const [selectedType, setSelectedType] = useState<any>(null);
	const [name, setName] = useState("");
	const [amount, setAmount] = useState<number>(0);
	const [frequency, setFrequency] = useState<"Weekly" | "Monthly" | "Annually">(
		"Monthly"
	);
	const [inflation, setInflation] = useState<number>(2);

	// --- New State for Specialized Fields ---
	const [utilities, setUtilities] = useState<number>(0);
	const [propertyTaxes, setPropertyTaxes] = useState<number>(0);
	const [maintenance, setMaintenance] = useState<number>(0);
	const [apr, setApr] = useState<number>(0);
	const [interestType, setInterestType] = useState<"Compounding" | "Simple">(
		"Compounding"
	);
	const [startDate, setStartDate] = useState(
		new Date().toISOString().split("T")[0]
	);
	const [endDate, setEndDate] = useState(
		new Date().toISOString().split("T")[0]
	);
    const [selectedIncomeId, setSelectedIncomeId] = useState<string>(incomes[0]?.id || "");
	const [payment, setPayment] = useState<number>(0);
	const [isTaxDeductible, setIsTaxDeductible] = useState<"Yes" | "No">("No");
	const [taxDeductibleAmount, setTaxDeductibleAmount] = useState<number>(0);

	const handleClose = () => {
		setStep("select");
		setSelectedType(null);
		setName("");
		setAmount(0);
        setInflation(2);
		onClose();
	};

	const handleCancelOrBack = () => {
		if (step === "details") {
			// If in details, go back to selection screen
			setStep("select");
			setSelectedType(null);
		} else {
			// If already in selection screen, close the modal
			handleClose();
		}
	};

	const handleTypeSelect = (typeClass: any) => {
		setSelectedType(() => typeClass);
		setStep("details");
	};

	const handleAdd = () => {
		if (!name.trim() || !selectedType) return;

		const id = generateUniqueId();
		const finalStartDate = new Date(startDate);
		const finalEndDate = new Date(endDate);

		let newExpense;

		// Logic to handle specialized constructors from models.tsx
		if (selectedType === HousingExpense) {
            newExpense = new HousingExpense(
                id,
                name.trim(),
                payment,      // Component 1
                utilities,    // Component 2
                propertyTaxes,// Component 3
                maintenance,  // Component 4
                frequency,
                inflation
            );
        } else if (selectedType === LoanExpense) {
			const newAccount = new DebtAccount(
				'ACC' + id.substring(3),
				name.trim(),
				amount,
				id
			)

			accountDispatch({type: "ADD_ACCOUNT", payload: newAccount})

			newExpense = new selectedType(
				id,
				name.trim(),
				amount,
				frequency,
                inflation,
				apr,
				interestType,
				finalStartDate,
				payment,
				isTaxDeductible,
				taxDeductibleAmount
			);
		} else if (selectedType === DependentExpense) {
			newExpense = new selectedType(
				id,
				name.trim(),
				amount,
				frequency,
				inflation,
				finalStartDate,
				finalEndDate,
				isTaxDeductible,
				taxDeductibleAmount
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
				inflation
			);
		} else if (selectedType === IncomeDeductionExpense) {
        // Find the full income object based on the ID stored in state
        const linkedIncome = incomes.find(inc => inc.id === selectedIncomeId);
        
        if (!linkedIncome) {
            alert("Please select a valid income source");
            return;
        }

        newExpense = new IncomeDeductionExpense(
            id,
            name.trim(),
            amount,
            frequency,
            linkedIncome, // Passing the actual income object
            inflation
        );
		} else {
			// Healthcare, Vacation, Emergency
			newExpense = new selectedType(
				id,
				name.trim(),
				amount,
				frequency,
				inflation
			);
		}

		expenseDispatch({ type: "ADD_EXPENSE", payload: newExpense });
		handleClose();
	};

	if (!isOpen) return null;

	const expenseCategories = [
		{ label: "Housing", class: HousingExpense },
		{ label: "Loan", class: LoanExpense },
		{ label: "Dependent", class: DependentExpense },
		{ label: "Healthcare", class: HealthcareExpense },
		{ label: "Vacation", class: VacationExpense },
		{ label: "Emergency", class: EmergencyExpense },
		{ label: "Income Deduction", class: IncomeDeductionExpense },
		{ label: "Transport", class: TransportExpense },
		{ label: "Other", class: OtherExpense },
	];

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
			<div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-md overflow-y-auto text-white">
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
								className="flex items-center justify-center p-2 h-12 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl border border-gray-700 transition-all font-medium text-sm text-center"
							>
								{cat.label}
							</button>
						))}
					</div>
				) : (
					<div className="space-y-0.5">
						{/* Common Fields */}
						<div>
							<label className="block text-sm font-medium text-gray-400 mb-1">
								Expense Name
							</label>
							<input
								autoFocus
								className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none"
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</div>

						<div className="grid grid-cols-3 gap-2">
							<div>
								<label className="block text-sm font-medium text-gray-400 mb-1">
									Amount ($)
								</label>
								<input
									type="number"
									className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none"
									value={amount}
									onChange={(e) => setAmount(Number(e.target.value))}
								/>
							</div>
							<div>
								<label className="block text-sm font-medium text-gray-400 mb-1">
									Frequency
								</label>
								<select
									className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg pl-2 focus:border-green-300 outline-none appearance-none"
									value={frequency}
									onChange={(e) => setFrequency(e.target.value as any)}
								>
									<option value="Daily">Daily</option>
									<option value="Weekly">Weekly</option>
									<option value="Monthly">Monthly</option>
									<option value="Annually">Annually</option>
								</select>
							</div>
							<div>
								<label className="block text-sm font-medium text-gray-400 mb-1">
									Inflation (%)
								</label>
								<input
									type="number"
									className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none"
									value={inflation}
									onChange={(e) => setInflation(Number(e.target.value))}
								/>
							</div>
						</div>

						{/* --- Specialized Fields based on models.tsx --- */}
						{selectedType === HousingExpense && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Rent/Mortgage Payment</label>
                                    <input type="number" className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3" 
                                        value={payment} onChange={(e) => setPayment(Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Utilities</label>
                                    <input type="number" className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3" 
                                        value={utilities} onChange={(e) => setUtilities(Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Property Taxes</label>
                                    <input type="number" className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3" 
                                        value={propertyTaxes} onChange={(e) => setPropertyTaxes(Number(e.target.value))} />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-400 mb-1">Maintenance</label>
                                    <input type="number" className="w-full h-8 bg-gray-950 border border-gray-700 rounded-lg p-3" 
                                        value={maintenance} onChange={(e) => setMaintenance(Number(e.target.value))} />
                                </div>
                            </div>
                        )}

						{selectedType === LoanExpense && (
							<div className="space-y-4">
								<div className="grid grid-cols-3 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											APR (%)
										</label>
										<input
											type="number"
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={apr}
											onChange={(e) => setApr(Number(e.target.value))}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											Interest Type
										</label>
										<select
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={interestType}
											onChange={(e) => setInterestType(e.target.value as any)}
										>
											<option value="Simple">Simple</option>
											<option value="Compounding">Compounding</option>
										</select>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											Start Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={startDate}
											onChange={(e) => setStartDate(e.target.value)}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											Payment
										</label>
										<input
											type="number"
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={payment}
											onChange={(e) => setPayment(Number(e.target.value))}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											Tax Deductible
										</label>
										<select
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={isTaxDeductible}
											onChange={(e) =>
												setIsTaxDeductible(e.target.value as any)
											}
										>
											<option value="No">No</option>
											<option value="Yes">Yes</option>
										</select>
									</div>
									{isTaxDeductible === "Yes" && (
										<div>
											<label className="block text-sm font-medium text-gray-400 mb-1">
												Deductible
											</label>
											<input
												type="number"
												className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
												value={taxDeductibleAmount}
												onChange={(e) =>
													setTaxDeductibleAmount(Number(e.target.value))
												}
											/>
										</div>
									)}
								</div>
							</div>
						)}
						{selectedType === DependentExpense && (
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											Start Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={startDate}
											onChange={(e) => setStartDate(e.target.value)}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											End Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={endDate}
											onChange={(e) => setEndDate(e.target.value)}
										/>
									</div>
									<div>
										<label className="block text-sm font-medium text-gray-400 mb-1">
											Tax Deductible
										</label>
										<select
											className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
											value={isTaxDeductible}
											onChange={(e) =>
												setIsTaxDeductible(e.target.value as any)
											}
										>
											<option value="Simple">Yes</option>
											<option value="Compounding">No</option>
										</select>
									</div>
									{isTaxDeductible === "Yes" && (
										<div>
											<label className="block text-sm font-medium text-gray-400 mb-1">
												Deductible
											</label>
											<input
												type="number"
												className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
												value={taxDeductibleAmount}
												onChange={(e) =>
													setTaxDeductibleAmount(Number(e.target.value))
												}
											/>
										</div>
									)}
								</div>
							</div>
						)}

						{selectedType === IncomeDeductionExpense && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">
                                    Linked Income Account
                                </label>
                                <select
                                    className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none"
                                    value={selectedIncomeId}
                                    onChange={(e) => setSelectedIncomeId(e.target.value)}
                                >
                                    <option value="" disabled>Select an income source...</option>
                                    {incomes.map((inc) => (
                                        <option key={inc.id} value={inc.id}>
                                            {inc.name} ({inc.amount})
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
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
