import { memo, useContext, ReactElement } from "react";
import {
    AnyExpense,
    RentExpense,
    MortgageExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
    TransportExpense,
    FoodExpense,
    OtherExpense,
    CharityExpense,
    SubscriptionExpense,
    EXPENSE_COLORS_BACKGROUND,
    isLongTermGoal,
    getGoalMonthlySetAside
} from './models.js';
import { ExpenseDispatchContext, AllExpenseKeys } from "./ExpenseContext.js";
import { AccountContext, AccountDispatchContext } from "../Accounts/AccountContext.js";
import { StyledDisplay, StyledSelect } from "../../Layout/InputFields/StyleUI.js";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput.js";
import DeleteExpenseControl from './DeleteExpenseUI.js';
import { PercentageInput } from "../../Layout/InputFields/PercentageInput.js";
import { NumberInput } from "../../Layout/InputFields/NumberInput.js";
import { NameInput } from "../../Layout/InputFields/NameInput.js";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput.js";
import { TriggerSelector } from "../../Layout/InputFields/TriggerSelector.js";
import { formatCompactCurrency } from "../../../tabs/Future/tabs/FutureUtils.js";
import { AssumptionsContext } from "../Assumptions/AssumptionsContext.js";
import { AlertBanner } from "../../Layout/AlertBanner.js";
import { CardSection } from "../../Layout/CardSection.js";
import { ExpandableCard } from "../../Layout/ExpandableCard.js";
import { getFrequencyAbbrev, formatDateForInput } from "../../../utils/formatters.js";
import { GOAL_TYPE_LABELS, DEFAULT_GOAL_INTERVAL_YEARS } from "./goalKinds.js";
import { ANNUAL_MODE_LABELS, MONTH_NAMES } from "./annualCadence.js";

import { Button } from "../../Layout/Primitives";

function getExpenseDescriptor(expense: AnyExpense): string {
    if (expense instanceof RentExpense) return "RENT";
    if (expense instanceof MortgageExpense) return "MORTGAGE";
    if (expense instanceof LoanExpense) return "LOAN";
    if (expense instanceof DependentExpense) return "DEPENDENT";
    if (expense instanceof HealthcareExpense) return "HEALTHCARE";
    if (expense instanceof VacationExpense) return "VACATION";
    if (expense instanceof EmergencyExpense) return "EMERGENCY";
    if (expense instanceof TransportExpense) return "TRANSPORT";
    if (expense instanceof FoodExpense) return "FOOD";
    if (expense instanceof OtherExpense) return "OTHER";
    if (expense instanceof CharityExpense) return "CHARITY";
    if (expense instanceof SubscriptionExpense) return "SUBSCRIPTION";
    return "EXPENSE";
}

function getExpenseIconBg(expense: AnyExpense): string {
    if (expense instanceof RentExpense) return EXPENSE_COLORS_BACKGROUND["Rent"];
    if (expense instanceof MortgageExpense) return EXPENSE_COLORS_BACKGROUND["Mortgage"];
    if (expense instanceof LoanExpense) return EXPENSE_COLORS_BACKGROUND["Loan"];
    if (expense instanceof DependentExpense) return EXPENSE_COLORS_BACKGROUND["Dependent"];
    if (expense instanceof HealthcareExpense) return EXPENSE_COLORS_BACKGROUND["Healthcare"];
    if (expense instanceof VacationExpense) return EXPENSE_COLORS_BACKGROUND["Vacation"];
    if (expense instanceof EmergencyExpense) return EXPENSE_COLORS_BACKGROUND["Emergency"];
    if (expense instanceof TransportExpense) return EXPENSE_COLORS_BACKGROUND["Transport"];
    if (expense instanceof FoodExpense) return EXPENSE_COLORS_BACKGROUND["Food"];
    if (expense instanceof OtherExpense) return EXPENSE_COLORS_BACKGROUND["Other"];
    if (expense instanceof CharityExpense) return EXPENSE_COLORS_BACKGROUND["Charity"];
    if (expense instanceof SubscriptionExpense) return EXPENSE_COLORS_BACKGROUND["Subscription"];
    return "bg-surface-muted";
}

