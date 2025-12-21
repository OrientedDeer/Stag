import { useContext } from "react";
import { 
    AnyIncome, 
    WorkIncome, 
    SocialSecurityIncome, 
    PassiveIncome, 
    WindfallIncome,
    INCOME_COLORS_BACKGROUND 
} from "./models";
import { IncomeContext, AllIncomeKeys } from "./IncomeContext";
import { StyledInput, StyledSelect } from "../Layout/StyleUI";
import { CurrencyInput } from "../Layout/CurrencyInput"; // Import new component
import DeleteIncomeControl from './DeleteIncomeUI';

// Helper to format Date objects to YYYY-MM-DD for input fields
const formatDate = (date: Date): string => {
    if (!date) return "";
    try {
        return date.toISOString().split('T')[0];
    } catch (e) {
        return "";
    }
};

const IncomeCard = ({ income }: { income: AnyIncome }) => {
	const { dispatch } = useContext(IncomeContext);

    // --- UNIFIED UPDATER ---
	const handleFieldUpdate = (field: AllIncomeKeys, value: any) => {
		dispatch({
			type: "UPDATE_INCOME_FIELD",
			payload: { id: income.id, field, value },
		});
	};

    const handleDateChange = (field: AllIncomeKeys, dateString: string) => {
        if (!dateString) return;
        const newDate = new Date(dateString);
        handleFieldUpdate(field, newDate);
    };

	const getDescriptor = () => {
		if (income instanceof WorkIncome) return "WORK";
		if (income instanceof SocialSecurityIncome) return "SS";
		if (income instanceof PassiveIncome) return "PASSIVE";
		if (income instanceof WindfallIncome) return "WINDFALL";
		return "INCOME";
	};

	const getIconBg = () => {
		if (income instanceof WorkIncome) return INCOME_COLORS_BACKGROUND["Work"];
		if (income instanceof SocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
		if (income instanceof PassiveIncome) return INCOME_COLORS_BACKGROUND["Passive"];
		if (income instanceof WindfallIncome) return INCOME_COLORS_BACKGROUND["Windfall"];
		return "bg-gray-500";
	};

	return (
		<div className="w-full">
			<div className="flex gap-4 mb-4">
				<div
					className={`w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-md font-bold text-white`}
				>
					{getDescriptor().slice(0, 1)}
				</div>
				<div className="grow"> 
					<input
						type="text"
						value={income.name}
						onChange={(e) => handleFieldUpdate("name", e.target.value)}
						className="text-xl font-bold text-white bg-transparent focus:outline-none focus:ring-1 focus:ring-green-300 rounded p-1 -m-1 w-full" 
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteIncomeControl incomeId={income.id} />
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {/* Simplified Currency Input */}
                <CurrencyInput
                    label="Amount"
                    value={income.amount}
                    onChange={(val) => handleFieldUpdate("amount", val)}
                />
                
                <StyledSelect
                    label="Frequency"
                    value={income.frequency}
                    onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                    options={["Weekly", "Monthly", "Annually"]}
                />

				<StyledSelect
                    label="Taxable"
                    value={income.taxable}
                    onChange={(e) => handleFieldUpdate("taxable", e.target.value)}
                    options={["Yes", "No"]}
                />

				{income instanceof SocialSecurityIncome && (
					<StyledInput
						label="Claiming Age"
						type="number"
						value={income.claimingAge}
						onChange={(e) => handleFieldUpdate("claimingAge", parseFloat(e.target.value))}
					/>
				)}

                {income instanceof PassiveIncome && (
                    <StyledSelect
                        label="Source Type"
                        value={income.sourceType}
                        onChange={(e) => handleFieldUpdate("sourceType", e.target.value)}
                        options={["Dividend", "Rental", "Royalty", "Other"]}
                    />
                )}

                {income instanceof WindfallIncome && (
                     <StyledInput
                        label="Receipt Date"
                        type="date"
                        value={formatDate(income.receipt_date)}
                        onChange={(e) => handleDateChange("receipt_date", e.target.value)}
                    />
                )}
			</div>
		</div>
	);
};

export default IncomeCard;