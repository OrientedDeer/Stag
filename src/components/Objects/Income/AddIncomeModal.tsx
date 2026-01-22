import React, { useState, useContext, useEffect } from "react";
import { IncomeContext } from "./IncomeContext";
import {
  WorkIncome,
  SocialSecurityIncome,
  CurrentSocialSecurityIncome,
  FutureSocialSecurityIncome,
  FERSPensionIncome,
  CSRSPensionIncome,
  PassiveIncome,
  WindfallIncome,
  ContributionGrowthStrategy,
  AutoMax401kOption,
  ESPPContributionType,
  calculateSocialSecurityStartDate,
  IncomeFrequency
} from './models';
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { AccountContext } from "../Accounts/AccountContext";
import { InvestedAccount, ESPPAccount } from "../../Objects/Accounts/models";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { StyledInput } from "../../Layout/InputFields/StyleUI";
import { AssumptionsContext } from "../Assumptions/AssumptionsContext";
import { getClaimingAdjustment } from "../../../data/SocialSecurityData";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";
import { getFERSMRA, checkFERSEligibility, checkCSRSEligibility, calculateFERSBasicBenefit, calculateCSRSBasicBenefit } from "../../../data/PensionData";

const generateUniqueId = () =>
    `INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddIncomeModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type PassiveSourceType = 'Dividend' | 'Rental' | 'Royalty' | 'Other';
type EarnedIncomeOption = 'Yes' | 'No';

interface IncomeFormState {
    name: string;
    amount: number;
    frequency: IncomeFrequency;
    startDate: string;
    endDate: string;
    earnedIncome: EarnedIncomeOption;
    // Work income / 401k fields
    preTax401k: number;
    insurance: number;
    roth401k: number;
    employerMatch: number;
    matchAccountId: string;
    contributionGrowthStrategy: ContributionGrowthStrategy;
    hsaContribution: number;
    autoMax401k: AutoMax401kOption;
    // ESPP fields
    esppContributionType: ESPPContributionType;
    esppContributionAmount: number;
    esppDiscountPercent: number;
    esppHasLookback: boolean;
    esppAccountId: string;
    // Social Security fields
    claimingAge: number;
    // Passive income fields
    sourceType: PassiveSourceType;
    // Pension fields
    pensionYearsOfService: number;
    pensionHigh3Salary: number;
    pensionRetirementAge: number;
    autoCalculateHigh3: boolean;
    linkedIncomeId: string;
}

function getInitialFormState(): IncomeFormState {
    return {
        name: '',
        amount: 0,
        frequency: 'Monthly',
        startDate: `${new Date().getFullYear()}-01-01`,
        endDate: '',
        earnedIncome: 'Yes',
        preTax401k: 0,
        insurance: 0,
        roth401k: 0,
        employerMatch: 0,
        matchAccountId: '',
        contributionGrowthStrategy: 'FIXED',
        hsaContribution: 0,
        autoMax401k: 'custom',
        esppContributionType: 'NONE',
        esppContributionAmount: 0,
        esppDiscountPercent: 15,
        esppHasLookback: true,
        esppAccountId: '',
        claimingAge: 67,
        sourceType: 'Dividend',
        pensionYearsOfService: 20,
        pensionHigh3Salary: 0,
        pensionRetirementAge: 62,
        autoCalculateHigh3: false,
        linkedIncomeId: '',
    };
}

const AddIncomeModal: React.FC<AddIncomeModalProps> = ({ isOpen, onClose }) => {
    const { dispatch } = useContext(IncomeContext);
    const { accounts } = useContext(AccountContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const [step, setStep] = useState<'select' | 'details'>('select');
    const [selectedType, setSelectedType] = useState<any>(null);
    const [form, setForm] = useState<IncomeFormState>(getInitialFormState);
    const [dateError, setDateError] = useState<string | undefined>();

    const pensionBirthYear = assumptions.demographics.birthYear;

    function updateForm<K extends keyof IncomeFormState>(field: K, value: IncomeFormState[K]): void {
        setForm(prev => ({ ...prev, [field]: value }));
    }

    // Called on blur for claiming age - clamp to valid range
    function handleClaimingAgeBlur(): void {
        if (form.claimingAge < 62) updateForm('claimingAge', 62);
        else if (form.claimingAge > 70) updateForm('claimingAge', 70);
    }

    // Validate end date is after start date
    function validateDates(start: string, end: string): void {
        if (start && end && new Date(end) < new Date(start)) {
            setDateError("End date must be after start date");
        } else {
            setDateError(undefined);
        }
    }

    const id = generateUniqueId();

    const contributionAccounts = accounts.filter(
        (acc) => acc instanceof InvestedAccount &&
                 acc.isContributionEligible === true &&
                 (acc.taxType === 'Roth 401k' || acc.taxType === 'Traditional 401k')
    );

    // Get ESPP accounts for linking
    const esppAccounts = accounts.filter(acc => acc instanceof ESPPAccount);

    // Get work incomes for linking to pension (for auto High-3 calculation)
    const { incomes } = useContext(IncomeContext);
    const workIncomes = incomes.filter(inc => inc instanceof WorkIncome);

    useEffect(() => {
        if (selectedType === WorkIncome && contributionAccounts.length > 0 && !form.matchAccountId) {
            updateForm('matchAccountId', contributionAccounts[0].id);
        }
    }, [selectedType, contributionAccounts, form.matchAccountId]);

    // Auto-select first work income for pension linking
    useEffect(() => {
        if ((selectedType === FERSPensionIncome || selectedType === CSRSPensionIncome) &&
            workIncomes.length > 0 && !form.linkedIncomeId) {
            updateForm('linkedIncomeId', workIncomes[0].id);
        }
    }, [selectedType, workIncomes, form.linkedIncomeId]);

    const handleClose = () => {
        setStep('select');
        setSelectedType(null);
        setForm(getInitialFormState());
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
        if (!selectedType || !form.name.trim() || dateError) return;

        const finalStartDate = form.startDate ? new Date(`${form.startDate}T00:00:00.000Z`) : undefined;
        const finalEndDate = form.endDate ? new Date(`${form.endDate}T00:00:00.000Z`) : undefined;
        let newIncome;

        if (selectedType === WorkIncome) {
            const matchedAccount = accounts.find(acc => acc.id === form.matchAccountId) as InvestedAccount | undefined;
            const taxType = matchedAccount ? matchedAccount.taxType : null;
            const finalEsppAccountId = form.esppContributionType !== 'NONE' && form.esppAccountId ? form.esppAccountId : null;
            newIncome = new WorkIncome(
                id, form.name.trim(), form.amount, form.frequency, "Yes",
                form.preTax401k, form.insurance, form.roth401k, form.employerMatch,
                form.matchAccountId, taxType, form.contributionGrowthStrategy,
                finalStartDate, finalEndDate, form.hsaContribution, form.autoMax401k,
                form.esppContributionType, form.esppContributionAmount, form.esppDiscountPercent,
                form.esppHasLookback, 6, finalEsppAccountId, 7
            );
        } else if (selectedType === CurrentSocialSecurityIncome) {
            newIncome = new CurrentSocialSecurityIncome(
                id, form.name.trim(), form.amount, form.frequency, finalStartDate, finalEndDate
            );
        } else if (selectedType === FutureSocialSecurityIncome) {
            newIncome = new FutureSocialSecurityIncome(
                id, form.name.trim(), form.claimingAge, 0, 0, undefined, undefined
            );
        } else if (selectedType === SocialSecurityIncome) {
            const ssStartDate = calculateSocialSecurityStartDate(
                assumptions.demographics.birthYear, form.claimingAge
            );
            newIncome = new SocialSecurityIncome(
                id, form.name.trim(), form.amount, form.frequency,
                form.claimingAge, undefined, ssStartDate, finalEndDate
            );
        } else if (selectedType === FERSPensionIncome) {
            const retirementYear = assumptions.demographics.birthYear + form.pensionRetirementAge;
            const pensionStartDate = new Date(Date.UTC(retirementYear, 0, 1));
            const pensionEndDate = new Date(Date.UTC(
                assumptions.demographics.birthYear + assumptions.demographics.lifeExpectancy, 11, 31
            ));
            let effectiveHigh3 = form.pensionHigh3Salary;
            if (form.autoCalculateHigh3 && form.linkedIncomeId) {
                const linkedIncome = workIncomes.find(inc => inc.id === form.linkedIncomeId);
                if (linkedIncome) {
                    effectiveHigh3 = linkedIncome.getAnnualAmount();
                }
            }
            const estimatedBenefit = calculateFERSBasicBenefit(
                form.pensionYearsOfService, effectiveHigh3, form.pensionRetirementAge
            );
            newIncome = new FERSPensionIncome(
                id, form.name.trim(), form.pensionYearsOfService, effectiveHigh3,
                form.pensionRetirementAge, pensionBirthYear, estimatedBenefit, 0, 0,
                pensionStartDate, pensionEndDate,
                form.autoCalculateHigh3, form.autoCalculateHigh3 ? form.linkedIncomeId : null
            );
        } else if (selectedType === CSRSPensionIncome) {
            const retirementYear = assumptions.demographics.birthYear + form.pensionRetirementAge;
            const pensionStartDate = new Date(Date.UTC(retirementYear, 0, 1));
            const pensionEndDate = new Date(Date.UTC(
                assumptions.demographics.birthYear + assumptions.demographics.lifeExpectancy, 11, 31
            ));
            let effectiveHigh3 = form.pensionHigh3Salary;
            if (form.autoCalculateHigh3 && form.linkedIncomeId) {
                const linkedIncome = workIncomes.find(inc => inc.id === form.linkedIncomeId);
                if (linkedIncome) {
                    effectiveHigh3 = linkedIncome.getAnnualAmount();
                }
            }
            const estimatedBenefit = calculateCSRSBasicBenefit(form.pensionYearsOfService, effectiveHigh3);
            newIncome = new CSRSPensionIncome(
                id, form.name.trim(), form.pensionYearsOfService, effectiveHigh3,
                form.pensionRetirementAge, estimatedBenefit,
                pensionStartDate, pensionEndDate,
                form.autoCalculateHigh3, form.autoCalculateHigh3 ? form.linkedIncomeId : null
            );
        } else if (selectedType === PassiveIncome) {
            newIncome = new PassiveIncome(
                id, form.name.trim(), form.amount, form.frequency, "Yes",
                form.sourceType, finalStartDate, finalEndDate
            );
        } else if (selectedType === WindfallIncome) {
            newIncome = new WindfallIncome(
                id, form.name.trim(), form.amount, form.frequency, "No", finalStartDate, finalEndDate
            );
        } else {
            newIncome = new selectedType(
                id, form.name.trim(), form.amount, form.frequency, "Yes", finalStartDate, finalEndDate
            );
        }

        dispatch({ type: "ADD_INCOME", payload: newIncome });
        handleClose();
    };

    if (!isOpen) return null;

    const incomeCategories = [
        { label: 'Work', class: WorkIncome },
        { label: 'Current Social Security', class: CurrentSocialSecurityIncome },
        { label: 'Future Social Security', class: FutureSocialSecurityIncome },
        { label: 'FERS Pension', class: FERSPensionIncome },
        { label: 'CSRS Pension', class: CSRSPensionIncome },
        { label: 'Passive Income', class: PassiveIncome },
        { label: 'Windfall', class: WindfallIncome }
    ];

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-income-modal-title"
                className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg"
                onKeyDown={handleKeyDown}
            >
                <h2 id="add-income-modal-title" className="text-xl font-bold mb-6 border-b border-gray-800 pb-3">
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
                                            value={form.name}
                                            onChange={(val) => updateForm('name', val)}
                                        />
                                    </div>
                                    <div className="col-span-1">
                                        <NumberInput
                                            label="Claiming Age (62-70)"
                                            value={form.claimingAge}
                                            onChange={(val) => updateForm('claimingAge', val)}
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
                                            value={form.name}
                                            onChange={(val) => updateForm('name', val)}
                                        />
                                    </div>
                                    <div className="col-span-2 lg:col-span-1">
                                        <DropdownInput
                                            label="Frequency"
                                            onChange={(val) => updateForm('frequency', val as IncomeFrequency)}
                                            options={["Weekly", "Bi-Weekly", "Semi-Monthly", "Monthly", "Annually"]}
                                            value={form.frequency}
                                            tooltip="This only affects how we convert to annual amounts. The exact timing of paychecks doesn't affect the simulation."
                                        />
                                    </div>
                                </>
                            )}
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            {/* Hide amount input for auto-calculated income types */}
                            {selectedType !== FutureSocialSecurityIncome &&
                             selectedType !== FERSPensionIncome &&
                             selectedType !== CSRSPensionIncome && (
                                <CurrencyInput label="Gross Amount" value={form.amount} onChange={(val) => updateForm('amount', val)} tooltip="Your gross income before any deductions (taxes, 401k, insurance, etc.). This is NOT your take-home pay." />
                            )}
                            {selectedType === WorkIncome && (
                                <>
                                    <DropdownInput
                                        label="401k Contributions"
                                        onChange={(val) => updateForm('autoMax401k', val as AutoMax401kOption)}
                                        options={[
                                            { value: 'disabled', label: 'None' },
                                            { value: 'custom', label: 'Custom Amount' },
                                            { value: 'traditional', label: 'Max Pre-Tax' },
                                            { value: 'roth', label: 'Max Roth' }
                                        ]}
                                        value={form.autoMax401k}
                                        tooltip="None: No 401k. Custom: Enter amounts manually. Max Pre-Tax: Auto-max traditional 401k. Max Roth: Auto-max Roth 401k."
                                    />
                                    {form.autoMax401k === 'custom' && (
                                        <>
                                            <CurrencyInput label="Pre-Tax 401k/403b" value={form.preTax401k} onChange={(val) => updateForm('preTax401k', val)} tooltip="Monthly contribution to traditional 401k/403b. Reduces taxable income now, taxed on withdrawal." />
                                            <CurrencyInput label="Roth 401k" value={form.roth401k} onChange={(val) => updateForm('roth401k', val)} tooltip="Monthly contribution to Roth 401k. Taxed now, but grows and withdraws tax-free." />
                                            {(form.preTax401k > 0 || form.roth401k > 0) && (
                                                <DropdownInput
                                                    label="Contribution Growth"
                                                    onChange={(val) => updateForm('contributionGrowthStrategy', val as ContributionGrowthStrategy)}
                                                    options={[
                                                        { value: 'FIXED', label: 'Remain Fixed' },
                                                        { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                                                        { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' }
                                                    ]}
                                                    value={form.contributionGrowthStrategy}
                                                    tooltip="Fixed: contributions stay the same. Grow with Salary: increase with raises. Track Max: always contribute IRS maximum."
                                                />
                                            )}
                                        </>
                                    )}
                                    {form.autoMax401k !== 'disabled' && (
                                        <>
                                            <CurrencyInput label="Employer Match" value={form.employerMatch} onChange={(val) => updateForm('employerMatch', val)} tooltip="Monthly amount your employer contributes to your 401k. Free money!" />
                                            {form.employerMatch > 0 && (
                                                <DropdownInput
                                                    label="Match Account"
                                                    onChange={(val) => updateForm('matchAccountId', val)}
                                                    options={contributionAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                                    value={form.matchAccountId}
                                                    tooltip="Which 401k account receives your employer's matching contributions."
                                                />
                                            )}
                                        </>
                                    )}
                                    <CurrencyInput label="Insurance" value={form.insurance} onChange={(val) => updateForm('insurance', val)} tooltip="Monthly pre-tax deduction for health, dental, vision insurance." />
                                    <CurrencyInput label="HSA Contribution" value={form.hsaContribution} onChange={(val) => updateForm('hsaContribution', val)} tooltip="Monthly HSA contribution. Triple tax advantage: pre-tax, grows tax-free, tax-free withdrawals for medical expenses." />
                                    {/* ESPP Section */}
                                    <DropdownInput
                                        label="ESPP Contribution"
                                        onChange={(val) => updateForm('esppContributionType', val as ESPPContributionType)}
                                        options={[
                                            { value: 'NONE', label: 'None' },
                                            { value: 'PERCENTAGE', label: '% of Salary' },
                                            { value: 'FIXED', label: 'Fixed Amount' }
                                        ]}
                                        value={form.esppContributionType}
                                        tooltip="Employee Stock Purchase Plan. Contribute up to 15% of salary to buy company stock at a discount."
                                    />
                                    {form.esppContributionType !== 'NONE' && (
                                        <>
                                            {form.esppContributionType === 'PERCENTAGE' ? (
                                                <PercentageInput
                                                    label="Contribution"
                                                    value={form.esppContributionAmount}
                                                    onChange={(val) => updateForm('esppContributionAmount', val)}
                                                    max={15}
                                                    tooltip="Percentage of salary to contribute to ESPP. Most plans cap at 10-15%."
                                                />
                                            ) : (
                                                <CurrencyInput
                                                    label="Contribution Amount"
                                                    value={form.esppContributionAmount}
                                                    onChange={(val) => updateForm('esppContributionAmount', val)}
                                                    tooltip="Fixed amount per pay period to contribute to ESPP."
                                                />
                                            )}
                                            <PercentageInput
                                                label="Discount"
                                                value={form.esppDiscountPercent}
                                                onChange={(val) => updateForm('esppDiscountPercent', val)}
                                                max={15}
                                                tooltip="ESPP discount off stock price. Typical is 15%."
                                            />
                                            <ToggleInput
                                                label="Lookback"
                                                enabled={form.esppHasLookback}
                                                setEnabled={(val) => updateForm('esppHasLookback', val)}
                                                tooltip="If enabled, discount applies to lower of grant or purchase date price, increasing effective discount."
                                            />
                                            {esppAccounts.length > 0 ? (
                                                <DropdownInput
                                                    label="ESPP Account"
                                                    onChange={(val) => updateForm('esppAccountId', val)}
                                                    options={esppAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                                                    value={form.esppAccountId}
                                                    tooltip="Account where ESPP shares will be deposited."
                                                />
                                            ) : (
                                                <div className="col-span-full bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-xs text-yellow-300">
                                                    <span className="font-semibold">No ESPP Account</span>
                                                    <p className="text-yellow-400/80 mt-1">Create an ESPP account in the Accounts tab to track your ESPP purchases.</p>
                                                </div>
                                            )}
                                        </>
                                    )}
                                </>
                            )}
                            {/* Hide date fields for auto-calculated income types */}
                            {selectedType !== FutureSocialSecurityIncome &&
                             selectedType !== FERSPensionIncome &&
                             selectedType !== CSRSPensionIncome && (
                                <>
                                    <div>
                                        <StyledInput
                                            label="Start Date"
                                            id={`${id}-start-date`}
                                            type="date"
                                            value={form.startDate}
                                            onChange={(e) => {
                                                const val = e.target.value === "" ? "" : e.target.value;
                                                updateForm('startDate', val);
                                                validateDates(val, form.endDate);
                                            }}
                                            tooltip="Defaults to model full year income. Change to model partial year income."
                                        />
                                    </div>
                                    <div>
                                        <StyledInput
                                            label="End Date (Optional)"
                                            id={`${id}-end-date`}
                                            type="date"
                                            value={form.endDate}
                                            onChange={(e) => {
                                                const val = e.target.value === "" ? "" : e.target.value;
                                                updateForm('endDate', val);
                                                validateDates(form.startDate, val);
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
                                            <p className="wrap-break-word">• For disability (SSDI), survivor, or retirement benefits you're already receiving</p>
                                            <p className="wrap-break-word">• Enter your current monthly benefit amount</p>
                                            <p className="wrap-break-word">• Amount will automatically adjust with COLA (Cost of Living Adjustment)</p>
                                        </div>
                                    </div>
                                </>
                            )}
                            {selectedType === SocialSecurityIncome && (
                                <>
                                    <NumberInput
                                        label="Claiming Age (62-70)"
                                        value={form.claimingAge}
                                        onChange={(val) => updateForm('claimingAge', val)}
                                        onBlur={handleClaimingAgeBlur}
                                    />
                                    <div className="col-span-2 bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 text-sm">
                                        <div className="flex justify-between items-center">
                                            <span className="text-gray-300">Benefit Adjustment:</span>
                                            <span className="font-bold text-blue-300">
                                                {(SocialSecurityIncome.calculateBenefitAdjustment(form.claimingAge) * 100).toFixed(1)}% of FRA
                                            </span>
                                        </div>
                                        <div className="flex justify-between items-center mt-1">
                                            <span className="text-gray-300">Benefits Start:</span>
                                            <span className="font-medium text-blue-200">
                                                {assumptions.demographics.birthYear + form.claimingAge}
                                            </span>
                                        </div>
                                        <div className="text-xs text-gray-400 mt-2">
                                            {form.claimingAge < 67
                                                ? "Early claiming reduces benefits but you receive them longer."
                                                : form.claimingAge > 67
                                                ? "Delayed claiming increases benefits by 8% per year."
                                                : "Full Retirement Age: 100% of benefits."}
                                        </div>
                                    </div>
                                </>
                            )}
                            {selectedType === PassiveIncome && (
                                <>
                                    <DropdownInput label="Source Type" value={form.sourceType} onChange={(val) => updateForm('sourceType', val as PassiveSourceType)} options={["Dividend", "Rental", "Royalty", "Other"]} tooltip="Type of passive income. May affect tax treatment." />
                                </>
                            )}
                            {/* FERS Pension Fields */}
                            {selectedType === FERSPensionIncome && (
                                <>
                                    <NumberInput
                                        label="Years of Service"
                                        value={form.pensionYearsOfService}
                                        onChange={(val) => updateForm('pensionYearsOfService', val)}
                                        tooltip="Total years of creditable federal service under FERS"
                                    />
                                    {/* High-3 Salary - either auto-calculate from work income or manual entry */}
                                    {workIncomes.length > 0 ? (
                                        <>
                                            <div className="col-span-2 flex flex-col gap-3">
                                                <ToggleInput
                                                    label="Auto High-3"
                                                    enabled={form.autoCalculateHigh3}
                                                    setEnabled={(val) => updateForm('autoCalculateHigh3', val)}
                                                    tooltip="Calculate High-3 from projected salaries at retirement"
                                                />
                                                {form.autoCalculateHigh3 ? (
                                                    <DropdownInput
                                                        label="Link to Income"
                                                        value={form.linkedIncomeId}
                                                        onChange={(val) => updateForm('linkedIncomeId', val)}
                                                        options={workIncomes.map(inc => ({ value: inc.id, label: inc.name }))}
                                                        tooltip="High-3 will be calculated from your top 3 salary years at retirement"
                                                    />
                                                ) : (
                                                    <CurrencyInput
                                                        label="High-3 Salary"
                                                        value={form.pensionHigh3Salary}
                                                        onChange={(val) => updateForm('pensionHigh3Salary', val)}
                                                        tooltip="Average of your highest 3 consecutive years of basic pay"
                                                    />
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <CurrencyInput
                                            label="High-3 Salary"
                                            value={form.pensionHigh3Salary}
                                            onChange={(val) => updateForm('pensionHigh3Salary', val)}
                                            tooltip="Average of your highest 3 consecutive years of basic pay"
                                        />
                                    )}
                                    <NumberInput
                                        label="Retirement Age"
                                        value={form.pensionRetirementAge}
                                        onChange={(val) => updateForm('pensionRetirementAge', val)}
                                        tooltip={`MRA is ${getFERSMRA(pensionBirthYear)} for your birth year. Age 62 with 5+ years or MRA with 30+ years for full benefits.`}
                                    />
                                    <div className="col-span-3 bg-green-900/20 border border-green-700/50 rounded-lg p-4 text-sm">
                                        <div className="font-semibold text-green-200 mb-2">FERS Pension Estimate</div>
                                        <div className="text-gray-300 space-y-1">
                                            <div className="flex justify-between">
                                                <span>Estimated Annual Benefit:</span>
                                                <span className="font-bold text-green-300">
                                                    {form.autoCalculateHigh3
                                                        ? "Auto Calculated"
                                                        : `$${calculateFERSBasicBenefit(form.pensionYearsOfService, form.pensionHigh3Salary, form.pensionRetirementAge).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                                                    }
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>High-3:</span>
                                                <span className="text-green-200">
                                                    {form.autoCalculateHigh3
                                                        ? "Auto Calculated"
                                                        : `$${form.pensionHigh3Salary.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                                                    }
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Benefits Start:</span>
                                                <span className="text-green-200">
                                                    {assumptions.demographics.birthYear + form.pensionRetirementAge}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Eligibility:</span>
                                                <span className={checkFERSEligibility(form.pensionRetirementAge, form.pensionYearsOfService, pensionBirthYear).eligible ? "text-green-300" : "text-yellow-300"}>
                                                    {checkFERSEligibility(form.pensionRetirementAge, form.pensionYearsOfService, pensionBirthYear).message}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400 mt-2">
                                            Formula: {form.pensionRetirementAge >= 62 && form.pensionYearsOfService >= 20 ? "1.1%" : "1%"} x Years x High-3.
                                            {form.autoCalculateHigh3 && " High-3 will be calculated from your top 3 salary years at retirement."}
                                            {!form.autoCalculateHigh3 && " COLA is reduced (CPI-1% if inflation > 3%)."}
                                        </div>
                                    </div>
                                </>
                            )}
                            {/* CSRS Pension Fields */}
                            {selectedType === CSRSPensionIncome && (
                                <>
                                    <NumberInput
                                        label="Years of Service"
                                        value={form.pensionYearsOfService}
                                        onChange={(val) => updateForm('pensionYearsOfService', val)}
                                        tooltip="Total years of creditable federal service under CSRS"
                                    />
                                    {/* High-3 Salary - either auto-calculate from work income or manual entry */}
                                    {workIncomes.length > 0 ? (
                                        <>
                                            <div className="col-span-2 flex flex-col gap-3">
                                                <ToggleInput
                                                    label="Auto High-3"
                                                    enabled={form.autoCalculateHigh3}
                                                    setEnabled={(val) => updateForm('autoCalculateHigh3', val)}
                                                    tooltip="Calculate High-3 from projected salaries at retirement"
                                                />
                                                {form.autoCalculateHigh3 ? (
                                                    <DropdownInput
                                                        label="Link to Income"
                                                        value={form.linkedIncomeId}
                                                        onChange={(val) => updateForm('linkedIncomeId', val)}
                                                        options={workIncomes.map(inc => ({ value: inc.id, label: inc.name }))}
                                                        tooltip="High-3 will be calculated from your top 3 salary years at retirement"
                                                    />
                                                ) : (
                                                    <CurrencyInput
                                                        label="High-3 Salary"
                                                        value={form.pensionHigh3Salary}
                                                        onChange={(val) => updateForm('pensionHigh3Salary', val)}
                                                        tooltip="Average of your highest 3 consecutive years of basic pay"
                                                    />
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <CurrencyInput
                                            label="High-3 Salary"
                                            value={form.pensionHigh3Salary}
                                            onChange={(val) => updateForm('pensionHigh3Salary', val)}
                                            tooltip="Average of your highest 3 consecutive years of basic pay"
                                        />
                                    )}
                                    <NumberInput
                                        label="Retirement Age"
                                        value={form.pensionRetirementAge}
                                        onChange={(val) => updateForm('pensionRetirementAge', val)}
                                        tooltip="Age 55 with 30+ years, age 60 with 20+ years, or age 62 with 5+ years for full benefits"
                                    />
                                    <div className="col-span-3 bg-green-900/20 border border-green-700/50 rounded-lg p-4 text-sm">
                                        <div className="font-semibold text-green-200 mb-2">CSRS Pension Estimate</div>
                                        <div className="text-gray-300 space-y-1">
                                            <div className="flex justify-between">
                                                <span>Estimated Annual Benefit:</span>
                                                <span className="font-bold text-green-300">
                                                    {form.autoCalculateHigh3
                                                        ? "Auto Calculated"
                                                        : `$${calculateCSRSBasicBenefit(form.pensionYearsOfService, form.pensionHigh3Salary).toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                                                    }
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>High-3:</span>
                                                <span className="text-green-200">
                                                    {form.autoCalculateHigh3
                                                        ? "Auto Calculated"
                                                        : `$${form.pensionHigh3Salary.toLocaleString(undefined, { maximumFractionDigits: 0 })}/yr`
                                                    }
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Benefits Start:</span>
                                                <span className="text-green-200">
                                                    {assumptions.demographics.birthYear + form.pensionRetirementAge}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Eligibility:</span>
                                                <span className={checkCSRSEligibility(form.pensionRetirementAge, form.pensionYearsOfService).eligible ? "text-green-300" : "text-yellow-300"}>
                                                    {checkCSRSEligibility(form.pensionRetirementAge, form.pensionYearsOfService).message}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="text-xs text-gray-400 mt-2">
                                            Formula: 1.5%x5yr + 1.75%x5yr + 2%xremaining (max 80% of High-3).
                                            {form.autoCalculateHigh3 && " High-3 will be calculated from your top 3 salary years at retirement."}
                                            {!form.autoCalculateHigh3 && " Full COLA (CPI). No Social Security coverage."}
                                        </div>
                                    </div>
                                </>
                            )}
                            {selectedType !== SocialSecurityIncome &&
                             selectedType !== CurrentSocialSecurityIncome &&
                             selectedType !== FutureSocialSecurityIncome &&
                             selectedType !== FERSPensionIncome &&
                             selectedType !== CSRSPensionIncome && (
                                <DropdownInput label="Earned Income" value={form.earnedIncome} onChange={(val) => updateForm('earnedIncome', val as EarnedIncomeOption)} options={["Yes", "No"]} tooltip="Earned income (wages, self-employment) is subject to FICA taxes. Unearned income (investments, rental) is not." />
                            )}

                        </div>

                        {/* Info boxes for Future Social Security - outside grid to avoid stretching */}
                        {selectedType === FutureSocialSecurityIncome && (
                            <div className="space-y-3 mt-4 max-w-2xl">
                                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                                    <div className="text-sm font-semibold text-blue-200 mb-2">Automatic Calculation</div>
                                    <div className="text-xs text-gray-300 space-y-1">
                                        <p className="wrap-break-word">- Benefit calculated from your 35 highest earning years</p>
                                        <p className="wrap-break-word">- Uses SSA wage indexing and bend points formula</p>
                                        <p className="wrap-break-word">- Claiming at {form.claimingAge}: {(getClaimingAdjustment(form.claimingAge) * 100).toFixed(1)}% of FRA benefit</p>
                                        <p className="wrap-break-word">- Benefits start in {assumptions.demographics.birthYear + form.claimingAge}</p>
                                        <p className="wrap-break-word">- Benefits end at life expectancy (age {assumptions.demographics.lifeExpectancy})</p>
                                    </div>
                                </div>
                                <div className="text-sm text-gray-400 wrap-break-word">
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
                            disabled={!form.name.trim() || !!dateError}
                            title={!form.name.trim() ? "Enter a name" : dateError ? "Fix date error" : undefined}
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