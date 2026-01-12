import { useContext, useEffect, useCallback } from "react";
import {
    AnyIncome,
    WorkIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    PassiveIncome,
    WindfallIncome,
    INCOME_COLORS_BACKGROUND
} from "./models";
import { IncomeContext, AllIncomeKeys } from "./IncomeContext";
import { StyledInput, StyledSelect } from "../../Layout/InputFields/StyleUI";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import DeleteIncomeControl from './DeleteIncomeUI';
import { NameInput } from "../../Layout/InputFields/NameInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { AccountContext } from "../Accounts/AccountContext";
import { InvestedAccount } from "../../Objects/Accounts/models";

// Helper to format Date objects to YYYY-MM-DD for input fields
const formatDate = (date: Date | undefined): string => {
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
	const handleFieldUpdate = useCallback((field: AllIncomeKeys, value: any) => {
		dispatch({
			type: "UPDATE_INCOME_FIELD",
			payload: { id: income.id, field, value },
		});
	}, [dispatch, income.id]);

    const handleMatchAccountChange = useCallback((newAccountId: string | null) => {
        const account = accounts.find(acc => acc.id === newAccountId) as InvestedAccount | undefined;
        handleFieldUpdate("matchAccountId", newAccountId);
        handleFieldUpdate("taxType", account ? account.taxType : null);
    }, [accounts, handleFieldUpdate]);

    const contributionAccounts = accounts.filter(
        (acc) => acc instanceof InvestedAccount && 
                 acc.isContributionEligible === true &&
                 (acc.taxType === 'Roth 401k' || acc.taxType === 'Traditional 401k')
    );

    const isWorkIncome = income instanceof WorkIncome;
    const matchAccountId = isWorkIncome ? income.matchAccountId : undefined;
    const employerMatch = isWorkIncome ? income.employerMatch : undefined;

     useEffect(() => {
        if (isWorkIncome && typeof employerMatch === 'number' &&  employerMatch > 0 && contributionAccounts.length > 0) {
            const accountExists = contributionAccounts.some(acc => acc.id === matchAccountId);
             if (!accountExists) {
                 handleMatchAccountChange(contributionAccounts[0].id);
             }
         }
    }, [isWorkIncome, matchAccountId, employerMatch, contributionAccounts, handleMatchAccountChange]);
 
    const handleDateChange = (field: AllIncomeKeys, dateString: string) => {
        if (!dateString) {
            handleFieldUpdate(field, undefined);
            return;
        }
        // Create date based on local timezone
        handleFieldUpdate(field, new Date(dateString));
    };

	const getDescriptor = () => {
		if (income instanceof WorkIncome) return "WORK";
		if (income instanceof SocialSecurityIncome) return "SS";
		if (income instanceof CurrentSocialSecurityIncome) return "SS";
		if (income instanceof FutureSocialSecurityIncome) return "SS";
		if (income instanceof PassiveIncome) return "PASSIVE";
		if (income instanceof WindfallIncome) return "WINDFALL";
		return "INCOME";
	};

	const getIconBg = () => {
		if (income instanceof WorkIncome) return INCOME_COLORS_BACKGROUND["Work"];
		if (income instanceof SocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
		if (income instanceof CurrentSocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
		if (income instanceof FutureSocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
		if (income instanceof PassiveIncome) return INCOME_COLORS_BACKGROUND["Passive"];
		if (income instanceof WindfallIncome) return INCOME_COLORS_BACKGROUND["Windfall"];
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
                {/* Amount field - read-only for FutureSocialSecurityIncome */}
                {income instanceof FutureSocialSecurityIncome ? (
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">
                            Monthly Benefit (Auto-Calculated)
                        </label>
                        <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300">
                            {income.calculatedPIA > 0
                                ? `$${income.calculatedPIA.toFixed(2)}/month`
                                : 'Will be calculated at claiming age'}
                        </div>
                    </div>
                ) : (
                    <CurrencyInput
                        id={`${income.id}-amount`}
                        label="Amount"
                        value={income.amount}
                        onChange={(val) => handleFieldUpdate("amount", val)}
                    />
                )}

                {!(income instanceof FutureSocialSecurityIncome) && (
                    <StyledSelect
                        id={`${income.id}-frequency`}
                        label="Frequency"
                        value={income.frequency}
                        onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                        options={["Weekly", "Monthly", "Annually"]}
                    />
                )}

				{!(income instanceof SocialSecurityIncome || income instanceof CurrentSocialSecurityIncome || income instanceof FutureSocialSecurityIncome) && (
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
                            id={`${income.id}-roth-contributions`}
                            label="Roth Contributions"
                            value={income.roth401k}
                            onChange={(val) => handleFieldUpdate("roth401k", val)}
                        />
                        <CurrencyInput
                            id={`${income.id}-insurance`}
                            label="Insurance"
                            value={income.insurance}
                            onChange={(val) => handleFieldUpdate("insurance", val)}
                        />
                        <CurrencyInput
                            id={`${income.id}-employer-match`}
                            label="Employer Match"
                            value={income.employerMatch}
                            onChange={(val) => handleFieldUpdate("employerMatch", val)}
                        />
                        <DropdownInput
                            id={`${income.id}-contribution-growth`}
                            label="Contribution Growth"
                            onChange={(val) => handleFieldUpdate("contributionGrowthStrategy", val)}
                            options={[
                                { value: 'FIXED', label: 'Remain Fixed' },
                                { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                                { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' }
                            ]}
                            value={income.contributionGrowthStrategy}
                        />
                        {income.employerMatch > 0 && (
                            <DropdownInput
                                label="Match Account"
                                onChange={(val) => handleMatchAccountChange(val)}
                                options={contributionAccounts.map(acc => ({ value: acc.id || "", label: acc.name }))}
                                value={income.matchAccountId}
                            />
                        )}
                    </>
				)}

				{income instanceof FutureSocialSecurityIncome && (
					<>
						<StyledInput
							id={`${income.id}-claiming-age`}
							label="Claiming Age (62-70)"
							type="number"
							min="62"
							max="70"
							value={income.claimingAge}
							onChange={(e) => {
								const val = Math.max(62, Math.min(70, parseFloat(e.target.value) || 62));
								handleFieldUpdate("claimingAge", val);
							}}
						/>
						{income.calculatedPIA > 0 && (
							<div className="col-span-2">
								<label className="block text-sm font-medium text-gray-400 mb-1">
									Calculation Details
								</label>
								<div className="bg-blue-900/20 border border-blue-700/50 rounded-lg px-3 py-2 text-xs text-gray-300">
									<div>• AIME calculation based on 35 highest earning years</div>
									<div>• Calculated in year: {income.calculationYear || 'Pending'}</div>
									<div>• Benefits auto-adjusted for COLA each year</div>
								</div>
							</div>
						)}
					</>
				)}

				{income instanceof CurrentSocialSecurityIncome && (
					<div className="col-span-3">
						<div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">
							<div className="font-semibold text-gray-300 mb-1">Current Social Security Benefits</div>
							<div>• For disability (SSDI), survivor, or retirement benefits already receiving</div>
							<div>• Amount will automatically adjust with COLA (Cost of Living Adjustment)</div>
						</div>
					</div>
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

				{/* Date fields - read-only for FutureSocialSecurityIncome (auto-calculated) */}
				{income instanceof FutureSocialSecurityIncome ? (
					<>
						<div>
							<label className="block text-sm font-medium text-gray-400 mb-1">
								Start Date (Auto-Calculated)
							</label>
							<div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 text-sm">
								{income.startDate ? formatDate(income.startDate) : `At claiming age ${income.claimingAge}`}
							</div>
						</div>
						<div>
							<label className="block text-sm font-medium text-gray-400 mb-1">
								End Date (Auto-Calculated)
							</label>
							<div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 text-sm">
								{income.end_date ? formatDate(income.end_date) : 'At life expectancy'}
							</div>
						</div>
					</>
				) : (
					<>
						<StyledInput
							id={`${income.id}-start-date`}
							label="Start Date"
							type="date"
							value={formatDate(income.startDate)}
							onChange={(e) => handleDateChange("startDate", e.target.value)}
						/>

						<StyledInput
							id={`${income.id}-end-date`}
							label="End Date"
							type="date"
							value={formatDate(income.end_date)}
							onChange={(e) => handleDateChange("end_date", e.target.value)}
						/>
					</>
				)}
			</div>
		</div>
	);
};

export default IncomeCard;