function ExpenseCard({ expense }: { expense: AnyExpense }): ReactElement {
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { accounts } = useContext(AccountContext);
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    // Purely derived from the two dates — compute during render rather than via
    // setState in an effect (which causes cascading renders; react-hooks flags it).
    const dateError = expense.startDate && expense.endDate && expense.endDate < expense.startDate
        ? "End date must be after start date"
        : undefined;

    const isHousing = expense instanceof RentExpense || expense instanceof MortgageExpense;

    const getLinkedAccount = (): string | undefined => {
        if (expense instanceof LoanExpense || expense instanceof MortgageExpense) {
            const linkedAccount = accounts.find((acc) => acc.id === expense.linkedAccountId);
            return linkedAccount?.name;
        }
        return undefined;
    };

    // PMI Warning Logic
    const showPmiWarning = expense instanceof MortgageExpense &&
        expense.valuation > 0 &&
        ((expense.valuation - expense.loan_balance) / expense.valuation) > 0.2 &&
        expense.pmi > 0;

    // Long-term goals are funded via a linked sinking-fund + savings priority,
    // so per-expense frequency is meaningless for them (the goal "kind" governs).
    const isGoal = isLongTermGoal(expense);

    const handleFieldUpdate = (field: AllExpenseKeys, value: unknown): void => {
        expenseDispatch({
            type: "UPDATE_EXPENSE_FIELD",
            payload: { id: expense.id, field, value },
        });

        // Sync Loan Expense to Debt Account
        if (expense instanceof LoanExpense && expense.linkedAccountId) {
            const accId = expense.linkedAccountId;
            if (field === 'name') {
                accountDispatch({ type: 'UPDATE_ACCOUNT_FIELD', payload: { id: accId, field: 'name', value } });
            }
            if (field === 'amount') {
                accountDispatch({ type: 'UPDATE_ACCOUNT_FIELD', payload: { id: accId, field: 'amount', value } });
            }
            if (field === 'apr') {
                accountDispatch({ type: 'UPDATE_ACCOUNT_FIELD', payload: { id: accId, field: 'apr', value } });
            }
        }

        // Sync Mortgage Expense to Property Account
        if (expense instanceof MortgageExpense) {
            const updatedExpense = Object.assign(Object.create(Object.getPrototypeOf(expense)), expense);
            (updatedExpense as Record<string, unknown>)[field] = value;

            if (typeof (updatedExpense as { calculatePayment?: () => number }).calculatePayment === 'function') {
                const newPayment = (updatedExpense as { calculatePayment: () => number }).calculatePayment();
                if (newPayment !== expense.payment) {
                    expenseDispatch({
                        type: "UPDATE_EXPENSE_FIELD",
                        payload: { id: expense.id, field: "payment", value: newPayment },
                    });
                }
            }

            if (typeof (updatedExpense as { calculateDeductible?: () => number }).calculateDeductible === 'function') {
                const newDeductible = (updatedExpense as { calculateDeductible: () => number }).calculateDeductible();
                if (newDeductible !== expense.tax_deductible) {
                    expenseDispatch({
                        type: "UPDATE_EXPENSE_FIELD",
                        payload: { id: expense.id, field: "tax_deductible", value: newDeductible },
                    });
                }
            }

            if (field === "name") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "name", value },
                });
            }
            if (field === "valuation") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "amount", value },
                });
            }
            if (field === "loan_balance") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "loanAmount", value },
                });
            }
            if (field === "starting_loan_balance") {
                accountDispatch({
                    type: "UPDATE_ACCOUNT_FIELD",
                    payload: { id: expense.linkedAccountId, field: "startingLoanBalance", value },
                });
            }
        }
    };

    // Switch a goal's kind in place. Funding is fully derived from the goal's
    // current fields (getGoalMonthlySetAside / getGoalFundMonthlyCap), and the
    // linked sinking-fund account is untouched, so no already-funded money is
    // lost — only the set-aside formula changes (interval vs target horizon).
    // When switching to 'recurring' with no interval yet, seed a sensible
    // default so the set-aside isn't 0 until the user types one.
    const handleGoalTypeChange = (next: 'recurring' | 'targetDate'): void => {
        handleFieldUpdate("goalType", next);
        if (next === 'recurring') {
            // Recurring goals have no end date — the next purchase is start +
            // k*interval (mirrors AddExpenseModal, which never sets endDate on a
            // recurring goal). A leftover targetDate endDate would suppress the
            // recurring lump and halt the fund's accrual past that year, and a
            // past endDate would mark the goal "done" (#67).
            if (expense.endDate) handleFieldUpdate("endDate", undefined);
            if (expense.endMilestoneId) handleFieldUpdate("endMilestoneId", undefined);
            if (!(expense.intervalYears && expense.intervalYears > 0)) {
                handleFieldUpdate("intervalYears", DEFAULT_GOAL_INTERVAL_YEARS);
            }
        }
    };

    // Display amount calculation
    const getDisplayAmount = (): string => {
        if (expense instanceof RentExpense || expense instanceof MortgageExpense || expense instanceof LoanExpense) {
            return formatCompactCurrency(expense.payment, { forceExact });
        }
        // A goal's `amount` is the TOTAL cost with frequency 'Monthly' — showing
        // "$10,000/mo" in the header would be wildly wrong. Show the committed
        // monthly set-aside; the total lives in the Amount field inside.
        if (isGoal) {
            return formatCompactCurrency(getGoalMonthlySetAside(expense), { forceExact });
        }
        return formatCompactCurrency(expense.amount, { forceExact });
    };

    const descriptor = getExpenseDescriptor(expense);
    const iconBg = getExpenseIconBg(expense);

    const headerContent = (
        <NameInput
            label=""
            id={expense.id}
            value={expense.name}
            onChange={(val) => handleFieldUpdate("name", val)}
        />
    );

    const headerActions = (
        <div className="text-chart-Red-75">
            <DeleteExpenseControl expenseId={expense.id} expenseName={expense.name} />
        </div>
    );

    return (
        <ExpandableCard
            name={expense.name}
            iconBg={iconBg}
            iconLabel={descriptor.slice(0, 1)}
            displayValue={getDisplayAmount()}
            frequencySuffix={`/${getFrequencyAbbrev(expense.frequency)}`}
            headerContent={headerContent}
            headerActions={headerActions}
            ariaLabelType="expense"
        >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-[var(--c-surface-raised)] p-6 rounded-xl border border-border-subtle">
                {!(expense instanceof MortgageExpense) && (
                    <CurrencyInput
                        id={`${expense.id}-amount`}
                        label={expense instanceof RentExpense ? "Rent/Mortgage Payment" : "Amount"}
                        value={expense instanceof RentExpense ? expense.payment : expense.amount}
                        onChange={(val) => handleFieldUpdate(isHousing ? "payment" : "amount", val)}
                        tooltip={expense instanceof LoanExpense
                            ? "Synced with the linked debt account's balance."
                            : undefined}
                    />
                )}

                {expense instanceof MortgageExpense && (
                    <StyledDisplay
                        label="Mortgage Payment"
                        value={"$" + expense.payment.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    />
                )}

                {isGoal ? (
                    <>
                        {/* Kind is editable after creation: switching swaps the
                            set-aside formula without touching the funded balance. */}
                        <StyledSelect
                            id={`${expense.id}-goal-type`}
                            label="Goal Type"
                            value={GOAL_TYPE_LABELS[expense.goalType ?? "recurring"]}
                            onChange={(e) => handleGoalTypeChange(
                                e.target.value === GOAL_TYPE_LABELS.targetDate ? "targetDate" : "recurring"
                            )}
                            tooltip="Recurring: a big-ticket item replaced every N years (e.g. roof). Save by date: a one-time goal funded by a target date."
                            options={[GOAL_TYPE_LABELS.recurring, GOAL_TYPE_LABELS.targetDate]}
                        />

                        {expense.goalType === "recurring" && (
                            <NumberInput
                                id={`${expense.id}-interval-years`}
                                label="Every (years)"
                                value={expense.intervalYears ?? DEFAULT_GOAL_INTERVAL_YEARS}
                                // Ignore a transient 0 (field cleared to retype): an
                                // interval of 0 silently zeroes the set-aside (#67).
                                onChange={(val) => { if (val >= 1) handleFieldUpdate("intervalYears", val); }}
                                tooltip="How often this expense recurs, in years."
                            />
                        )}

                        {/* Derived live from amount + dates/interval — edits to the
                            goal update this (and the funding) automatically. */}
                        <StyledDisplay
                            label="Set-aside"
                            value={`$${getGoalMonthlySetAside(expense).toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo`}
                        />
                    </>
                ) : (
                    <>
                        <StyledSelect
                            id={`${expense.id}-frequency`}
                            label="Frequency"
                            value={expense.frequency}
                            onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                            options={["Weekly", "Monthly", "Annually"]}
                        />

                        {expense.frequency === "Annually" && (
                            <>
                                <StyledSelect
                                    id={`${expense.id}-due-month`}
                                    label="Due Month"
                                    value={MONTH_NAMES[(expense.dueMonth ?? 1) - 1]}
                                    onChange={(e) => handleFieldUpdate("dueMonth", MONTH_NAMES.indexOf(e.target.value) + 1)}
                                    tooltip="The month this yearly expense is actually paid."
                                    options={MONTH_NAMES}
                                />
                                <StyledSelect
                                    id={`${expense.id}-annual-mode`}
                                    label="How to Budget"
                                    value={ANNUAL_MODE_LABELS[expense.annualMode ?? "lump"]}
                                    onChange={(e) => handleFieldUpdate("annualMode", e.target.value === ANNUAL_MODE_LABELS.sinkingFund ? "sinkingFund" : "lump")}
                                    tooltip="Pay in due month: the full amount is budgeted in its due month. Save monthly: set aside 1/12 each month toward it."
                                    options={[ANNUAL_MODE_LABELS.lump, ANNUAL_MODE_LABELS.sinkingFund]}
                                />
                            </>
                        )}
                    </>
                )}

                <TriggerSelector
                    id={`${expense.id}-start`}
                    label="Start"
                    date={expense.startDate}
                    milestoneId={expense.startMilestoneId}
                    milestones={assumptions.milestones || []}
                    onDateChange={(date) => handleFieldUpdate("startDate", date)}
                    onMilestoneChange={(id) => handleFieldUpdate("startMilestoneId", id)}
                    tooltip="When this expense begins - fixed date or milestone trigger"
                />

                <TriggerSelector
                    id={`${expense.id}-end`}
                    label={isGoal && expense.goalType === "targetDate" ? "Target date" : "End"}
                    date={expense.endDate}
                    milestoneId={expense.endMilestoneId}
                    milestones={assumptions.milestones || []}
                    onDateChange={(date) => handleFieldUpdate("endDate", date)}
                    onMilestoneChange={(id) => handleFieldUpdate("endMilestoneId", id)}
                    tooltip="When this expense ends - fixed date or milestone trigger"
                />

                <ToggleInput
                    id={`${expense.id}-discretionary`}
                    label="Discretionary"
                    enabled={expense.isDiscretionary}
                    setEnabled={(val) => handleFieldUpdate("isDiscretionary", val)}
                    tooltip="Discretionary expenses can be reduced during Guyton-Klinger guardrail triggers in retirement."
                />

                {dateError && (
                    <div className="col-span-full text-negative text-xs">
                        {dateError}
                    </div>
                )}

                {expense instanceof RentExpense && (
                    <CurrencyInput
                        id={`${expense.id}-utilities`}
                        label="Utilities"
                        value={expense.utilities}
                        onChange={(val) => handleFieldUpdate("utilities", val)}
                    />
                )}

                {expense instanceof MortgageExpense && (
                    <MortgageFields
                        expense={expense}
                        onFieldUpdate={handleFieldUpdate}
                        linkedAccountName={getLinkedAccount()}
                        showPmiWarning={showPmiWarning}
                    />
                )}

                {expense instanceof LoanExpense && (
                    <LoanFields
                        expense={expense}
                        onFieldUpdate={handleFieldUpdate}
                        linkedAccountName={getLinkedAccount()}
                    />
                )}

                {expense instanceof CharityExpense && (
                    <CharityFields expense={expense} onFieldUpdate={handleFieldUpdate} />
                )}
            </div>
        </ExpandableCard>
    );
}

