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
import { CurrencyInput } from "../Layout/CurrencyInput";

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
	const [frequency, setFrequency] = useState<"Weekly" | "Monthly" | "Annually">("Monthly");

	// --- Specialized Fields State ---
	const [utilities, setUtilities] = useState<number>(0);
	const [propertyTaxes, setPropertyTaxes] = useState<number>(0);
	const [maintenance, setMaintenance] = useState<number>(0);
	const [apr, setApr] = useState<number>(0);
	const [interestType, setInterestType] = useState<"Compounding" | "Simple">("Compounding");
	const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
	const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
    const [selectedIncomeId, setSelectedIncomeId] = useState<string>(incomes[0]?.id || "");
	const [payment, setPayment] = useState<number>(0);
	const [isTaxDeductible, setIsTaxDeductible] = useState<"Yes" | "No">("No");
	const [taxDeductibleAmount, setTaxDeductibleAmount] = useState<number>(0);

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

		const id = generateUniqueId();
		const finalStartDate = new Date(startDate);
		const finalEndDate = new Date(endDate);

		let newExpense;

		if (selectedType === HousingExpense) {
			if (propertyTaxes > 0){
				const newAccount = new DebtAccount(
					'ACC' + id.substring(3),
					name.trim(),
					amount,
					id
				)
				accountDispatch({type: "ADD_ACCOUNT", payload: newAccount})
			}
            newExpense = new HousingExpense(
                id,
                name.trim(),
                payment,      
                utilities,    
                propertyTaxes,
                maintenance,  
                frequency
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
				frequency
			);
		} else if (selectedType === IncomeDeductionExpense) {
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
				isTaxDeductible,
				taxDeductibleAmount,
                linkedIncome,
            );
		} else {
			newExpense = new selectedType(id, name.trim(), amount, frequency);
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
								className="flex items-center justify-center p-2 h-12 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl border border-gray-700 transition-all font-medium text-md text-center"
							>
								{cat.label}
							</button>
						))}
					</div>
				) : (
					<div className="space-y-4">
						{/* Name */}
						<div>
                            {/* Updated Name Input to match new style */}
							<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
								Expense Name
							</label>
							<input
								autoFocus
								className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
								value={name}
								onChange={(e) => setName(e.target.value)}
							/>
						</div>

						{/* Common Fields Grid */}
						<div className="grid grid-cols-3 gap-4">
                            {(!(selectedType === HousingExpense)) && (
								<CurrencyInput
									label="Amount"
									value={amount}
									onChange={setAmount}
								/>
							)}
                            <div>
								<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
									Frequency
								</label>
                                <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 h-[42px] flex items-center">
                                    <select
                                        className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                                        value={frequency}
                                        onChange={(e) => setFrequency(e.target.value as any)}
                                    >
                                        <option value="Daily" className="bg-gray-950">Daily</option>
                                        <option value="Weekly" className="bg-gray-950">Weekly</option>
                                        <option value="Monthly" className="bg-gray-950">Monthly</option>
                                        <option value="Annually" className="bg-gray-950">Annually</option>
                                    </select>
                                </div>
							</div>
						</div>

						{/* --- Specialized Fields based on models.tsx --- */}
						{selectedType === HousingExpense && (
                            <div className="grid grid-cols-2 gap-4">
                                <CurrencyInput label="Rent/Mortgage Payment" value={payment} onChange={setPayment} />
                                <CurrencyInput label="Utilities" value={utilities} onChange={setUtilities} />
                                <CurrencyInput label="Property Taxes" value={propertyTaxes} onChange={setPropertyTaxes} />
                                <CurrencyInput label="Maintenance" value={maintenance} onChange={setMaintenance} />
                            </div>
                        )}

						{selectedType === LoanExpense && (
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											APR (%)
										</label>
										<input
											type="number"
											className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
											value={apr}
											onChange={(e) => setApr(Number(e.target.value))}
										/>
									</div>
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											Interest Type
										</label>
                                        <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 h-[42px] flex items-center">
                                            <select
                                                className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                                                value={interestType}
                                                onChange={(e) => setInterestType(e.target.value as any)}
                                            >
                                                <option value="Simple" className="bg-gray-950">Simple</option>
                                                <option value="Compounding" className="bg-gray-950">Compounding</option>
                                            </select>
                                        </div>
									</div>
									
                                    <CurrencyInput label="Payment" value={payment} onChange={setPayment} />
                                    
                                    <div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											Start Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
											value={startDate}
											onChange={(e) => setStartDate(e.target.value)}
										/>
									</div>
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											Tax Deductible
										</label>
                                        <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 h-[42px] flex items-center">
                                            <select
                                                className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                                                value={isTaxDeductible}
                                                onChange={(e) => setIsTaxDeductible(e.target.value as any)}
                                            >
                                                <option value="No" className="bg-gray-950">No</option>
                                                <option value="Yes" className="bg-gray-950">Yes</option>
                                        		<option value="Itemized" className="bg-gray-950">Itemized</option>
                                            </select>
                                        </div>
									</div>
									{isTaxDeductible === "Yes" && (
                                        <CurrencyInput label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} />
									)}
								</div>
							</div>
						)}

						{selectedType === DependentExpense && (
							<div className="space-y-4">
								<div className="grid grid-cols-2 gap-4">
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											Start Date
										</label>
										<input
											type="date"
											className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-md focus:outline-none focus:border-green-500 transition-colors h-[42px]"
											value={startDate}
											onChange={(e) => setStartDate(e.target.value)}
										/>
									</div>
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
									<div>
										<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
											Tax Deductible
										</label>
                                        <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 h-[42px] flex items-center">
                                            <select
                                                className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                                                value={isTaxDeductible}
                                                onChange={(e) => setIsTaxDeductible(e.target.value as any)}
                                            >
                                                <option value="Yes" className="bg-gray-950">Yes</option>
                                                <option value="No" className="bg-gray-950">No</option>
                                        		<option value="Itemized" className="bg-gray-950">Itemized</option>
                                            </select>
                                        </div>
									</div>
									{isTaxDeductible === "Yes" && (
                                        <CurrencyInput label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} />
									)}
								</div>
							</div>
						)}

						{selectedType === IncomeDeductionExpense && (
                            <div>
                                <label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
                                    Linked Income Account
                                </label>
                                <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 h-[42px] flex items-center">
                                    <select
                                        className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
                                        value={selectedIncomeId}
                                        onChange={(e) => setSelectedIncomeId(e.target.value)}
                                    >
                                        <option value="" disabled className="bg-gray-950">Select an income source...</option>
                                        {incomes.map((inc) => (
                                            <option key={inc.id} value={inc.id} className="bg-gray-950">
                                                {inc.name} ({inc.amount})
                                            </option>
                                        ))}
                                    </select>
                                </div>
								<div>
									<label className="block text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
										Tax Deductible
									</label>
									<div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2 h-[42px] flex items-center">
										<select
											className="bg-transparent border-none outline-none text-white text-md font-semibold w-full p-0 m-0 appearance-none cursor-pointer"
											value={isTaxDeductible}
											onChange={(e) => setIsTaxDeductible(e.target.value as any)}
										>
											<option value="Yes" className="bg-gray-950">Yes</option>
											<option value="No" className="bg-gray-950">No</option>
                                        	<option value="Itemized" className="bg-gray-950">Itemized</option>
										</select>
									</div>
								</div>
								{isTaxDeductible === "Yes" && (
									<CurrencyInput label="Deductible Amount" value={taxDeductibleAmount} onChange={setTaxDeductibleAmount} />
								)}
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