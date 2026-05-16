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
  calculateSocialSecurityStartDate,
  IncomeFrequency
} from './models';
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { AccountContext } from "../Accounts/AccountContext";
import { InvestedAccount, ESPPAccount } from "../../Objects/Accounts/models";
import { TriggerSelector } from "../../Layout/InputFields/TriggerSelector";
import { AssumptionsContext, BUILTIN_MILESTONE_IDS, getLifeExpectancy, getBirthYear } from "../Assumptions/AssumptionsContext";
import { getClaimingAdjustment } from "../../../data/SocialSecurityData";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";
import { calculateFERSBasicBenefit, calculateCSRSBasicBenefit } from "../../../data/PensionData";
import { IncomeTypeSelector } from "./IncomeTypeSelector";
import { WorkIncomeFields } from "./WorkIncomeFields";
import { FERSPensionFields } from "./FERSPensionFields";
import { CSRSPensionFields } from "./CSRSPensionFields";
import {
    IncomeFormState,
    PassiveSourceType,
    EarnedIncomeOption,
    getInitialFormState
} from "./incomeFormTypes";

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
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const [step, setStep] = useState<'select' | 'details'>('select');
    const [selectedType, setSelectedType] = useState<any>(null);
    const [form, setForm] = useState<IncomeFormState>(getInitialFormState);
    const [dateError, setDateError] = useState<string | undefined>();

    const pensionBirthYear = getBirthYear(assumptions.milestones);

    function updateForm<K extends keyof IncomeFormState>(field: K, value: IncomeFormState[K]): void {
        setForm(prev => ({ ...prev, [field]: value }));
    }

    // Called on blur for claiming age - clamp to valid range
    function handleClaimingAgeBlur(): void {
        if (form.claimingAge < 62) updateForm('claimingAge', 62);
        else if (form.claimingAge > 70) updateForm('claimingAge', 70);
    }

    // Validate end date is after start date
    function validateDates(start: Date | undefined, end: Date | undefined): void {
        if (start && end && end < start) {
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
    ) as InvestedAccount[];

    const esppAccounts = accounts.filter(acc => acc instanceof ESPPAccount) as ESPPAccount[];

    const { incomes } = useContext(IncomeContext);
    const workIncomes = incomes.filter(inc => inc instanceof WorkIncome) as WorkIncome[];

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
        // Set smart default end milestone based on income type
        if (typeClass === WorkIncome) {
            updateForm('endMilestoneId', BUILTIN_MILESTONE_IDS.RETIRE);
        } else if (typeClass === PassiveIncome || typeClass === CurrentSocialSecurityIncome ||
                   typeClass === FutureSocialSecurityIncome || typeClass === SocialSecurityIncome ||
                   typeClass === FERSPensionIncome || typeClass === CSRSPensionIncome) {
            updateForm('endMilestoneId', BUILTIN_MILESTONE_IDS.END_OF_PLAN);
        }
        // WindfallIncome gets no default - it's a one-time event
        setStep('details');
    };

    const handleAdd = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!selectedType || !form.name.trim() || dateError) return;

        const finalStartDate = form.startDate;
        const finalEndDate = form.endDate;
        const finalStartMilestoneId = form.startMilestoneId;
        // Default end milestone based on income type if not set
        const getDefaultEndMilestone = (defaultMilestone: string) => {
            if (form.endMilestoneId) return form.endMilestoneId;
            if (finalEndDate) return undefined;
            return defaultMilestone;
        };

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
                form.esppHasLookback, 6, finalEsppAccountId, 7, form.pensionSystem,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.RETIRE),
                form.employerMatchType, form.employerMatchPercent, form.employerMatchMax
            );
        } else if (selectedType === CurrentSocialSecurityIncome) {
            newIncome = new CurrentSocialSecurityIncome(
                id, form.name.trim(), form.amount, form.frequency, finalStartDate, finalEndDate,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.END_OF_PLAN)
            );
        } else if (selectedType === FutureSocialSecurityIncome) {
            newIncome = new FutureSocialSecurityIncome(
                id, form.name.trim(), form.claimingAge, 0, 0, undefined, undefined,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.END_OF_PLAN)
            );
        } else if (selectedType === SocialSecurityIncome) {
            const ssStartDate = calculateSocialSecurityStartDate(
                getBirthYear(assumptions.milestones), form.claimingAge
            );
            newIncome = new SocialSecurityIncome(
                id, form.name.trim(), form.amount, form.frequency,
                form.claimingAge, undefined, ssStartDate, finalEndDate,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.END_OF_PLAN)
            );
        } else if (selectedType === FERSPensionIncome) {
            const retirementYear = getBirthYear(assumptions.milestones) + form.pensionRetirementAge;
            const pensionStartDate = new Date(Date.UTC(retirementYear, 0, 1));
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
                pensionStartDate, undefined,
                form.autoCalculateHigh3, form.autoCalculateHigh3 ? form.linkedIncomeId : null,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.END_OF_PLAN)
            );
        } else if (selectedType === CSRSPensionIncome) {
            const retirementYear = getBirthYear(assumptions.milestones) + form.pensionRetirementAge;
            const pensionStartDate = new Date(Date.UTC(retirementYear, 0, 1));
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
                pensionStartDate, undefined,
                form.autoCalculateHigh3, form.autoCalculateHigh3 ? form.linkedIncomeId : null,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.END_OF_PLAN)
            );
        } else if (selectedType === PassiveIncome) {
            newIncome = new PassiveIncome(
                id, form.name.trim(), form.amount, form.frequency, "Yes",
                form.sourceType, finalStartDate, finalEndDate, false,
                finalStartMilestoneId, getDefaultEndMilestone(BUILTIN_MILESTONE_IDS.END_OF_PLAN)
            );
        } else if (selectedType === WindfallIncome) {
            newIncome = new WindfallIncome(
                id, form.name.trim(), form.amount, form.frequency, "No", finalStartDate, finalEndDate,
                finalStartMilestoneId, form.endMilestoneId
            );
        } else {
            newIncome = new selectedType(
                id, form.name.trim(), form.amount, form.frequency, "Yes", finalStartDate, finalEndDate,
                finalStartMilestoneId, form.endMilestoneId
            );
        }

        dispatch({ type: "ADD_INCOME", payload: newIncome });
        handleClose();
    };

    if (!isOpen) return null;

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

                <form onSubmit={handleAdd}>
                {step === 'select' ? (
                    <IncomeTypeSelector onSelect={handleTypeSelect} />
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
                                <WorkIncomeFields
                                    form={form}
                                    updateForm={updateForm}
                                    contributionAccounts={contributionAccounts}
                                    esppAccounts={esppAccounts}
                                />
                            )}
                            {/* Hide date fields for auto-calculated income types */}
                            {selectedType !== FutureSocialSecurityIncome &&
                             selectedType !== FERSPensionIncome &&
                             selectedType !== CSRSPensionIncome && (
                                <>
                                    <TriggerSelector
                                        id={`${id}-start`}
                                        label="Start"
                                        date={form.startDate}
                                        milestoneId={form.startMilestoneId}
                                        milestones={assumptions.milestones || []}
                                        onDateChange={(date) => {
                                            updateForm('startDate', date);
                                            validateDates(date, form.endDate);
                                        }}
                                        onMilestoneChange={(milestoneId) => updateForm('startMilestoneId', milestoneId)}
                                        tooltip="When this income begins"
                                    />
                                    <TriggerSelector
                                        id={`${id}-end`}
                                        label="End"
                                        date={form.endDate}
                                        milestoneId={form.endMilestoneId}
                                        milestones={assumptions.milestones || []}
                                        onDateChange={(date) => {
                                            updateForm('endDate', date);
                                            validateDates(form.startDate, date);
                                        }}
                                        onMilestoneChange={(milestoneId) => updateForm('endMilestoneId', milestoneId)}
                                        tooltip="When this income ends"
                                    />
                                    {dateError && (
                                        <div className="col-span-full text-red-400 text-xs">
                                            {dateError}
                                        </div>
                                    )}
                                </>
                            )}
                            {selectedType === CurrentSocialSecurityIncome && (
                                <div className="col-span-3 bg-gray-800/50 border border-gray-700 rounded-lg p-4 text-sm">
                                    <div className="font-semibold text-gray-200 mb-2">Current Social Security Benefits</div>
                                    <div className="text-gray-400 space-y-1">
                                        <p className="wrap-break-word">• For disability (SSDI), survivor, or retirement benefits you're already receiving</p>
                                        <p className="wrap-break-word">• Enter your current monthly benefit amount</p>
                                        <p className="wrap-break-word">• Amount will automatically adjust with COLA (Cost of Living Adjustment)</p>
                                    </div>
                                </div>
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
                                                {pensionBirthYear + form.claimingAge}
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
                                <DropdownInput label="Source Type" value={form.sourceType} onChange={(val) => updateForm('sourceType', val as PassiveSourceType)} options={["Dividend", "Rental", "Royalty", "Other"]} tooltip="Type of passive income. May affect tax treatment." />
                            )}
                            {selectedType === FERSPensionIncome && (
                                <FERSPensionFields
                                    form={form}
                                    updateForm={updateForm}
                                    workIncomes={workIncomes}
                                    pensionBirthYear={pensionBirthYear}
                                />
                            )}
                            {selectedType === CSRSPensionIncome && (
                                <CSRSPensionFields
                                    form={form}
                                    updateForm={updateForm}
                                    workIncomes={workIncomes}
                                    pensionBirthYear={pensionBirthYear}
                                />
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
                                        <p className="wrap-break-word">- Benefits start in {pensionBirthYear + form.claimingAge}</p>
                                        <p className="wrap-break-word">- Benefits end at life expectancy (age {getLifeExpectancy(assumptions.milestones)})</p>
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
                        type="button"
                        onClick={handleCancelOrBack}
                        className="px-5 py-2.5 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                    >
                        {step === "details" ? "Back" : "Cancel"}
                    </button>
                    {step === "details" && (
                        <button
                            type="submit"
                            disabled={!form.name.trim() || !!dateError}
                            title={!form.name.trim() ? "Enter a name" : dateError ? "Fix date error" : undefined}
                            className="px-5 py-2.5 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            Add Income
                        </button>
                    )}
                </div>
                </form>
            </div>
        </div>
    );
};

export default AddIncomeModal;
