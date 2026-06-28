import { memo, useContext, useEffect, useCallback, useState, useMemo, ReactElement } from 'react';
import {
    AnyIncome,
    WorkIncome,
    SocialSecurityIncome,
    CurrentSocialSecurityIncome,
    FutureSocialSecurityIncome,
    FERSPensionIncome,
    CSRSPensionIncome,
    PassiveIncome,
    IncomeFrequency,
    hasIncomeEnded,
} from './models';
import { IncomeContext, IncomeDispatchContext, AllIncomeKeys } from './IncomeContext';
import { StyledSelect } from '../../Layout/InputFields/StyleUI';
import { WarningTriangleIcon } from '../../Layout/Icons/WarningTriangleIcon';
import { CurrencyInput } from '../../Layout/InputFields/CurrencyInput';
import DeleteIncomeControl from './DeleteIncomeUI';
import { NameInput } from '../../Layout/InputFields/NameInput';
import { NumberInput } from '../../Layout/InputFields/NumberInput';
import { AccountContext } from '../Accounts/AccountContext';
import { InvestedAccount, ESPPAccount, RSUAccount } from '../../Objects/Accounts/models';
import { TriggerSelector } from '../../Layout/InputFields/TriggerSelector';
import { AssumptionsContext, getBirthYear } from '../Assumptions/AssumptionsContext';
import { ExpandableCard } from '../../Layout/ExpandableCard';
import {
    getIncomeDescriptor,
    getIncomeIconBg,
    getDisplayAmount,
    getFrequencyDisplay,
    computeContributionWarnings,
    getSimResolvedPension,
    rsuGrantNeedsAccount,
    esppGrantNeedsAccount,
} from './incomeCardUtils';
import { SimulationContext } from '../Assumptions/SimulationContext';
import { useSSAEarningsImport } from './useSSAEarningsImport';
import { WorkIncomeFields } from './card/WorkIncomeFields';
import { FutureSocialSecurityFields } from './card/FutureSocialSecurityFields';
import { FutureSocialSecurityAmountField } from './card/FutureSocialSecurityAmountField';
import { FutureSocialSecurityDateFields } from './card/FutureSocialSecurityDateFields';
import { FERSPensionFields } from './card/FERSPensionFields';
import { CSRSPensionFields } from './card/CSRSPensionFields';

