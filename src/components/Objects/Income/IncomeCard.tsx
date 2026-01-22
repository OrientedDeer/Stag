import { useContext, useEffect, useCallback, useState, useRef, useMemo, ReactElement } from "react";
import {
    AnyIncome,
    WorkIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    PassiveIncome,
    WindfallIncome,
    INCOME_COLORS_BACKGROUND,
    IncomeFrequency,
    AutoMax401kOption,
    ESPPContributionType,
    PensionSystem
} from "./models.js";
import { IncomeContext, AllIncomeKeys } from "./IncomeContext.js";
import { StyledInput, StyledSelect } from "../../Layout/InputFields/StyleUI.js";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput.js";
import DeleteIncomeControl from './DeleteIncomeUI.js';
import { NameInput } from "../../Layout/InputFields/NameInput.js";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput.js";
import { NumberInput } from "../../Layout/InputFields/NumberInput.js";
import { AccountContext } from "../Accounts/AccountContext.js";
import { InvestedAccount, ESPPAccount } from "../../Objects/Accounts/models.js";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput.js";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput.js";
import { formatCompactCurrency } from "../../../tabs/Future/tabs/FutureUtils.js";
import { AssumptionsContext } from "../Assumptions/AssumptionsContext.js";
import { parseSSAXml, validateEarningsImport, formatEarningsSummary } from "../../../services/SSAImportService.js";
import { get401kLimit, getHSALimit } from "../../../data/ContributionLimits.js";
import { AlertBanner } from "../../Layout/AlertBanner.js";
import { ExpandableCard } from "../../Layout/ExpandableCard.js";
import { formatDateForInput, getFrequencyAbbrev } from "../../../utils/formatters.js";
import { EarningsRecord } from "../../../services/SocialSecurityCalculator.js";

function getIncomeDescriptor(income: AnyIncome): string {
    if (income instanceof WorkIncome) return "WORK";
    if (income instanceof SocialSecurityIncome) return "SS";
    if (income instanceof CurrentSocialSecurityIncome) return "SS";
    if (income instanceof FutureSocialSecurityIncome) return "SS";
    if (income instanceof PassiveIncome) return "PASSIVE";
    if (income instanceof WindfallIncome) return "WINDFALL";
    return "INCOME";
}

