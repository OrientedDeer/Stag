import { useContext, useState, useEffect, useCallback, ReactElement } from "react";
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
    EXPENSE_COLORS_BACKGROUND
} from './models.js';
import { ExpenseContext, AllExpenseKeys } from "./ExpenseContext.js";
import { AccountContext } from "../Accounts/AccountContext.js";
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
import { ExpandableCard } from "../../Layout/ExpandableCard.js";
import { getFrequencyAbbrev } from "../../../utils/formatters.js";

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
    return "bg-gray-500";
}

function ExpenseCard({ expense }: { expense: AnyExpense }): ReactElement {
    const { dispatch: expenseDispatch } = useContext(ExpenseContext);
    const { accounts, dispatch: accountDispatch } = useContext(AccountContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const [dateError, setDateError] = useState<string | undefined>();

    const validateDates = useCallback((start: Date | undefined, end: Date | undefined) => {
        if (start && end && end < start) {
            setDateError("End date must be after start date");
        } else {
            setDateError(undefined);
        }
    }, []);

    useEffect(() => {
        validateDates(expense.startDate, expense.endDate);
    }, [expense.startDate, expense.endDate, validateDates]);

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

    // Display amount calculation
    const getDisplayAmount = (): string => {
        if (expense instanceof RentExpense || expense instanceof MortgageExpense || expense instanceof LoanExpense) {
            return formatCompactCurrency(expense.payment, { forceExact });
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                {!(expense instanceof MortgageExpense) && (
                    <CurrencyInput
                        id={`${expense.id}-amount`}
                        label={expense instanceof RentExpense ? "Rent/Mortgage Payment" : "Amount"}
                        value={expense instanceof RentExpense ? expense.payment : expense.amount}
                        onChange={(val) => handleFieldUpdate(isHousing ? "payment" : "amount", val)}
                    />
                )}

                {expense instanceof MortgageExpense && (
                    <StyledDisplay
                        label="Mortgage Payment"
                        value={"$" + expense.payment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    />
                )}

                <StyledSelect
                    id={`${expense.id}-frequency`}
                    label="Frequency"
                    value={expense.frequency}
                    onChange={(e) => handleFieldUpdate("frequency", e.target.value)}
                    options={["Daily", "Weekly", "Monthly", "Annually"]}
                />

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
                    label="End"
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
                    <div className="col-span-full text-red-400 text-xs">
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

interface MortgageFieldsProps {
    expense: MortgageExpense;
    onFieldUpdate: (field: AllExpenseKeys, value: unknown) => void;
    linkedAccountName: string | undefined;
    showPmiWarning: boolean;
}

function MortgageFields({ expense, onFieldUpdate, linkedAccountName, showPmiWarning }: MortgageFieldsProps): ReactElement {
    const handleResetLoanBalance = (): void => {
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const newBalance = expense.getBalanceAtDate(todayStr);
        onFieldUpdate("loan_balance", newBalance);
    };

    return (
        <>
            <CurrencyInput
                id={`${expense.id}-valuation`}
                label="Valuation"
                value={expense.valuation}
                onChange={(val) => onFieldUpdate("valuation", val)}
            />
            <CurrencyInput
                id={`${expense.id}-starting-loan-balance`}
                label="Starting Loan Balance"
                value={expense.starting_loan_balance}
                onChange={(val) => onFieldUpdate("starting_loan_balance", val)}
            />
            <CurrencyInput
                id={`${expense.id}-loan-balance`}
                label="Current Loan Balance"
                value={expense.loan_balance}
                onChange={(val) => onFieldUpdate("loan_balance", val)}
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
            <CurrencyInput
                id={`${expense.id}-extra-payment`}
                label="Extra Payment"
                value={expense.extra_payment}
                onChange={(val) => onFieldUpdate("extra_payment", val)}
            />
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
            <StyledDisplay
                label="Linked to Expense"
                blankValue="No account found, try re-adding"
                value={linkedAccountName}
            />
            <button
                type="button"
                onClick={handleResetLoanBalance}
                className="px-5 py-2.5 rounded-lg font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
                Reset Loan Balance to Today
            </button>
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
            <PercentageInput
                id={`${expense.id}-apr`}
                label="APR"
                value={expense.apr}
                onChange={(val) => onFieldUpdate("apr", val)}
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
            <StyledDisplay
                label="Linked to Expense"
                blankValue="No account found, try re-adding"
                value={linkedAccountName}
            />
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

export default ExpenseCard;