function IncomeCard({ income }: { income: AnyIncome }): ReactElement {
    const { incomes } = useContext(IncomeContext);
    const dispatch = useContext(IncomeDispatchContext);
    const { accounts } = useContext(AccountContext);
    const { simulation } = useContext(SimulationContext);
    const { state: assumptions, dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const [dateError, setDateError] = useState<string | undefined>();

    const { fileInputRef: ssaFileInputRef, onFileChange: onSSAFileChange } = useSSAEarningsImport({
        milestones: assumptions.milestones,
        dispatch: assumptionsDispatch,
    });

    const validateDates = useCallback((start: Date | undefined, end: Date | undefined) => {
        if (start && end && end < start) {
            setDateError('End date must be after start date');
        } else {
            setDateError(undefined);
        }
    }, []);

    useEffect(() => {
        validateDates(income.startDate, income.end_date);
    }, [income.startDate, income.end_date, validateDates]);

    const handleFieldUpdate = useCallback(
        (field: AllIncomeKeys, value: unknown) => {
            dispatch({
                type: 'UPDATE_INCOME_FIELD',
                payload: { id: income.id, field, value },
            });
        },
        [dispatch, income.id]
    );

    const handleClaimingAgeBlur = useCallback(() => {
        if (income instanceof FutureSocialSecurityIncome || income instanceof SocialSecurityIncome) {
            const currentAge = income.claimingAge;
            if (currentAge < 62) {
                handleFieldUpdate('claimingAge', 62);
            } else if (currentAge > 70) {
                handleFieldUpdate('claimingAge', 70);
            }
        }
    }, [income, handleFieldUpdate]);

    const birthYear = getBirthYear(assumptions.milestones);

    const contributionWarnings = useMemo(
        () => computeContributionWarnings(income, birthYear),
        [income, birthYear]
    );

    // #139A: a job flagged CSRS/FERS only tracks High-3 (and, for CSRS, the SS-FICA
    // exemption) — the pension benefit is a SEPARATE income. Warn when the matching
    // pension income hasn't been added, so the dropdown isn't silently half-wired.
    const hasMatchingPensionIncome = useMemo(() => {
        if (!(income instanceof WorkIncome) || income.pensionSystem === 'NONE') return true;
        if (income.pensionSystem === 'CSRS') return incomes.some(i => i instanceof CSRSPensionIncome);
        if (income.pensionSystem === 'FERS') return incomes.some(i => i instanceof FERSPensionIncome);
        return true;
    }, [income, incomes]);

    const handleMatchAccountChange = useCallback(
        (newAccountId: string | null) => {
            const account = accounts.find((acc) => acc.id === newAccountId) as
                | InvestedAccount
                | undefined;
            handleFieldUpdate('matchAccountId', newAccountId);
            handleFieldUpdate('taxType', account ? account.taxType : null);
        },
        [accounts, handleFieldUpdate]
    );

    // Memoized on `accounts` so each is a stable reference per render — the membership
    // useEffect below (and the #141 missing-account badge) depend on these, and fresh
    // arrays every render would re-fire the effect and re-scan needlessly.
    const contributionAccounts = useMemo(
        () =>
            accounts.filter(
                (acc): acc is InvestedAccount =>
                    acc instanceof InvestedAccount &&
                    acc.isContributionEligible === true &&
                    (acc.taxType === 'Roth 401k' || acc.taxType === 'Traditional 401k')
            ),
        [accounts]
    );

    const esppAccounts = useMemo(
        () => accounts.filter((acc): acc is ESPPAccount => acc instanceof ESPPAccount),
        [accounts]
    );
    const rsuAccounts = useMemo(
        () => accounts.filter((acc): acc is RSUAccount => acc instanceof RSUAccount),
        [accounts]
    );

    const workIncomes = useMemo(
        () => incomes.filter((inc): inc is WorkIncome => inc instanceof WorkIncome),
        [incomes]
    );

    const isWorkIncome = income instanceof WorkIncome;
    const matchAccountId = isWorkIncome ? income.matchAccountId : undefined;
    const employerMatch = isWorkIncome ? income.employerMatch : undefined;

    useEffect(() => {
        if (
            isWorkIncome &&
            typeof employerMatch === 'number' &&
            employerMatch > 0 &&
            contributionAccounts.length > 0
        ) {
            const accountExists = contributionAccounts.some((acc) => acc.id === matchAccountId);
            if (!accountExists) {
                handleMatchAccountChange(contributionAccounts[0].id);
            }
        }
    }, [isWorkIncome, matchAccountId, employerMatch, contributionAccounts, handleMatchAccountChange]);

    const isPension = income instanceof FERSPensionIncome || income instanceof CSRSPensionIncome;
    // For an Auto High-3 FERS/CSRS pension the engine resolves the benefit + High-3
    // on a separate projected instance and never writes them back to this editable
    // income (calculatedBenefit stays 0 here). Read the resolved figures out of the
    // cached simulation timeline so both the expanded card and the collapsed header
    // can show the real $/yr instead of "Auto Calculated". Null until a sim runs or
    // when the pension never activates in-horizon.
    const simResolvedPension = useMemo(
        () => (isPension ? getSimResolvedPension(income.id, simulation) : null),
        [isPension, income.id, simulation]
    );
    const isFutureSS = income instanceof FutureSocialSecurityIncome;
    const isAnySS =
        income instanceof SocialSecurityIncome ||
        income instanceof CurrentSocialSecurityIncome ||
        income instanceof FutureSocialSecurityIncome;
    // Pensions hide the generic Amount/Frequency/start-end inputs because those
    // are simulation outputs (calculatedBenefit, retirement-derived start date).
    // The pension's own fields component owns those displays.
    const hideAmountInput = isFutureSS || isPension;
    const hideFrequencyInput = isFutureSS || isPension;
    const hideEarnedIncomeInput = isAnySS || isPension;
    const hideDateInputs = isFutureSS || isPension;

    const descriptor = getIncomeDescriptor(income);
    const iconBg = getIncomeIconBg(income);

    const headerContent = (
        <NameInput
            label=""
            id={income.id}
            value={income.name}
            onChange={(val) => handleFieldUpdate('name', val)}
        />
    );

    const headerActions = (
        <div className="text-chart-Red-75">
            <DeleteIncomeControl incomeId={income.id} incomeName={income.name} />
        </div>
    );

    // #141: a stock grant configured with no linked account is effectively a broken
    // income (it never vests/purchases). Surface a badge on the card HEADER — visible
    // while collapsed — so the user doesn't have to expand the card to discover it.
    // …but NOT for a job that has already ENDED: its grant/ESPP can no longer vest, so
    // the warning would be pure noise on a finished income (active + future still warn).
    // These two booleans are the SINGLE source of the ended-job suppression rule: the
    // header badge below AND the card-level banners in WorkIncomeFields both read them
    // (passed down as props), so they can never disagree (re-review 8).
    const incomeEnded = hasIncomeEnded(income);
    const needsRsuAccount = isWorkIncome && !incomeEnded && rsuGrantNeedsAccount(income, rsuAccounts);
    const needsEsppAccount = isWorkIncome && !incomeEnded && esppGrantNeedsAccount(income, esppAccounts);
    const missingAccountBadge = (needsRsuAccount || needsEsppAccount) ? (
        <span
            className="inline-flex items-center gap-1 rounded-full border border-warning-strong bg-warning-tint/30 px-2 py-0.5 text-xs font-semibold text-warning-bright whitespace-nowrap"
            title={`This income's ${needsRsuAccount ? 'RSU grant' : 'ESPP contribution'} has no linked account, so it won't be tracked. Expand the card to link one.`}
        >
            <WarningTriangleIcon className="w-3.5 h-3.5" />
            No account
        </span>
    ) : undefined;

    return (
        <ExpandableCard
            name={income.name}
            iconBg={iconBg}
            iconLabel={descriptor.slice(0, 1)}
            displayValue={getDisplayAmount(income, forceExact, simResolvedPension?.benefit)}
            frequencySuffix={getFrequencyDisplay(income, simResolvedPension?.benefit)}
            headerContent={headerContent}
            headerActions={headerActions}
            badge={missingAccountBadge}
            ariaLabelType="income"
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-[var(--c-surface-raised)] p-6 rounded-xl border border-border-subtle">
                {isFutureSS ? (
                    <FutureSocialSecurityAmountField income={income} />
                ) : hideAmountInput ? null : (
                    <CurrencyInput
                        id={`${income.id}-amount`}
                        label="Amount"
                        value={income.amount}
                        onChange={(val) => handleFieldUpdate('amount', val)}
                        tooltip="Gross income before deductions"
                    />
                )}

                {!hideFrequencyInput && (
                    <StyledSelect
                        id={`${income.id}-frequency`}
                        label="Frequency"
                        value={income.frequency}
                        onChange={(e) => handleFieldUpdate('frequency', e.target.value as IncomeFrequency)}
                        options={['Weekly', 'Bi-Weekly', 'Semi-Monthly', 'Monthly', 'Annually']}
                        tooltip="This only affects how we convert to annual amounts. The exact timing of paychecks doesn't affect the simulation."
                    />
                )}

                {!hideEarnedIncomeInput && (
                    <StyledSelect
                        id={`${income.id}-earned-income`}
                        label="Earned Income"
                        value={income.earned_income}
                        onChange={(e) => handleFieldUpdate('earned_income', e.target.value)}
                        options={['Yes', 'No']}
                    />
                )}

                {income instanceof WorkIncome && (
                    <WorkIncomeFields
                        income={income}
                        onFieldUpdate={handleFieldUpdate}
                        contributionAccounts={contributionAccounts}
                        esppAccounts={esppAccounts}
                        rsuAccounts={rsuAccounts}
                        contributionWarnings={contributionWarnings}
                        onMatchAccountChange={handleMatchAccountChange}
                        hasMatchingPensionIncome={hasMatchingPensionIncome}
                        incomeEnded={incomeEnded}
                        needsRsuAccount={needsRsuAccount}
                        needsEsppAccount={needsEsppAccount}
                    />
                )}

                {isFutureSS && (
                    <FutureSocialSecurityFields
                        income={income}
                        onFieldUpdate={handleFieldUpdate}
                        onClaimingAgeBlur={handleClaimingAgeBlur}
                        ssaFileInputRef={ssaFileInputRef}
                        onSSAFileChange={onSSAFileChange}
                        priorEarnings={assumptions.demographics.priorEarnings}
                        onClearPriorEarnings={() => assumptionsDispatch({ type: 'CLEAR_PRIOR_EARNINGS' })}
                    />
                )}

                {income instanceof CurrentSocialSecurityIncome && (
                    <div className="col-span-3">
                        <div className="bg-surface-overlay/50 border border-border-default rounded-lg px-3 py-2 text-xs text-content-muted">
                            <div className="font-semibold text-content-default mb-1">
                                Current Social Security Benefits
                            </div>
                            <div>
                                - For disability (SSDI), survivor, or retirement benefits already
                                receiving
                            </div>
                            <div>
                                - Amount will automatically adjust with COLA (Cost of Living
                                Adjustment)
                            </div>
                        </div>
                    </div>
                )}

                {income instanceof SocialSecurityIncome && (
                    <NumberInput
                        id={`${income.id}-claiming-age`}
                        label="Claiming Age (62-70)"
                        value={income.claimingAge}
                        onChange={(val) => handleFieldUpdate('claimingAge', val)}
                        onBlur={handleClaimingAgeBlur}
                    />
                )}

                {income instanceof PassiveIncome && (
                    <StyledSelect
                        id={`${income.id}-source-type`}
                        label="Source Type"
                        value={income.sourceType}
                        onChange={(e) => handleFieldUpdate('sourceType', e.target.value)}
                        options={['Dividend', 'Rental', 'Royalty', 'Other']}
                    />
                )}

                {income instanceof FERSPensionIncome && (
                    <FERSPensionFields
                        income={income}
                        onFieldUpdate={handleFieldUpdate}
                        workIncomes={workIncomes}
                        birthYear={birthYear}
                        simResolved={simResolvedPension}
                    />
                )}

                {income instanceof CSRSPensionIncome && (
                    <CSRSPensionFields
                        income={income}
                        onFieldUpdate={handleFieldUpdate}
                        workIncomes={workIncomes}
                        birthYear={birthYear}
                        simResolved={simResolvedPension}
                    />
                )}

                {isFutureSS ? (
                    <FutureSocialSecurityDateFields income={income} />
                ) : hideDateInputs ? null : (
                    <>
                        <TriggerSelector
                            id={`${income.id}-start`}
                            label="Start"
                            date={income.startDate}
                            milestoneId={income.startMilestoneId}
                            milestones={assumptions.milestones || []}
                            onDateChange={(date) => handleFieldUpdate('startDate', date)}
                            onMilestoneChange={(id) => handleFieldUpdate('startMilestoneId', id)}
                            tooltip="When this income begins - fixed date or milestone trigger"
                        />
                        <TriggerSelector
                            id={`${income.id}-end`}
                            label="End"
                            date={income.end_date}
                            milestoneId={income.endMilestoneId}
                            milestones={assumptions.milestones || []}
                            onDateChange={(date) => handleFieldUpdate('end_date', date)}
                            onMilestoneChange={(id) => handleFieldUpdate('endMilestoneId', id)}
                            tooltip="When this income ends - fixed date or milestone trigger"
                        />
                        {dateError && (
                            <div className="col-span-full text-negative text-xs">{dateError}</div>
                        )}
                    </>
                )}
            </div>
        </ExpandableCard>
    );
}

export default memo(IncomeCard);
