import React, { useState, useContext, useEffect } from "react";
import { IncomeContext } from "./IncomeContext";
import {
  WorkIncome,
  SocialSecurityIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
  PassiveIncome,
  WindfallIncome,
  ContributionGrowthStrategy,
  calculateSocialSecurityStartDate
} from './models';
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { AccountContext } from "../Accounts/AccountContext";
import { InvestedAccount } from "../../Objects/Accounts/models";
import { StyledInput } from "../../Layout/InputFields/StyleUI";
import { AssumptionsContext } from "../Assumptions/AssumptionsContext";
import { getClaimingAdjustment } from "../../../data/SocialSecurityData";

const generateUniqueId = () =>
    `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddIncomeModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AddIncomeModal: React.FC<AddIncomeModalProps> = ({ isOpen, onClose }) => {
    const { dispatch } = useContext(IncomeContext);
    const { accounts } = useContext(AccountContext);
    const { state: assumptions } = useContext(AssumptionsContext);

    const [step, setStep] = useState<'select' | 'details'>('select');
    const [selectedType, setSelectedType] = useState<any>(null);
    const [name, setName] = useState("");
    const [amount, setAmount] = useState<number>(0);
    const [frequency, setFrequency] = useState<'Weekly' | 'Monthly' | 'Annually'>('Monthly');
    const [endDate, setEndDate] = useState("");
    const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

    // --- New Deductions State ---
    const [earnedIncome, setEarnedIncome] = useState<'Yes' | 'No'>('Yes');
    const [preTax401k, setPreTax401k] = useState<number>(0);
    const [insurance, setInsurance] = useState<number>(0);
    const [roth401k, setRoth401k] = useState<number>(0);
    const [employerMatch, setEmployerMatch] = useState<number>(0);
    const [matchAccountId, setMatchAccountId] = useState<string>("");
    const [contributionGrowthStrategy, setContributionGrowthStrategy] = useState<ContributionGrowthStrategy>('FIXED');

    // --- Other Fields ---
    const [claimingAge, setClaimingAge] = useState<number>(67); // Default to Full Retirement Age
    const [sourceType, setSourceType] = useState<'Dividend' | 'Rental' | 'Royalty' | 'Other'>('Dividend');
    const [dateError, setDateError] = useState<string | undefined>();

    // Called on blur for claiming age - clamp to valid range
    const handleClaimingAgeBlur = () => {
        if (claimingAge < 62) setClaimingAge(62);
        else if (claimingAge > 70) setClaimingAge(70);
    };

    // Validate end date is after start date
    const validateDates = (start: string, end: string) => {
        if (start && end && new Date(end) < new Date(start)) {
            setDateError("End date must be after start date");
        } else {
            setDateError(undefined);
        }
    };

    const id = generateUniqueId();
    
    const contributionAccounts = accounts.filter(
        (acc) => acc instanceof InvestedAccount && 
                 acc.isContributionEligible === true &&
                 (acc.taxType === 'Roth 401k' || acc.taxType === 'Traditional 401k')
    );

    useEffect(() => {
        if (selectedType === WorkIncome && contributionAccounts.length > 0 && !matchAccountId) {
            setMatchAccountId(contributionAccounts[0].id);
        }
    }, [selectedType, contributionAccounts, matchAccountId]);
    
    const handleClose = () => {
        setStep('select');
        setSelectedType(null);
        setName("");
        setAmount(0);
        setFrequency('Monthly');
        setEarnedIncome('Yes');
        setPreTax401k(0);
        setInsurance(0);
        setRoth401k(0);
        setEmployerMatch(0);
        setMatchAccountId("");
        setContributionGrowthStrategy('FIXED');
        setClaimingAge(67);
        setSourceType('Dividend');
        setStartDate(new Date().toISOString().split('T')[0]);
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
        setStep('details');
    };

    const handleAdd = () => {
        if (!selectedType || !name.trim() || dateError) return;

		const finalStartDate = startDate ? new Date(`${startDate}T00:00:00.000Z`) : undefined;
		const finalEndDate = endDate ? new Date(`${endDate}T00:00:00.000Z`) : undefined;
        let newIncome;

        if (selectedType === WorkIncome) {
            const matchedAccount = accounts.find(acc => acc.id === matchAccountId) as InvestedAccount | undefined;
            const taxType = matchedAccount ? matchedAccount.taxType : null;
            newIncome = new WorkIncome(id, name.trim(), amount, frequency, "Yes", preTax401k, insurance, roth401k, employerMatch, matchAccountId, taxType, contributionGrowthStrategy, finalStartDate, finalEndDate);
        } else if (selectedType === CurrentSocialSecurityIncome) {
            // Current benefits: User enters amount, uses start/end dates
            newIncome = new CurrentSocialSecurityIncome(id, name.trim(), amount, frequency, finalStartDate, finalEndDate);
        } else if (selectedType === FutureSocialSecurityIncome) {
            // Future benefits: Auto-calculated, no amount input needed
            // Start date will be set by SimulationEngine when reaching claiming age
            // End date will be set to life expectancy
            newIncome = new FutureSocialSecurityIncome(id, name.trim(), claimingAge, 0, 0, undefined, undefined);
        } else if (selectedType === SocialSecurityIncome) {
            // Legacy SocialSecurityIncome (keep for backward compatibility)
            const ssStartDate = calculateSocialSecurityStartDate(
                assumptions.demographics.startAge,
                assumptions.demographics.startYear,
                claimingAge
            );
            newIncome = new SocialSecurityIncome(id, name.trim(), amount, frequency, claimingAge, undefined, ssStartDate, finalEndDate);
        } else if (selectedType === PassiveIncome) {
            newIncome = new PassiveIncome(id, name.trim(), amount, frequency, "Yes", sourceType, finalStartDate, finalEndDate);
        } else if (selectedType === WindfallIncome) {
            newIncome = new WindfallIncome(id, name.trim(), amount, frequency, "No", finalStartDate, finalEndDate);
        } else {
             // Fallback
            newIncome = new selectedType(id, name.trim(), amount, frequency, "Yes", finalStartDate, finalEndDate);
        }

        dispatch({ type: "ADD_INCOME", payload: newIncome });
        handleClose();
    };

    if (!isOpen) return null;

    const incomeCategories = [
        { label: 'Work', class: WorkIncome },
        { label: 'Current Social Security', class: CurrentSocialSecurityIncome },
        { label: 'Future Social Security', class: FutureSocialSecurityIncome },
        { label: 'Passive Income', class: PassiveIncome },
        { label: 'Windfall', class: WindfallIncome }
    ];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
			<div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg">
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
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            {selectedType === FutureSocialSecurityIncome ? (
                                <>
                                    <div className="col-span-2">
                                        <NameInput
                                            label="Income Name"
                                            id={id}
                                            value={name}
                                            onChange={setName}
                                        />
                                    </div>
                                    <div className="col-span-1">
                                        <NumberInput
                                            label="Claiming Age (62-70)"
                                            value={claimingAge}
                                            onChange={setClaimingAge}
                                            onBlur={handleClaimingAgeBlur}
                                            tooltip="Age 62: earliest, reduced benefits. Age 67: full benefits. Age 70: maximum benefits (132% of full)."
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="col-span-2 lg:col-span-2">
                                        <NameInput
                                            label="Income Name"
                                            id={id}
                                            value={name}
                                            onChange={setName}
                                        />
                                    </div>

                                    <div className="col-span-2 lg:col-span-1">
                                        <DropdownInput
                                            label="Frequency"
                                            onChange={(val) => setFrequency(val as "Weekly" | "Monthly" | "Annually")}
                                            options={["Weekly", "Monthly", "Annually"]}
                                            value={frequency}
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            {/* Hide amount input for FutureSocialSecurityIncome - it's auto-calculated */}
                            {selectedType !== FutureSocialSecurityIncome && (
                                <CurrencyInput label="Gross Amount" value={amount} onChange={setAmount} />
                            )}
                            {selectedType === WorkIncome && (
                                <>
                                    <CurrencyInput label="Pre-Tax 401k/403b" value={preTax401k} onChange={setPreTax401k} tooltip="Monthly contribution to traditional 401k/403b. Reduces taxable income now, taxed on withdrawal." />
                                    <CurrencyInput label="Roth 401k (Post-Tax)" value={roth401k} onChange={setRoth401k} tooltip="Monthly contribution to Roth 401k. Taxed now, but grows and withdraws tax-free." />
                                    <CurrencyInput label="Insurance" value={insurance} onChange={setInsurance} tooltip="Monthly pre-tax deduction for health, dental, vision insurance." />
                                    <CurrencyInput label="Employer Match" value={employerMatch} onChange={setEmployerMatch} tooltip="Monthly amount your employer contributes to your 401k. Free money!" />
                                    {(preTax401k > 0 || roth401k > 0) && (
                                        <DropdownInput
                                            label="Contribution Growth"
                                            onChange={(val) => setContributionGrowthStrategy(val as ContributionGrowthStrategy)}
                                            options={[
                                                { value: 'FIXED', label: 'Remain Fixed' },
                                                { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                                                { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' }
                                            ]}
                                            value={contributionGrowthStrategy}
                                            tooltip="Fixed: contributions stay the same. Grow with Salary: increase with raises. Track Max: always contribute IRS maximum."
                                        />
                                    )}
                                    {employerMatch > 0 && (
                                        <DropdownInput
                                            label="Match Account"
                                            onChange={(val) => setMatchAccountId(val)}
                                            options={contributionAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                            value={matchAccountId}
                                            tooltip="Which 401k account receives your employer's matching contributions."
                                        />
                                    )}
                                </>
                            )}
                            {/* Hide date fields for FutureSocialSecurityIncome - they're auto-calculated */}
                            {selectedType !== FutureSocialSecurityIncome && (
                                <>
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
                                </>
                            )}
                            {selectedType === CurrentSocialSecurityIncome && (
                                <>
                                    <div className="col-span-3 bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-sm">
                                        <div className="font-semibold text-gray-200 mb-2">Current Social Security Benefits</div>
                                        <div className="text-gray-400 space-y-1">
                                            <p className="break-words">• For disability (SSDI), survivor, or retirement benefits you're already receiving</p>
                                            <p className="break-words">• Enter your current monthly benefit amount</p>
                                            <p className="break-words">• Amount will automatically adjust with COLA (Cost of Living Adjustment)</p>
                                        </div>
                                    </div>
                                </>
                            )}
                            {selectedType === SocialSecurityIncome && (
                                <>
                                    <NumberInput
                                        label="Claiming Age (62-70)"
                                        value={claimingAge}
                                        onChange={setClaimingAge}
                                        onBlur={handleClaimingAgeBlur}
                                    />
                                    <div className="col-span-2 bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300">Benefit Adjustment:</span>
                                            <span className="font-bold text-blue-300">
                                                {(SocialSecurityIncome.calculateBenefitAdjustment(claimingAge) * 100).toFixed(1)}% of FRA
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                            <span className="text-gray-300">Benefits Start:</span>
                                            <span className="font-medium text-blue-200">
                                                {assumptions.demographics.startYear + (claimingAge - assumptions.demographics.startAge)}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-400 mt-2">
                                            {claimingAge < 67
                                                ? "Early claiming reduces benefits but you receive them longer."
                                                : claimingAge > 67
                                                ? "Delayed claiming increases benefits by 8% per year."
                                                : "Full Retirement Age: 100% of benefits."}
                                        </div>
                                    </div>
                                </>
                            )}
                            {selectedType === PassiveIncome && (
                                <>
                                    <DropdownInput label="Source Type" value={sourceType} onChange={(val) => setSourceType(val as "Dividend" | "Rental" | "Royalty" | "Other")} options={["Dividend", "Rental", "Royalty", "Other"]} tooltip="Type of passive income. May affect tax treatment." />
                                </>
                            )}
                            {selectedType !== SocialSecurityIncome &&
                             selectedType !== CurrentSocialSecurityIncome &&
                             selectedType !== FutureSocialSecurityIncome && (
                                <DropdownInput label="Earned Income" value={earnedIncome} onChange={(val) => setEarnedIncome(val as "Yes" | "No")} options={["Yes", "No"]} tooltip="Earned income (wages, self-employment) is subject to FICA taxes. Unearned income (investments, rental) is not." />
                            )}

                        </div>

                        {/* Info boxes for Future Social Security - outside grid to avoid stretching */}
                        {selectedType === FutureSocialSecurityIncome && (
                            <div className="space-y-3 mt-4 max-w-2xl">
                                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                                    <div className="text-sm font-semibold text-blue-200 mb-2">Automatic Calculation</div>
                                    <div className="text-xs text-gray-300 space-y-1">
                                        <p className="break-words">• Benefit calculated from your 35 highest earning years</p>
                                        <p className="break-words">• Uses SSA wage indexing and bend points formula</p>
                                        <p className="break-words">• Claiming at {claimingAge}: {(getClaimingAdjustment(claimingAge) * 100).toFixed(1)}% of FRA benefit</p>
                                        <p className="break-words">• Benefits start in {assumptions.demographics.startYear + (claimingAge - assumptions.demographics.startAge)}</p>
                                        <p className="break-words">• Benefits end at life expectancy (age {assumptions.demographics.lifeExpectancy})</p>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-400 break-words">
                                    Future retirement benefits will be automatically calculated during simulation based on your work income history.
                                    No need to enter an amount - it will be computed using the official SSA formula.
                                </div>
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
							disabled={!name.trim() || !!dateError}
							title={!name.trim() ? "Enter a name" : dateError ? "Fix date error" : undefined}
							className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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