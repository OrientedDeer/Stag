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
import { CurrencyInput } from "../Layout/CurrencyInput";
import DeleteIncomeControl from './DeleteIncomeUI';
import { NameInput } from "../Layout/NameInput";
import { DropdownInput } from "../Layout/DropdownInput";
import { AccountContext } from "../Accounts/AccountContext";
import { InvestedAccount } from "../Accounts/models";

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
    const { accounts } = useContext(AccountContext);

    // --- UNIFIED UPDATER ---
	const handleFieldUpdate = (field: AllIncomeKeys, value: any) => {
		dispatch({
			type: "UPDATE_INCOME_FIELD",
			payload: { id: income.id, field, value },
		});
	};

    const handleMatchAccountChange = (newAccountId: string | null) => {
        const account = accounts.find(acc => acc.id === newAccountId) as InvestedAccount | undefined;
        handleFieldUpdate("matchAccountId", newAccountId);
        handleFieldUpdate("taxType", account ? account.taxType : null);
    };

    const handleDateChange = (field: AllIncomeKeys, dateString: string) => {
        if (!dateString) return;
        const newDate = new Date(`${dateString}T00:00:00.000Z`);
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

    const contributionAccounts = accounts.filter(
        (acc) => acc instanceof InvestedAccount && 
                 acc.isContributionEligible === true &&
                 (acc.taxType === 'Roth 401k' || acc.taxType === 'Traditional 401k')
    );

	return (
		<div className="w-full">
			<div className="flex gap-4 mb-4">
				<div className={`w-8 h-8 mt-1 rounded-full flex items-center justify-center shadow-lg ${getIconBg()} text-md font-bold text-white`}>
					{getDescriptor().slice(0, 1)}
				</div>
				<div className="grow"> 
					<NameInput 
						label=""
						id={income.id}
						value={income.name}
						onChange={(val) => handleFieldUpdate("name", val)}
					/>
				</div>
				<div className="text-chart-Red-75 ml-auto">
					<DeleteIncomeControl incomeId={income.id} />
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {/* Simplified Currency Input */}
                <CurrencyInput
					id={`${income.id}-amount`}
                    label="Amount"
                    value={income.amount}
                    onChange={(val) => handleFieldUpdate("amount", val)}
                />
                
                <StyledSelect
					id={`${income.id}-frequency`}
                    label="Frequency"
                    value={income.frequency}
                    onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                    options={["Weekly", "Monthly", "Annually"]}
                />

				{!(income instanceof SocialSecurityIncome) && (
					<StyledSelect
						id={`${income.id}-earned-income`}
						label="Earned Income"
						value={income.earned_income}
						onChange={(e) => handleFieldUpdate("earned_income", e.target.value)}
						options={["Yes", "No"]}
					/>
				)}

				{income instanceof WorkIncome && (
                    <>
                        <CurrencyInput
                            id={`${income.id}-pre-tax-contributions`}
                            label="Pre-Tax Contributions"
                            value={income.preTax401k}
                            onChange={(val) => handleFieldUpdate("preTax401k", val)}
                        />
                        <CurrencyInput
                            id={`${income.id}-insurance`}
                            label="Insurance"
                            value={income.insurance}
                            onChange={(val) => handleFieldUpdate("insurance", val)}
                        />
                        <CurrencyInput
                            id={`${income.id}-roth-contributions`}
                            label="Roth Contributions"
                            value={income.roth401k}
                            onChange={(val) => handleFieldUpdate("roth401k", val)}
                        />
                        <CurrencyInput
                            id={`${income.id}-employer-match`}
                            label="Employer Match"
                            value={income.employerMatch}
                            onChange={(val) => handleFieldUpdate("employerMatch", val)}
                        />
                        {income.employerMatch > 0 && (
                            <DropdownInput
                                label="Match Account"
                                onChange={(val) => handleMatchAccountChange(val)}
                                options={contributionAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                value={income.matchAccountId}
                            />
                        )}
                    </>
				)}
				
				{income instanceof SocialSecurityIncome && (
					<StyledInput
						id={`${income.id}-claiming-age`}
						label="Claiming Age"
						type="number"
						value={income.claimingAge}
						onChange={(e) => handleFieldUpdate("claimingAge", parseFloat(e.target.value))}
					/>
				)}

                {income instanceof PassiveIncome && (
                    <StyledSelect
						id={`${income.id}-source-type`}
                        label="Source Type"
                        value={income.sourceType}
                        onChange={(e) => handleFieldUpdate("sourceType", e.target.value)}
                        options={["Dividend", "Rental", "Royalty", "Other"]}
                    />
                )}
				<StyledInput 
					id={`${income.id}-end-date`}
					label="End Date" 
					type="date" 
					value={formatDate(income.end_date)} 
					onChange={(e) => handleDateChange("end_date", e.target.value)} 
				/>
			</div>
		</div>
	);
};

export default IncomeCard;