// Sub-components for type-specific fields

const fmt = (n: number): string => formatCompactCurrency(n, { forceExact: true });

/** Paystub-style one-liner for the collapsed Loan section. */
function getMortgageLoanSummary(expense: MortgageExpense): string {
    let summary = `${fmt(expense.loan_balance)} @ ${expense.apr}% · ${expense.term_length} yr`;
    if (expense.extra_payment > 0) {
        summary += ` · +${fmt(expense.extra_payment)} extra`;
    }
    return summary;
}

/** Total monthly escrow/ownership extras on top of P&I — mirrors the
 *  per-component math in the MortgageExpense constructor. */
function getMortgageExtrasSummary(expense: MortgageExpense): string {
    const monthlyPct = (pct: number, base: number): number => (pct / 100 / 12) * base;
    const propertyTax = monthlyPct(expense.property_taxes, expense.valuation - expense.valuation_deduction);
    // PMI only applies while loan-to-value is above 80% (matches the constructor).
    const pmi = expense.valuation > 0 && expense.loan_balance / expense.valuation > 0.8
        ? monthlyPct(expense.pmi, expense.valuation)
        : 0;
    const total = propertyTax + pmi
        + monthlyPct(expense.maintenance, expense.valuation)
        + monthlyPct(expense.home_owners_insurance, expense.valuation)
        + expense.hoa_fee
        + expense.utilities;
    return total > 0 ? `${fmt(Math.round(total))}/mo extras` : 'None';
}

