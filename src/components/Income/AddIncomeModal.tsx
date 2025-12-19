import React, { useState, useContext } from "react";
import { IncomeContext } from "./IncomeContext";
import { 
  WorkIncome, 
  SocialSecurityIncome, 
  PassiveIncome, 
  WindfallIncome
} from '../../components/Income/models';

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
    const [frequency, setFrequency] = useState<'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually'>('Monthly');
    const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
    
    // --- New State for Optional Fields ---
    const [claimingAge, setClaimingAge] = useState<number>(62);
    const [sourceType, setSourceType] = useState<string>('Dividend');
    const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
    
    const handleClose = () => {
        setStep('select');
        setSelectedType(null);
        setName("");
        setAmount(0);
        onClose();
    };

    const handleCancelOrBack = () => {
        if (step === 'details') {
            // If in details, go back to selection screen
            setStep('select');
            setSelectedType(null);
        } else {
            // If already in selection screen, close the modal
            handleClose();
        }
    };

    const handleTypeSelect = (typeClass: any) => {
        setSelectedType(() => typeClass);
        setStep('details');
    };

    const handleAdd = () => {
        if (!name.trim() || !selectedType) return;

        const id = generateUniqueId();
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const finalEndDate = new Date(endDate);

        let newIncome;

        // --- Logic to handle different constructors based on class ---
        if (selectedType === SocialSecurityIncome) {
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, claimingAge);
        } else if (selectedType === PassiveIncome) {
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, sourceType);
        } else if (selectedType === WindfallIncome) {
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate, new Date(receiptDate));
        } else {
            // Default (WorkIncome)
            newIncome = new selectedType(id, name.trim(), amount, frequency, finalEndDate);
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-bold text-white mb-6 border-b border-gray-800 pb-3">
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
                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Name</label>
                            <input autoFocus className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={name} onChange={(e) => setName(e.target.value)} />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-400 mb-1">Amount ($)</label>
                            <input type="number" className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Frequency</label>
                                <select className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none appearance-none" value={frequency} onChange={(e) => setFrequency(e.target.value as any)}>
                                    <option value="Weekly">Weekly</option>
                                    <option value="BiWeekly">Bi-Weekly</option>
                                    <option value="Monthly">Monthly</option>
                                    <option value="Annually">Annually</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">End Date</label>
                                <input type="date" className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                            </div>
                        </div>

                        {/* --- Specialized Fields --- */}
                        {selectedType === SocialSecurityIncome && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Claiming Age</label>
                                <input type="number" className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={claimingAge} onChange={(e) => setClaimingAge(Number(e.target.value))} />
                            </div>
                        )}

                        {selectedType === PassiveIncome && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Source Type</label>
                                <select className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                                    <option value="Dividend">Dividend</option>
                                    <option value="Rental">Rental</option>
                                    <option value="Royalty">Royalty</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                        )}

                        {selectedType === WindfallIncome && (
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-1">Receipt Date</label>
                                <input type="date" className="w-full bg-gray-950 text-white border border-gray-700 rounded-lg p-3 focus:border-green-300 outline-none" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 mt-8">
                    {/* Conditionally render "Back" vs "Cancel" based on the step */}
                    <button 
                        onClick={handleCancelOrBack}
                        className="px-5 py-2.5 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                    >
                        {step === 'details' ? 'Back' : 'Cancel'}
                    </button>
                    {step === 'details' && (
                        <button 
                            onClick={handleAdd}
                            disabled={!name.trim()}
                            className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                        >
                            Add Income
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AddIncomeModal;