function getIncomeIconBg(income: AnyIncome): string {
    if (income instanceof WorkIncome) return INCOME_COLORS_BACKGROUND["Work"];
    if (income instanceof SocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
    if (income instanceof CurrentSocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
    if (income instanceof FutureSocialSecurityIncome) return INCOME_COLORS_BACKGROUND["SocialSecurity"];
    if (income instanceof PassiveIncome) return INCOME_COLORS_BACKGROUND["Passive"];
    if (income instanceof WindfallIncome) return INCOME_COLORS_BACKGROUND["Windfall"];
    return "bg-gray-500";
}

function IncomeCard({ income }: { income: AnyIncome }): ReactElement {
    const { dispatch } = useContext(IncomeContext);
    const { accounts } = useContext(AccountContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const [dateError, setDateError] = useState<string | undefined>();
    const ssaFileInputRef = useRef<HTMLInputElement>(null);

    // SSA import handler for FutureSocialSecurityIncome
    const handleSSAFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const xmlString = event.target?.result as string;
            try {
                const { earnings } = parseSSAXml(xmlString);

                if (earnings.length === 0) {
                    alert('No valid earnings found in file. Make sure the file contains FicaEarnings data.');
                    return;
                }

                const birthYear = assumptions.demographics.birthYear;
                const validation = validateEarningsImport(earnings, birthYear);

                if (validation.warnings.length > 0) {
                    const proceed = confirm(
                        `Warnings:\n${validation.warnings.join('\n')}\n\nImport anyway?`
                    );
                    if (!proceed) return;
                }

                assumptionsDispatch({ type: 'SET_PRIOR_EARNINGS', payload: earnings });
                alert(`Successfully imported ${earnings.length} years of earnings history.\n\nYour Social Security benefit will be calculated using this data when you reach claiming age.`);
            } catch (err) {
                alert('Error parsing SSA file. Please ensure it\'s a valid SSA XML export from ssa.gov.');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }, [assumptions.demographics.birthYear, assumptionsDispatch]);

    // Validate end date is after start date
    const validateDates = useCallback((start: Date | undefined, end: Date | undefined) => {
        if (start && end && end < start) {
            setDateError("End date must be after start date");
        } else {
            setDateError(undefined);
        }
    }, []);

    useEffect(() => {
        validateDates(income.startDate, income.end_date);
    }, [income.startDate, income.end_date, validateDates]);

    const handleFieldUpdate = useCallback((field: AllIncomeKeys, value: unknown) => {
        dispatch({
            type: "UPDATE_INCOME_FIELD",
            payload: { id: income.id, field, value },
        });
    }, [dispatch, income.id]);

    const handleClaimingAgeBlur = useCallback(() => {
        if (income instanceof FutureSocialSecurityIncome || income instanceof SocialSecurityIncome) {
            const currentAge = income.claimingAge;
            if (currentAge < 62) {
                handleFieldUpdate("claimingAge", 62);
            } else if (currentAge > 70) {
                handleFieldUpdate("claimingAge", 70);
            }
        }
    }, [income, handleFieldUpdate]);

    // Calculate contribution limit warnings for WorkIncome
    const contributionWarnings = useMemo(() => {
        if (!(income instanceof WorkIncome)) return null;

        const year = new Date().getFullYear();
        const age = year - assumptions.demographics.birthYear;

        const getAnnualMultiplier = (freq: IncomeFrequency): number => {
            switch (freq) {
                case 'Weekly': return 52;
                case 'Bi-Weekly': return 26;
                case 'Monthly': return 12;
                case 'Annually': return 1;
                default: return 12;
            }
        };

        const multiplier = getAnnualMultiplier(income.frequency);
        const annual401k = (income.preTax401k + income.roth401k) * multiplier;
        const annualHSA = income.hsaContribution * multiplier;

        const limit401k = get401kLimit(year, age);
        const limitHSA = getHSALimit(year, age, 'individual');

        const warnings: { type: string; message: string; annual: number; limit: number }[] = [];

        if (annual401k > limit401k) {
            warnings.push({
                type: '401k',
                message: `401k contributions exceed ${year} limit`,
                annual: annual401k,
                limit: limit401k
            });
        }

        if (annualHSA > limitHSA) {
            warnings.push({
                type: 'HSA',
                message: `HSA contributions exceed ${year} limit`,
                annual: annualHSA,
                limit: limitHSA
            });
        }

        return warnings.length > 0 ? warnings : null;
    }, [income, assumptions.demographics.birthYear]);

    const handleMatchAccountChange = useCallback((newAccountId: string | null) => {
        const account = accounts.find(acc => acc.id === newAccountId) as InvestedAccount | undefined;
        handleFieldUpdate("matchAccountId", newAccountId);
        handleFieldUpdate("taxType", account ? account.taxType : null);
    }, [accounts, handleFieldUpdate]);

    const contributionAccounts = accounts.filter(
        (acc): acc is InvestedAccount => acc instanceof InvestedAccount &&
                 acc.isContributionEligible === true &&
                 (acc.taxType === 'Roth 401k' || acc.taxType === 'Traditional 401k')
    );

    const esppAccounts = accounts.filter((acc): acc is ESPPAccount => acc instanceof ESPPAccount);

    const isWorkIncome = income instanceof WorkIncome;
    const matchAccountId = isWorkIncome ? income.matchAccountId : undefined;
    const employerMatch = isWorkIncome ? income.employerMatch : undefined;

    useEffect(() => {
        if (isWorkIncome && typeof employerMatch === 'number' && employerMatch > 0 && contributionAccounts.length > 0) {
            const accountExists = contributionAccounts.some(acc => acc.id === matchAccountId);
            if (!accountExists) {
                handleMatchAccountChange(contributionAccounts[0].id);
            }
        }
    }, [isWorkIncome, matchAccountId, employerMatch, contributionAccounts, handleMatchAccountChange]);

    const handleDateChange = (field: AllIncomeKeys, dateString: string): void => {
        const newDate = dateString ? new Date(dateString) : undefined;
        handleFieldUpdate(field, newDate);

        if (field === "startDate") {
            validateDates(newDate, income.end_date);
        } else if (field === "end_date") {
            validateDates(income.startDate, newDate);
        }
    };

    // Display calculations
    const getDisplayAmount = (): string => {
        if (income instanceof FutureSocialSecurityIncome) {
            return income.calculatedPIA > 0 ? formatCompactCurrency(income.calculatedPIA, { forceExact }) : 'Auto-calculated';
        }
        return formatCompactCurrency(income.amount, { forceExact });
    };

    const getFrequencyDisplay = (): string => {
        if (income instanceof FutureSocialSecurityIncome) {
            return income.calculatedPIA > 0 ? '/mo' : '';
        }
        return `/${getFrequencyAbbrev(income.frequency)}`;
    };

    const descriptor = getIncomeDescriptor(income);
    const iconBg = getIncomeIconBg(income);

    const headerContent = (
        <NameInput
            label=""
            id={income.id}
            value={income.name}
            onChange={(val) => handleFieldUpdate("name", val)}
        />
    );

    const headerActions = (
        <div className="text-chart-Red-75">
            <DeleteIncomeControl incomeId={income.id} incomeName={income.name} />
        </div>
    );

    return (
        <ExpandableCard
            name={income.name}
            iconBg={iconBg}
            iconLabel={descriptor.slice(0, 1)}
            displayValue={getDisplayAmount()}
            frequencySuffix={getFrequencyDisplay()}
            headerContent={headerContent}
            headerActions={headerActions}
            ariaLabelType="income"
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {income instanceof FutureSocialSecurityIncome ? (
                    <FutureSocialSecurityAmountField income={income} />
                ) : (
                    <CurrencyInput
                        id={`${income.id}-amount`}
                        label="Amount"
                        value={income.amount}
                        onChange={(val) => handleFieldUpdate("amount", val)}
                        tooltip="Gross income before deductions"
                    />
                )}

                {!(income instanceof FutureSocialSecurityIncome) && (
                    <StyledSelect
                        id={`${income.id}-frequency`}
                        label="Frequency"
                        value={income.frequency}
                        onChange={(e) => handleFieldUpdate("frequency", e.target.value as IncomeFrequency)}
                        options={["Weekly", "Bi-Weekly", "Semi-Monthly", "Monthly", "Annually"]}
                        tooltip="This only affects how we convert to annual amounts. The exact timing of paychecks doesn't affect the simulation."
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
                    <WorkIncomeFields
                        income={income}
                        onFieldUpdate={handleFieldUpdate}
                        contributionAccounts={contributionAccounts}
                        esppAccounts={esppAccounts}
                        contributionWarnings={contributionWarnings}
                        onMatchAccountChange={handleMatchAccountChange}
                    />
                )}

                {income instanceof FutureSocialSecurityIncome && (
                    <FutureSocialSecurityFields
                        income={income}
                        onFieldUpdate={handleFieldUpdate}
                        onClaimingAgeBlur={handleClaimingAgeBlur}
                        ssaFileInputRef={ssaFileInputRef}
                        onSSAFileChange={handleSSAFileChange}
                        assumptions={assumptions}
                        assumptionsDispatch={assumptionsDispatch}
                    />
                )}

                {income instanceof CurrentSocialSecurityIncome && (
                    <div className="col-span-3">
                        <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-400">
                            <div className="font-semibold text-gray-300 mb-1">Current Social Security Benefits</div>
                            <div>- For disability (SSDI), survivor, or retirement benefits already receiving</div>
                            <div>- Amount will automatically adjust with COLA (Cost of Living Adjustment)</div>
                        </div>
                    </div>
                )}

                {income instanceof SocialSecurityIncome && (
                    <NumberInput
                        id={`${income.id}-claiming-age`}
                        label="Claiming Age (62-70)"
                        value={income.claimingAge}
                        onChange={(val) => handleFieldUpdate("claimingAge", val)}
                        onBlur={handleClaimingAgeBlur}
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

                {income instanceof FutureSocialSecurityIncome ? (
                    <FutureSocialSecurityDateFields income={income} />
                ) : (
                    <>
                        <StyledInput
                            id={`${income.id}-start-date`}
                            label="Start Date"
                            type="date"
                            value={formatDateForInput(income.startDate)}
                            onChange={(e) => handleDateChange("startDate", e.target.value)}
                        />
                        <StyledInput
                            id={`${income.id}-end-date`}
                            label="End Date"
                            type="date"
                            value={formatDateForInput(income.end_date)}
                            onChange={(e) => handleDateChange("end_date", e.target.value)}
                            error={dateError}
                        />
                    </>
                )}
            </div>
        </ExpandableCard>
    );
}

// Sub-components for type-specific fields

function FutureSocialSecurityAmountField({ income }: { income: FutureSocialSecurityIncome }): ReactElement {
    return (
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
    );
}

function FutureSocialSecurityDateFields({ income }: { income: FutureSocialSecurityIncome }): ReactElement {
    return (
        <>
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                    Start Date (Auto-Calculated)
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 text-sm">
                    {income.startDate ? formatDateForInput(income.startDate) : `At claiming age ${income.claimingAge}`}
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                    End Date (Auto-Calculated)
                </label>
                <div className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-300 text-sm">
                    {income.end_date ? formatDateForInput(income.end_date) : 'At life expectancy'}
                </div>
            </div>
        </>
    );
}

interface WorkIncomeFieldsProps {
    income: WorkIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    contributionAccounts: InvestedAccount[];
    esppAccounts: ESPPAccount[];
    contributionWarnings: { type: string; message: string; annual: number; limit: number }[] | null;
    onMatchAccountChange: (accountId: string | null) => void;
}

function WorkIncomeFields({
    income,
    onFieldUpdate,
    contributionAccounts,
    esppAccounts,
    contributionWarnings,
    onMatchAccountChange
}: WorkIncomeFieldsProps): ReactElement {
    return (
        <>
            <DropdownInput
                id={`${income.id}-401k-mode`}
                label="401k Contributions"
                onChange={(val) => onFieldUpdate("autoMax401k", val as AutoMax401kOption)}
                options={[
                    { value: 'disabled', label: 'None' },
                    { value: 'custom', label: 'Custom Amount' },
                    { value: 'traditional', label: 'Max Pre-Tax' },
                    { value: 'roth', label: 'Max Roth' }
                ]}
                value={income.autoMax401k}
            />
            {income.autoMax401k === 'custom' && (
                <>
                    <CurrencyInput
                        id={`${income.id}-pre-tax-contributions`}
                        label="Pre-Tax 401k"
                        value={income.preTax401k}
                        onChange={(val) => onFieldUpdate("preTax401k", val)}
                    />
                    <CurrencyInput
                        id={`${income.id}-roth-contributions`}
                        label="Roth 401k"
                        value={income.roth401k}
                        onChange={(val) => onFieldUpdate("roth401k", val)}
                    />
                    {(income.preTax401k > 0 || income.roth401k > 0) && (
                        <DropdownInput
                            id={`${income.id}-contribution-growth`}
                            label="Contribution Growth"
                            onChange={(val) => onFieldUpdate("contributionGrowthStrategy", val)}
                            options={[
                                { value: 'FIXED', label: 'Remain Fixed' },
                                { value: 'GROW_WITH_SALARY', label: 'Grow with Salary' },
                                { value: 'TRACK_ANNUAL_MAX', label: 'Track Annual Maximum' }
                            ]}
                            value={income.contributionGrowthStrategy}
                        />
                    )}
                </>
            )}
            {income.autoMax401k !== 'disabled' && (
                <>
                    <CurrencyInput
                        id={`${income.id}-employer-match`}
                        label="Employer Match"
                        value={income.employerMatch}
                        onChange={(val) => onFieldUpdate("employerMatch", val)}
                    />
                    {income.employerMatch > 0 && (
                        <DropdownInput
                            label="Match Account"
                            onChange={(val) => onMatchAccountChange(val)}
                            options={contributionAccounts.map(acc => ({ value: acc.id || "", label: acc.name }))}
                            value={income.matchAccountId}
                        />
                    )}
                </>
            )}
            <CurrencyInput
                id={`${income.id}-insurance`}
                label="Insurance"
                value={income.insurance}
                onChange={(val) => onFieldUpdate("insurance", val)}
            />
            <CurrencyInput
                id={`${income.id}-hsa-contribution`}
                label="HSA Contribution"
                value={income.hsaContribution}
                onChange={(val) => onFieldUpdate("hsaContribution", val)}
            />

            <ESPPFields income={income} onFieldUpdate={onFieldUpdate} esppAccounts={esppAccounts} />

            {/* Pension System Selection */}
            <DropdownInput
                id={`${income.id}-pension-system`}
                label="Pension System"
                onChange={(val) => onFieldUpdate("pensionSystem", val as PensionSystem)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'FERS', label: 'FERS (Federal)' },
                    { value: 'CSRS', label: 'CSRS (Federal)' }
                ]}
                value={income.pensionSystem}
                tooltip="If this job is covered by a federal pension system, select it here. This helps track your High-3 salary for pension calculations."
            />

            {contributionWarnings && contributionWarnings.length > 0 && (
                <div className="col-span-full">
                    {contributionWarnings.map((warning, idx) => (
                        <AlertBanner key={idx} severity="warning" size="sm" className="mb-2">
                            <span className="font-medium">{warning.message}</span>
                            <span className="text-gray-300 ml-2">
                                (Annual: {formatCompactCurrency(warning.annual, { forceExact: true })} / Limit: {formatCompactCurrency(warning.limit, { forceExact: true })})
                            </span>
                        </AlertBanner>
                    ))}
                </div>
            )}
        </>
    );
}

interface ESPPFieldsProps {
    income: WorkIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    esppAccounts: ESPPAccount[];
}

function ESPPFields({ income, onFieldUpdate, esppAccounts }: ESPPFieldsProps): ReactElement {
    return (
        <>
            <DropdownInput
                id={`${income.id}-espp-contribution-type`}
                label="ESPP Contribution"
                onChange={(val) => onFieldUpdate("esppContributionType", val as ESPPContributionType)}
                options={[
                    { value: 'NONE', label: 'None' },
                    { value: 'PERCENTAGE', label: '% of Salary' },
                    { value: 'FIXED', label: 'Fixed Amount' }
                ]}
                value={income.esppContributionType}
                tooltip="Employee Stock Purchase Plan. Contribute up to 15% of salary to buy company stock at a discount."
            />
            {income.esppContributionType !== 'NONE' && (
                <>
                    {income.esppContributionType === 'PERCENTAGE' ? (
                        <PercentageInput
                            id={`${income.id}-espp-contribution-amount`}
                            label="Contribution"
                            value={income.esppContributionAmount}
                            onChange={(val) => onFieldUpdate("esppContributionAmount", val)}
                            max={15}
                            tooltip="Percentage of salary to contribute to ESPP. Most plans cap at 10-15%."
                        />
                    ) : (
                        <CurrencyInput
                            id={`${income.id}-espp-contribution-amount`}
                            label="Contribution Amount"
                            value={income.esppContributionAmount}
                            onChange={(val) => onFieldUpdate("esppContributionAmount", val)}
                            tooltip="Fixed amount per pay period to contribute to ESPP."
                        />
                    )}
                    <PercentageInput
                        id={`${income.id}-espp-discount`}
                        label="Discount"
                        value={income.esppDiscountPercent}
                        onChange={(val) => onFieldUpdate("esppDiscountPercent", val)}
                        max={15}
                        tooltip="ESPP discount off stock price. Typical is 15%."
                    />
                    <ToggleInput
                        id={`${income.id}-espp-lookback`}
                        label="Lookback"
                        enabled={income.esppHasLookback}
                        setEnabled={(val) => onFieldUpdate("esppHasLookback", val)}
                        tooltip="If enabled, discount applies to lower of grant or purchase date price, increasing effective discount."
                    />
                    {esppAccounts.length > 0 ? (
                        <DropdownInput
                            id={`${income.id}-espp-account`}
                            label="ESPP Account"
                            onChange={(val) => onFieldUpdate("esppAccountId", val)}
                            options={esppAccounts.map(acc => ({ value: acc.id, label: acc.name }))}
                            value={income.esppAccountId || ""}
                            tooltip="Account where ESPP shares will be deposited."
                        />
                    ) : (
                        <div className="col-span-full bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-xs text-yellow-300">
                            <span className="font-semibold">No ESPP Account</span>
                            <p className="text-yellow-400/80 mt-1">Create an ESPP account in the Accounts tab to track your ESPP purchases.</p>
                        </div>
                    )}
                    {esppAccounts.length > 0 && !income.esppAccountId && (
                        <div className="col-span-full bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-xs text-yellow-300">
                            <span className="font-semibold">ESPP Account Not Linked</span>
                            <p className="text-yellow-400/80 mt-1">Select an ESPP account above to track your purchases.</p>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

interface FutureSocialSecurityFieldsProps {
    income: FutureSocialSecurityIncome;
    onFieldUpdate: (field: AllIncomeKeys, value: unknown) => void;
    onClaimingAgeBlur: () => void;
    ssaFileInputRef: React.RefObject<HTMLInputElement | null>;
    onSSAFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    assumptions: { demographics: { priorEarnings?: EarningsRecord[] } };
    assumptionsDispatch: (action: { type: 'SET_PRIOR_EARNINGS'; payload: EarningsRecord[] } | { type: 'CLEAR_PRIOR_EARNINGS' }) => void;
}

function FutureSocialSecurityFields({
    income,
    onFieldUpdate,
    onClaimingAgeBlur,
    ssaFileInputRef,
    onSSAFileChange,
    assumptions,
    assumptionsDispatch
}: FutureSocialSecurityFieldsProps): ReactElement {
    return (
        <>
            <NumberInput
                id={`${income.id}-claiming-age`}
                label="Claiming Age (62-70)"
                value={income.claimingAge}
                onChange={(val) => onFieldUpdate("claimingAge", val)}
                onBlur={onClaimingAgeBlur}
            />
            {income.calculatedPIA > 0 && (
                <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-400 mb-1">
                        Calculation Details
                    </label>
                    <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg px-3 py-2 text-xs text-gray-300">
                        <div>- AIME calculation based on 35 highest earning years</div>
                        <div>- Calculated in year: {income.calculationYear || 'Pending'}</div>
                        <div>- Benefits auto-adjusted for COLA each year</div>
                    </div>
                </div>
            )}
            <div className="col-span-full mt-2 pt-4 border-t border-gray-700">
                <label className="block text-sm font-medium text-gray-400 mb-2">
                    SSA Earnings History
                </label>
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <button
                        onClick={() => ssaFileInputRef.current?.click()}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Import SSA Data
                    </button>
                    <input
                        type="file"
                        ref={ssaFileInputRef}
                        onChange={onSSAFileChange}
                        accept=".xml"
                        className="hidden"
                    />
                    {assumptions.demographics.priorEarnings && assumptions.demographics.priorEarnings.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <span className="text-green-400 text-sm">
                                {formatEarningsSummary(assumptions.demographics.priorEarnings)}
                            </span>
                            <button
                                onClick={() => assumptionsDispatch({ type: 'CLEAR_PRIOR_EARNINGS' })}
                                className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                            >
                                Clear
                            </button>
                        </div>
                    ) : (
                        <span className="text-gray-400 text-xs">
                            Download your statement from ssa.gov/myaccount
                        </span>
                    )}
                </div>
            </div>
        </>
    );
}

export default IncomeCard;