function getLoanDetailsSummary(expense: LoanExpense): string {
    return `${expense.apr}% APR · ${fmt(expense.payment)}/${getFrequencyAbbrev(expense.frequency)}`;
}

interface MortgageFieldsProps {
    expense: MortgageExpense;
    onFieldUpdate: (field: AllExpenseKeys, value: unknown) => void;
    linkedAccountName: string | undefined;
    showPmiWarning: boolean;
}

function MortgageFields({ expense, onFieldUpdate, linkedAccountName, showPmiWarning }: MortgageFieldsProps): ReactElement {
    const handleResetLoanBalance = (): void => {
        const todayStr = formatDateForInput(new Date());
        const newBalance = expense.getBalanceAtDate(todayStr);
        onFieldUpdate("loan_balance", newBalance);
    };

    return (
        <>
            {/* Valuation is the headline number; the linked-account display,
                reset button, and PMI warning also stay top-level — warnings
                and alerts must never be hidden by a collapsed section. */}
            <CurrencyInput
                id={`${expense.id}-valuation`}
                label="Valuation"
                value={expense.valuation}
                onChange={(val) => onFieldUpdate("valuation", val)}
                tooltip="Synced with the linked property account's value — editing this updates your net worth."
            />
            <StyledDisplay
                label="Linked to Property"
                blankValue="No account found, try re-adding"
                value={linkedAccountName}
            />
            <Button
                type="button"
                onClick={handleResetLoanBalance}
                variant="primary" size="lg" className="text-white"
            >
                Reset Loan Balance to Today
            </Button>

            <CardSection
                id={`${expense.id}-section-loan`}
                title="Loan"
                summary={getMortgageLoanSummary(expense)}
            >
                <CurrencyInput
                    id={`${expense.id}-starting-loan-balance`}
                    label="Starting Loan Balance"
                    value={expense.starting_loan_balance}
                    onChange={(val) => onFieldUpdate("starting_loan_balance", val)}
                    tooltip="Synced with the linked property account."
                />
                <CurrencyInput
                    id={`${expense.id}-loan-balance`}
                    label="Current Loan Balance"
                    value={expense.loan_balance}
                    onChange={(val) => onFieldUpdate("loan_balance", val)}
                    tooltip="Synced with the linked property account's loan balance."
                />
                <PercentageInput
                    id={`${expense.id}-apr`}
                    label="APR"
                    value={expense.apr}
                    onChange={(val) => onFieldUpdate("apr", val)}
                />
                <NumberInput
                    id={`${expense.id}-term-length`}
                    label="Term Length (years)"
                    value={expense.term_length}
                    onChange={(val) => onFieldUpdate("term_length", val)}
                />
                <CurrencyInput
                    id={`${expense.id}-extra-payment`}
                    label="Extra Payment"
                    value={expense.extra_payment}
                    onChange={(val) => onFieldUpdate("extra_payment", val)}
                />
            </CardSection>

            <CardSection
                id={`${expense.id}-section-escrow`}
                title="Escrow & ownership costs"
                summary={getMortgageExtrasSummary(expense)}
            >
                <PercentageInput
                    id={`${expense.id}-property-taxes`}
                    label="Property Taxes"
                    value={expense.property_taxes}
                    onChange={(val) => onFieldUpdate("property_taxes", val)}
                />
                <CurrencyInput
                    id={`${expense.id}-valuation-deduction`}
                    label="Valuation Deduction"
                    value={expense.valuation_deduction}
                    onChange={(val) => onFieldUpdate("valuation_deduction", val)}
                />
                <PercentageInput
                    id={`${expense.id}-homeowners-insurance`}
                    label="Homeowners Insurance"
                    value={expense.home_owners_insurance}
                    onChange={(val) => onFieldUpdate("home_owners_insurance", val)}
                />
                <PercentageInput
                    id={`${expense.id}-pmi`}
                    label="PMI"
                    value={expense.pmi}
                    onChange={(val) => onFieldUpdate("pmi", val)}
                />
                <CurrencyInput
                    id={`${expense.id}-hoa-fee`}
                    label="HOA Fee"
                    value={expense.hoa_fee}
                    onChange={(val) => onFieldUpdate("hoa_fee", val)}
                />
                <PercentageInput
                    id={`${expense.id}-maintenance`}
                    label="Maintenance"
                    value={expense.maintenance}
                    onChange={(val) => onFieldUpdate("maintenance", val)}
                />
                <CurrencyInput
                    id={`${expense.id}-utilities`}
                    label="Utilities"
                    value={expense.utilities}
                    onChange={(val) => onFieldUpdate("utilities", val)}
                />
            </CardSection>

            <CardSection
                id={`${expense.id}-section-tax`}
                title="Tax treatment"
                summary={expense.is_tax_deductible}
            >
                <StyledSelect
                    id={`${expense.id}-tax-deductible`}
                    label="Tax Deductible"
                    value={expense.is_tax_deductible}
                    onChange={(e) => onFieldUpdate("is_tax_deductible", e.target.value)}
                    options={["Yes", "No", "Itemized"]}
                />
                {(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
                    <StyledDisplay
                        label="Deductible Amount"
                        value={"$" + expense.tax_deductible.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    />
                )}
            </CardSection>

            {showPmiWarning && (
                <AlertBanner severity="warning" size="sm" className="col-span-full">
                    With over 20% equity, you may be eligible to have your PMI removed. Contact your lender to inquire about the process.
                </AlertBanner>
            )}
        </>
    );
}

interface LoanFieldsProps {
    expense: LoanExpense;
    onFieldUpdate: (field: AllExpenseKeys, value: unknown) => void;
    linkedAccountName: string | undefined;
}

function LoanFields({ expense, onFieldUpdate, linkedAccountName }: LoanFieldsProps): ReactElement {
    return (
        <>
            {/* The linked-account display stays top-level so a broken link is
                never hidden behind a collapsed section. */}
            <StyledDisplay
                label="Linked to Debt Account"
                blankValue="No account found, try re-adding"
                value={linkedAccountName}
            />
            <CardSection
                id={`${expense.id}-section-loan-details`}
                title="Loan details"
                summary={getLoanDetailsSummary(expense)}
            >
                <PercentageInput
                    id={`${expense.id}-apr`}
                    label="APR"
                    value={expense.apr}
                    onChange={(val) => onFieldUpdate("apr", val)}
                    tooltip="Synced with the linked debt account's APR."
                />
                <StyledSelect
                    id={`${expense.id}-interest-type`}
                    label="Interest Type"
                    value={expense.interest_type}
                    onChange={(e) => onFieldUpdate("interest_type", e.target.value)}
                    options={["Simple", "Compounding"]}
                />
                <CurrencyInput
                    id={`${expense.id}-payment`}
                    label="Payment"
                    value={expense.payment}
                    onChange={(val) => onFieldUpdate("payment", val)}
                />
                <StyledSelect
                    id={`${expense.id}-tax-deductible`}
                    label="Tax Deductible"
                    value={expense.is_tax_deductible}
                    onChange={(e) => onFieldUpdate("is_tax_deductible", e.target.value)}
                    options={["Yes", "No", "Itemized"]}
                />
                {(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
                    <CurrencyInput
                        id={`${expense.id}-deductible-amount`}
                        label="Deductible Amount"
                        value={expense.tax_deductible}
                        onChange={(val) => onFieldUpdate("tax_deductible", val)}
                    />
                )}
            </CardSection>
        </>
    );
}

interface CharityFieldsProps {
    expense: CharityExpense;
    onFieldUpdate: (field: AllExpenseKeys, value: unknown) => void;
}

function CharityFields({ expense, onFieldUpdate }: CharityFieldsProps): ReactElement {
    return (
        <>
            <StyledSelect
                id={`${expense.id}-tax-deductible`}
                label="Tax Deductible"
                value={expense.is_tax_deductible}
                onChange={(e) => onFieldUpdate("is_tax_deductible", e.target.value)}
                options={["Yes", "No", "Itemized"]}
            />
            {(expense.is_tax_deductible === 'Yes' || expense.is_tax_deductible === 'Itemized') && (
                <CurrencyInput
                    id={`${expense.id}-deductible-amount`}
                    label="Deductible Amount"
                    value={expense.tax_deductible}
                    onChange={(val) => onFieldUpdate("tax_deductible", val)}
                />
            )}
        </>
    );
}

export default memo(ExpenseCard);
