import React, { useState, useContext } from "react";
import { IncomeContext } from "./IncomeContext";
import { 
  WorkIncome, 
  SocialSecurityIncome, 
  PassiveIncome, 
  WindfallIncome
} from './models';
import { CurrencyInput } from "../Layout/CurrencyInput";
import { NameInput } from "../Layout/NameInput";
import { DropdownInput } from "../Layout/DropdownInput";
import { NumberInput } from "../Layout/NumberInput";

const generateUniqueId = () =>
    `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddIncomeModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AddIncomeModal: React.FC<AddIncomeModalProps> = ({ isOpen, onClose }) => {
    const { dispatch } = useContext(IncomeContext);
    const [step, setStep] = useState<'select' | 'details'>('select');
    const [selectedType, setSelectedType] = useState<any>(null);
    const [name, setName] = useState("");
    const [amount, setAmount] = useState<number>(0);
    const [frequency, setFrequency] = useState<'Weekly' | 'Monthly' | 'Annually'>('Monthly');
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    
    // --- New Deductions State ---
    const [earnedIncome, setEarnedIncome] = useState<'Yes' | 'No'>('Yes');
    const [preTax401k, setPreTax401k] = useState<number>(0);
    const [insurance, setInsurance] = useState<number>(0);
    const [roth401k, setRoth401k] = useState<number>(0);
    
    // --- Other Fields ---
    const [claimingAge, setClaimingAge] = useState<number>(62);
    const [sourceType, setSourceType] = useState<string>('Dividend');
        
    const id = generateUniqueId();
    
    const handleClose = () => {
        setStep('select');
        setSelectedType(null);
        setName("");
        setAmount(0);
        setPreTax401k(0);
        setInsurance(0);
        setRoth401k(0);
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
        setStep('details');
    };

    const handleAdd = () => {
        if (!name.trim() || !selectedType) return;

        const finalEndDate = new Date(`${endDate}T00:00:00.000Z`);
        let newIncome;

        if (selectedType === WorkIncome) {
            newIncome = new WorkIncome(id, name.trim(), amount, frequency, finalEndDate, "Yes", preTax401k, insurance, roth401k);
        } else if (selectedType === SocialSecurityIncome) {
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, claimingAge);
        } else if (selectedType === PassiveIncome) {
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, "Yes", sourceType);
        } else if (selectedType === WindfallIncome) {
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, "No");
        } else {
             // Fallback
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, "Yes");
        }

        dispatch({ type: "ADD_INCOME", payload: newIncome });
        handleClose(); 
    };

    if (!isOpen) return null;

    const incomeCategories = [
        { label: 'Work', class: WorkIncome },
        { label: 'Social Security', class: SocialSecurityIncome },
        { label: 'Passive Income', class: PassiveIncome },
        { label: 'Windfall', class: WindfallIncome }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm min-w-max">
			<div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-md overflow-y-auto text-white">
				<h2 className="text-xl font-bold mb-6 border-b border-gray-800 pb-3">
                  {step === 'select' ? 'Select Income Type' : `New ${selectedType.name.replace('Income', '')}`}
                </h2>

                {step === 'select' ? (
                    <div className="grid grid-cols-2 gap-4">
                        {incomeCategories.map((cat) => (
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
                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-2">
                                <NameInput label="Income Name" id={id} value={name} onChange={setName} />
                            </div>
                            
                            <div className="col-span-1">
                                <DropdownInput
                                    label="Frequency"
                                    onChange={(val) => setFrequency(val as "Weekly" | "Monthly" | "Annually")}
                                    options={["Weekly", "Monthly", "Annually"]}
                                    value={frequency}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <CurrencyInput label="Gross Amount" value={amount} onChange={setAmount} />
                            {selectedType === WorkIncome && (
                                <>
                                    <CurrencyInput label="Pre-Tax 401k/403b" value={preTax401k} onChange={setPreTax401k} />
                                    <CurrencyInput label="Medical/Dental/Vision" value={insurance} onChange={setInsurance} />
                                    <CurrencyInput label="Roth 401k (Post-Tax)" value={roth401k} onChange={setRoth401k} />
                                </>
                            )}
                            <div>
                                <label className="block text-xs text-gray-400 font-medium mb-0.5 uppercase tracking-wide">End Date</label>
                                <input 
                                    type="date" 
                                    className="w-full bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500 transition-colors h-[42px]"
                                    value={endDate} 
                                    onChange={(e) => setEndDate(e.target.value)} 
                                />
                            </div>
                            {selectedType === SocialSecurityIncome && (
                                <NumberInput label="Claiming Age" value={claimingAge} onChange={setClaimingAge} />
                            )}
                            {selectedType === PassiveIncome && (
                                <>
                                    <DropdownInput label="Source Type" value={sourceType} onChange={(val) => setSourceType(val as "Dividend" | "Rental" | "Royalty" | "Other")} options={["Dividend", "Rental", "Royalty", "Other"]} />
                                </>
                            )}
                            {selectedType !== SocialSecurityIncome && (
                                <DropdownInput label="Earned Income" value={earnedIncome} onChange={(val) => setEarnedIncome(val as "Yes" | "No")} options={["Yes", "No"]} />
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

export default AddIncomeModal;