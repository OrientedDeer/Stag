import React, { useState, useContext } from "react";
import { AccountDispatchContext } from "./AccountContext";
import {
    SavedAccount,
    InvestedAccount,
    ESPPAccount,
    RSUAccount,
    PropertyAccount,
    DebtAccount,
    TaxType,
    TaxTypeEnum,
    ESPPWithdrawalPreference,
    ESPP_WITHDRAWAL_PREFERENCE_OPTIONS,
    RSUWithdrawalPreference,
    RSU_WITHDRAWAL_PREFERENCE_OPTIONS
} from './models';
import { ExpenseDispatchContext } from "../Expense/ExpenseContext";
import { LoanExpense, MortgageExpense } from "../Expense/models";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";
import { Button } from "../../Layout/Primitives";
import { useReceiptToast } from "../../Layout/Overlays/ReceiptToast";
import { CardSection } from "../../Layout/CardSection";
import { formatCompactCurrency } from "../../../tabs/Future/tabs/FutureUtils";

const generateUniqueAccId = () =>
    `ACC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

// Modal field grid, mirrored inside collapsible sections.
const MODAL_SECTION_GRID = "grid grid-cols-2 lg:grid-cols-3 gap-4 px-4 pb-4";

const fmt = (n: number) => formatCompactCurrency(n, { forceExact: true });

type AddableAccountClass =
    | typeof SavedAccount
    | typeof InvestedAccount
    | typeof ESPPAccount
    | typeof RSUAccount
    | typeof PropertyAccount
    | typeof DebtAccount;

interface AddAccountModalProps {
    isOpen: boolean;
    selectedType: AddableAccountClass | null;
    onClose: () => void;
}

interface AccountFormState {
    name: string;
    amount: number;
    apr: number;
    // Investment account fields
    employerBalance: number;
    tenureYears: number;
    vestedPerYear: number;
    isFullyVested: boolean;
    expenseRatio: number;
    taxType: TaxType;
    isContributionEligible: boolean;
    useCustomROR: boolean;
    customROR: number;
    // Property fields
    ownershipType: 'Financed' | 'Owned';
    loanAmount: number;
    startingLoanAmount: number;
    // ESPP fields
    stockTicker: string;
    currentSharePrice: number;
    withdrawalPreference: ESPPWithdrawalPreference;
    minimumHoldingDays: number;
    // RSU withdrawal preference (separate enum from ESPP)
    rsuWithdrawalPreference: RSUWithdrawalPreference;
}

const INITIAL_FORM_STATE: AccountFormState = {
    name: '',
    amount: 0,
    apr: 0,
    employerBalance: 0,
    tenureYears: 0,
    vestedPerYear: 0.2,
    isFullyVested: false,
    expenseRatio: 0.1,
    taxType: 'Brokerage',
    isContributionEligible: true,
    useCustomROR: false,
    customROR: 7.0,
    ownershipType: 'Owned',
    loanAmount: 0,
    startingLoanAmount: 0,
    stockTicker: '',
    currentSharePrice: 0,
    withdrawalPreference: 'fifo',
    minimumHoldingDays: 0,
    rsuWithdrawalPreference: 'fifo',
};

/** Live one-liner for the collapsed Growth & Fees section. */
function getGrowthFeesSummary(form: AccountFormState): string {
    const ror = form.useCustomROR ? `${form.customROR}% custom` : 'Global return';
    return `${ror} · ${form.expenseRatio}% ER`;
}

function get401kDetailsSummary(form: AccountFormState): string {
    const parts: string[] = [];
    if (form.employerBalance > 0) parts.push(`${fmt(form.employerBalance)} employer`);
    parts.push(form.isFullyVested ? 'fully vested' : 'vesting schedule');
    if (!form.isContributionEligible) parts.push('not eligible');
    return parts.join(' · ');
}

function getESPPSettingsSummary(form: AccountFormState): string {
    const parts: string[] = [];
    if (form.stockTicker.trim()) parts.push(form.stockTicker.trim());
    if (form.currentSharePrice > 0) parts.push(`$${form.currentSharePrice}/sh`);
    if (form.useCustomROR) parts.push(`${form.customROR}% growth`);
    const prefLabel = ESPP_WITHDRAWAL_PREFERENCE_OPTIONS
        .find((opt) => opt.value === form.withdrawalPreference)?.label.split(' (')[0]
        ?? form.withdrawalPreference;
    parts.push(prefLabel);
    if (form.minimumHoldingDays > 0) parts.push(`${form.minimumHoldingDays}d hold`);
    return parts.join(' · ');
}

function getRSUSettingsSummary(form: AccountFormState): string {
    const parts: string[] = [];
    if (form.stockTicker.trim()) parts.push(form.stockTicker.trim());
    if (form.currentSharePrice > 0) parts.push(`$${form.currentSharePrice}/sh`);
    if (form.useCustomROR) parts.push(`${form.customROR}% growth`);
    const prefLabel = RSU_WITHDRAWAL_PREFERENCE_OPTIONS
        .find((opt) => opt.value === form.rsuWithdrawalPreference)?.label.split(' (')[0]
        ?? form.rsuWithdrawalPreference;
    parts.push(prefLabel);
    if (form.minimumHoldingDays > 0) parts.push(`${form.minimumHoldingDays}d hold`);
    return parts.join(' · ');
}

const AddAccountModal: React.FC<AddAccountModalProps> = ({
    isOpen,
    selectedType,
    onClose,
}) => {
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { show: showReceipt } = useReceiptToast();
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    const [form, setForm] = useState<AccountFormState>(INITIAL_FORM_STATE);

    const id = generateUniqueAccId();

    function updateForm<K extends keyof AccountFormState>(field: K, value: AccountFormState[K]): void {
        setForm(prev => ({ ...prev, [field]: value }));
    }

    const handleClose = () => {
        setForm(INITIAL_FORM_STATE);
        onClose();
    };

    const handleAdd = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!selectedType || !form.name.trim()) return;

        let newAccount;

        if (selectedType === SavedAccount) {
            newAccount = new SavedAccount(id, form.name.trim(), form.amount, form.apr);
        } else if (selectedType === InvestedAccount) {
            // If fully vested, use 100% per year with 1 year tenure
            const finalTenure = form.isFullyVested ? 1 : form.tenureYears;
            const finalVestedPerYear = form.isFullyVested ? 1.0 : form.vestedPerYear;
            const finalCustomROR = form.useCustomROR ? form.customROR : undefined;
            newAccount = new InvestedAccount(
                id, form.name.trim(), form.amount, form.employerBalance, finalTenure,
                form.expenseRatio, form.taxType, form.isContributionEligible,
                finalVestedPerYear, form.amount, finalCustomROR
            );
        } else if (selectedType === ESPPAccount) {
            const finalCustomROR = form.useCustomROR ? form.customROR : undefined;
            const finalTicker = form.stockTicker.trim() || undefined;
            const finalSharePrice = form.currentSharePrice > 0 ? form.currentSharePrice : undefined;
            newAccount = new ESPPAccount(
                id, form.name.trim(), form.amount,
                [], // No initial lots
                null, // No linked income
                finalCustomROR, finalTicker, finalSharePrice,
                form.withdrawalPreference, form.minimumHoldingDays
            );
        } else if (selectedType === RSUAccount) {
            const finalCustomROR = form.useCustomROR ? form.customROR : undefined;
            const finalTicker = form.stockTicker.trim() || undefined;
            const finalSharePrice = form.currentSharePrice > 0 ? form.currentSharePrice : undefined;
            newAccount = new RSUAccount(
                id, form.name.trim(), form.amount,
                [], // No initial lots — vesting tranches are added by the simulation
                null, // No linked income
                finalCustomROR, finalTicker, finalSharePrice,
                form.rsuWithdrawalPreference, form.minimumHoldingDays
            );
        } else if (selectedType === PropertyAccount) {
            if (form.ownershipType === "Financed") {
                const newExpense = new MortgageExpense(
                    'EXS' + id.substring(3), form.name.trim(), 'Monthly',
                    form.amount, form.loanAmount, form.startingLoanAmount,
                    6.23, 30, 0.85, 89850, 1, 180, 0.56, 0.58, 0,
                    'Itemized', 0, id, new Date(), 0, 0
                );
                expenseDispatch({ type: "ADD_EXPENSE", payload: newExpense });
                showReceipt({
                    message: `Created mortgage expense '${form.name.trim()}' with assumed terms (6.23% APR, 30 yr) — review it`,
                    linkTo: "/current/expense?tab=Monthly",
                    linkLabel: "Review",
                });
            }
            newAccount = new PropertyAccount(
                id, form.name.trim(), form.amount, form.ownershipType,
                form.loanAmount, form.startingLoanAmount, 'EXS' + id.substring(3)
            );
        } else if (selectedType === DebtAccount) {
            const newExpense = new LoanExpense(
                'EXS' + id.substring(3), form.name.trim(), form.amount,
                "Monthly", form.apr, "Compounding", 0, "No", 0, id, new Date()
            );
            expenseDispatch({ type: "ADD_EXPENSE", payload: newExpense });
            showReceipt({
                message: `Created loan expense '${form.name.trim()}' under Expenses`,
                linkTo: "/current/expense?tab=Monthly",
            });
            newAccount = new DebtAccount(id, form.name.trim(), form.amount, 'EXS' + id.substring(3), form.apr);
        }

        if (!newAccount) return;
        accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
        handleClose();
    };

    if (!isOpen) return null;

    // Get modal title based on account type
    const getModalTitle = () => {
        if (selectedType === SavedAccount) return 'Add Cash Account';
        if (selectedType === InvestedAccount) return 'Add Investment Account';
        if (selectedType === ESPPAccount) return 'Add ESPP Account';
        if (selectedType === RSUAccount) return 'Add RSU Account';
        if (selectedType === PropertyAccount) return 'Add Property';
        if (selectedType === DebtAccount) return 'Add Debt';
        return 'Add Account';
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-account-modal-title"
                className="bg-surface-raised border border-border-subtle rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-lg"
                onKeyDown={handleKeyDown}
            >
                <h2 id="add-account-modal-title" className="text-xl font-bold text-white mb-4">
                    {getModalTitle()}
                </h2>
                <form onSubmit={handleAdd}>
                <div className="space-y-4">
                    <div>
                        <NameInput
                            label="Account Name"
                            id={id}
                            value={form.name}
                            onChange={(val) => updateForm('name', val)}
                        />
                    </div>

                    {selectedType === PropertyAccount && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={form.amount}
                                onChange={(val) => updateForm('amount', val)}
                            />
                            <DropdownInput
                                id={`${id}-ownership-type`}
                                label="Ownership Type"
                                onChange={(val) => updateForm('ownershipType', val as "Owned" | "Financed")}
                                options={["Owned", "Financed"]}
                                value={form.ownershipType}
                            />
                            {form.ownershipType === "Financed" && (
                                <>
                                    <CurrencyInput
                                        id={`${id}-loan-amount`}
                                        label="Loan Amount"
                                        value={form.loanAmount}
                                        onChange={(val) => updateForm('loanAmount', val)}
                                    />
                                    <CurrencyInput
                                        id={`${id}-starting-loan-amount`}
                                        label="Starting Loan Amount"
                                        value={form.startingLoanAmount}
                                        onChange={(val) => updateForm('startingLoanAmount', val)}
                                    />
                                </>
                            )}
                        </div>
                    )}
                    {selectedType === InvestedAccount && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={form.amount}
                                onChange={(val) => updateForm('amount', val)}
                            />
                            <DropdownInput
                                id={`${id}-tax-type`}
                                label="Tax Type"
                                value={form.taxType}
                                onChange={(val) => updateForm('taxType', val as TaxType)}
                                options={[...TaxTypeEnum]}
                                tooltip="Tax treatment: Brokerage (taxable), Traditional (pre-tax, taxed on withdrawal), Roth (post-tax, tax-free growth)."
                            />
                            <CardSection
                                id={`${id}-section-growth`}
                                title="Growth & Fees"
                                summary={getGrowthFeesSummary(form)}
                                gridClassName={MODAL_SECTION_GRID}
                            >
                                <PercentageInput
                                    id={`${id}-expense-ratio`}
                                    label="Expense Ratio"
                                    value={form.expenseRatio}
                                    onChange={(val) => updateForm('expenseRatio', val)}
                                    max={5}
                                    tooltip="Annual fee charged by the fund. Example: 0.15% = $15 per $10,000 invested per year."
                                />
                                <ToggleInput
                                    id={`${id}-use-custom-ror`}
                                    label="Custom Return Rate"
                                    enabled={form.useCustomROR}
                                    setEnabled={(val) => updateForm('useCustomROR', val)}
                                    tooltip="Override global return rate assumptions with a custom rate for this account."
                                />
                                {form.useCustomROR && (
                                    <PercentageInput
                                        id={`${id}-custom-ror`}
                                        label="Return Rate"
                                        value={form.customROR}
                                        onChange={(val) => updateForm('customROR', val)}
                                        max={30}
                                        tooltip="Expected annual return rate for this account. Overrides the global assumption."
                                    />
                                )}
                            </CardSection>
                            {(form.taxType === 'Roth 401k' || form.taxType === 'Traditional 401k') && (
                                <CardSection
                                    id={`${id}-section-401k`}
                                    title="401k Details"
                                    summary={get401kDetailsSummary(form)}
                                    gridClassName={MODAL_SECTION_GRID}
                                >
                                    <CurrencyInput
                                        id={`${id}-employer-balance`}
                                        label="Employer Balance"
                                        value={form.employerBalance}
                                        onChange={(val) => updateForm('employerBalance', val)}
                                        tooltip="Amount contributed by your employer (401k match). Subject to vesting schedule."
                                    />
                                    <ToggleInput
                                        id={`${id}-fully-vested`}
                                        label="100% Vested"
                                        enabled={form.isFullyVested}
                                        setEnabled={(val) => updateForm('isFullyVested', val)}
                                        tooltip="Check if employer contributions are fully vested. Hides vesting schedule fields."
                                    />
                                    {!form.isFullyVested && (
                                        <>
                                            <NumberInput
                                                id={`${id}-tenure-years`}
                                                label="Tenure (Years)"
                                                value={form.tenureYears}
                                                onChange={(val) => updateForm('tenureYears', val)}
                                                tooltip="Years you've worked at this employer. Used to calculate vested amount."
                                            />
                                            <PercentageInput
                                                id={`${id}-vested-per-year`}
                                                label="Vested Per Year"
                                                value={form.vestedPerYear}
                                                onChange={(val) => updateForm('vestedPerYear', val)}
                                                tooltip="Percentage of employer match that vests each year. Example: 20% means fully vested after 5 years."
                                            />
                                        </>
                                    )}
                                    <ToggleInput
                                        id={`${id}-contribution-eligible`}
                                        label="Contribution Eligible"
                                        enabled={form.isContributionEligible}
                                        setEnabled={(val) => updateForm('isContributionEligible', val)}
                                        tooltip="Can you still contribute to this account? Turn off for accounts from previous employers."
                                    />
                                </CardSection>
                            )}
                        </div>
                    )}
                    {selectedType === ESPPAccount && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Current Value"
                                value={form.amount}
                                onChange={(val) => updateForm('amount', val)}
                                tooltip="Current market value of your ESPP shares."
                            />
                            <CardSection
                                id={`${id}-section-stock`}
                                title="Stock & Purchase Settings"
                                summary={getESPPSettingsSummary(form)}
                                gridClassName={MODAL_SECTION_GRID}
                            >
                                <NameInput
                                    id={`${id}-ticker`}
                                    label="Stock Ticker"
                                    value={form.stockTicker}
                                    onChange={(val) => updateForm('stockTicker', val)}
                                    placeholder="e.g., AAPL"
                                />
                                <CurrencyInput
                                    id={`${id}-share-price`}
                                    label="Current Share Price"
                                    value={form.currentSharePrice}
                                    onChange={(val) => updateForm('currentSharePrice', val)}
                                    tooltip="Current price per share for easier value tracking."
                                />
                                <ToggleInput
                                    id={`${id}-use-custom-ror`}
                                    label="Custom Growth Rate"
                                    enabled={form.useCustomROR}
                                    setEnabled={(val) => updateForm('useCustomROR', val)}
                                    tooltip="Override global return rate assumptions with a custom rate for this ESPP."
                                />
                                {form.useCustomROR && (
                                    <PercentageInput
                                        id={`${id}-custom-ror`}
                                        label="Expected Growth"
                                        value={form.customROR}
                                        onChange={(val) => updateForm('customROR', val)}
                                        max={30}
                                        tooltip="Expected annual stock growth rate. Overrides global assumptions."
                                    />
                                )}
                                <DropdownInput
                                    id={`${id}-withdrawal-pref`}
                                    label="Withdrawal Preference"
                                    value={form.withdrawalPreference}
                                    onChange={(val) => updateForm('withdrawalPreference', val as ESPPWithdrawalPreference)}
                                    options={ESPP_WITHDRAWAL_PREFERENCE_OPTIONS}
                                    tooltip="Controls which lots are sold first during retirement withdrawals."
                                />
                                <NumberInput
                                    id={`${id}-min-hold`}
                                    label="Min Holding (Days)"
                                    value={form.minimumHoldingDays}
                                    onChange={(val) => updateForm('minimumHoldingDays', val)}
                                    min={0}
                                    max={1095}
                                    tooltip="Employer-required holding period before shares can be sold."
                                />
                            </CardSection>
                            <div className="col-span-full text-sm text-content-muted">
                                ESPP purchases are configured in the associated Work Income. Link this account to an income source with ESPP enabled.
                            </div>
                        </div>
                    )}
                    {selectedType === RSUAccount && (
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Current Value"
                                value={form.amount}
                                onChange={(val) => updateForm('amount', val)}
                                tooltip="Current market value of your vested RSU shares."
                            />
                            <CardSection
                                id={`${id}-section-rsu-stock`}
                                title="Stock & Vesting Settings"
                                summary={getRSUSettingsSummary(form)}
                                gridClassName={MODAL_SECTION_GRID}
                            >
                                <NameInput
                                    id={`${id}-rsu-ticker`}
                                    label="Stock Ticker"
                                    value={form.stockTicker}
                                    onChange={(val) => updateForm('stockTicker', val)}
                                    placeholder="e.g., AAPL"
                                />
                                <CurrencyInput
                                    id={`${id}-rsu-share-price`}
                                    label="Current Share Price"
                                    value={form.currentSharePrice}
                                    onChange={(val) => updateForm('currentSharePrice', val)}
                                    tooltip="Current price per share. Seeds the projected fair-market value at each vest."
                                />
                                <ToggleInput
                                    id={`${id}-rsu-use-custom-ror`}
                                    label="Custom Growth Rate"
                                    enabled={form.useCustomROR}
                                    setEnabled={(val) => updateForm('useCustomROR', val)}
                                    tooltip="Override global return rate assumptions with a custom rate for this RSU account."
                                />
                                {form.useCustomROR && (
                                    <PercentageInput
                                        id={`${id}-rsu-custom-ror`}
                                        label="Expected Growth"
                                        value={form.customROR}
                                        onChange={(val) => updateForm('customROR', val)}
                                        max={30}
                                        tooltip="Expected annual stock growth rate. Overrides global assumptions."
                                    />
                                )}
                                <DropdownInput
                                    id={`${id}-rsu-withdrawal-pref`}
                                    label="Withdrawal Preference"
                                    value={form.rsuWithdrawalPreference}
                                    onChange={(val) => updateForm('rsuWithdrawalPreference', val as RSUWithdrawalPreference)}
                                    options={RSU_WITHDRAWAL_PREFERENCE_OPTIONS}
                                    tooltip="Controls which lots are sold first during retirement withdrawals."
                                />
                                <NumberInput
                                    id={`${id}-rsu-min-hold`}
                                    label="Min Holding (Days)"
                                    value={form.minimumHoldingDays}
                                    onChange={(val) => updateForm('minimumHoldingDays', val)}
                                    min={0}
                                    max={1095}
                                    tooltip="Optional holding period before shares can be sold."
                                />
                            </CardSection>
                            <div className="col-span-full text-sm text-content-muted">
                                RSU grants and vesting schedules are configured in the associated Work Income. Link this account to an income source with RSUs enabled.
                            </div>
                        </div>
                    )}
                    {!(selectedType === InvestedAccount || selectedType === PropertyAccount || selectedType === ESPPAccount || selectedType === RSUAccount) && (
                        <div className="grid grid-cols-1 gap-4">
                            <CurrencyInput
                                id={`${id}-amount`}
                                label="Amount"
                                value={form.amount}
                                onChange={(val) => updateForm('amount', val)}
                            />
                            <PercentageInput
                                id={`${id}-apr`}
                                label="APR"
                                value={form.apr}
                                onChange={(val) => updateForm('apr', val)}
                                max={50}
                            />
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-3 mt-8">
                    <Button
                        type="button"
                        onClick={handleClose}
                        variant="ghost" size="lg"
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        disabled={!form.name.trim()}
                        title={!form.name.trim() ? "Enter a name" : undefined}
                        variant="positive" size="lg"
                    >
                        Add Account
                    </Button>
                </div>
                </form>
            </div>
        </div>
    );
};

export default AddAccountModal;