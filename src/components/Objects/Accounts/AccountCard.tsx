import { memo, useContext, useState, ReactElement } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, ESPPAccount, RSUAccount, PropertyAccount, DebtAccount, ACCOUNT_COLORS_BACKGROUND, TaxTypeEnum, ESPPLot, ESPPWithdrawalPreference, ESPP_WITHDRAWAL_PREFERENCE_OPTIONS, RSULot, RSUWithdrawalPreference, RSU_WITHDRAWAL_PREFERENCE_OPTIONS } from "./models.js";
import { AccountDispatchContext, AllAccountKeys } from "./AccountContext.js";
import { ExpenseContext, ExpenseDispatchContext, AllExpenseKeys } from "../Expense/ExpenseContext.js";
import { StyledSelect, StyledDisplay } from "../../Layout/InputFields/StyleUI.js";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput.js";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput.js";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput.js";
import { NumberInput } from "../../Layout/InputFields/NumberInput.js";
import { NameInput } from "../../Layout/InputFields/NameInput.js";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput.js";
import { Tooltip } from "../../Layout/InputFields/Tooltip.js";
import DeleteAccountControl from './DeleteAccountUI.js';
import { EditHistoryModal } from "./EditHistoryModal.js";
import AddESPPLotModal from "./AddESPPLotModal.js";
import { formatCompactCurrency } from "../../../tabs/Future/tabs/FutureUtils.js";
import { AssumptionsContext } from "../Assumptions/AssumptionsContext.js";
import { ExpandableCard } from "../../Layout/ExpandableCard.js";
import { CardSection } from "../../Layout/CardSection.js";

// Grid layout shared by the card body and its collapsible sections.
const CARD_SECTION_GRID = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 px-4 pb-4";

const fmt = (n: number) => formatCompactCurrency(n, { forceExact: true });

/** A labeled value cell used in the holdings/cost-basis summary grids. */
function StatCell({ label, value, className = "text-white font-medium", wrapperClassName }: {
    label: string;
    value: ReactElement | string | number;
    className?: string;
    wrapperClassName?: string;
}): ReactElement {
    return (
        <div className={wrapperClassName}>
            <div className="text-content-muted">{label}</div>
            <div className={className}>{value}</div>
        </div>
    );
}

/** Cost-basis-relative gain/loss cell: green/red value with an optional percentage. */
function GainLossCell({ label, gain, basis }: { label: string; gain: number; basis: number }): ReactElement {
    return (
        <StatCell
            label={label}
            className={`font-medium ${gain >= 0 ? 'text-positive' : 'text-negative'}`}
            value={
                <>
                    {fmt(gain)}
                    {basis > 0 && (
                        <span className="text-xs ml-1">
                            ({((gain / basis) * 100).toFixed(1)}%)
                        </span>
                    )}
                </>
            }
        />
    );
}

/** Paystub-style one-liner for the collapsed Growth & Fees section. */
function getGrowthFeesSummary(customROR: number | undefined, expenseRatio: number): string {
    const ror = customROR !== undefined ? `${customROR}% custom` : "Global return";
    return `${ror} · ${expenseRatio}% ER`;
}

function get401kDetailsSummary(account: InvestedAccount): string {
    const parts: string[] = [];
    if (account.employerBalance > 0) parts.push(`${fmt(account.employerBalance)} employer`);
    parts.push(account.vestedPerYear >= 1.0 ? "fully vested" : "vesting schedule");
    if (!account.isContributionEligible) parts.push("not eligible");
    return parts.join(" · ");
}

function getESPPSettingsSummary(account: ESPPAccount): string {
    const parts: string[] = [];
    if (account.stockTicker) parts.push(account.stockTicker);
    if (account.currentSharePrice) parts.push(`$${account.currentSharePrice}/sh`);
    if (account.customROR !== undefined) parts.push(`${account.customROR}% growth`);
    const prefLabel = ESPP_WITHDRAWAL_PREFERENCE_OPTIONS
        .find((opt) => opt.value === account.withdrawalPreference)?.label.split(" (")[0]
        ?? account.withdrawalPreference;
    parts.push(prefLabel);
    if (account.minimumHoldingDays > 0) parts.push(`${account.minimumHoldingDays}d hold`);
    return parts.join(" · ");
}

function getRSUSettingsSummary(account: RSUAccount): string {
    const parts: string[] = [];
    if (account.stockTicker) parts.push(account.stockTicker);
    if (account.currentSharePrice) parts.push(`$${account.currentSharePrice}/sh`);
    if (account.customROR !== undefined) parts.push(`${account.customROR}% growth`);
    const prefLabel = RSU_WITHDRAWAL_PREFERENCE_OPTIONS
        .find((opt) => opt.value === account.withdrawalPreference)?.label.split(" (")[0]
        ?? account.withdrawalPreference;
    parts.push(prefLabel);
    if (account.minimumHoldingDays > 0) parts.push(`${account.minimumHoldingDays}d hold`);
    return parts.join(" · ");
}

function getAccountDescriptor(account: AnyAccount): string {
    if (account instanceof SavedAccount) return "CASH";
    if (account instanceof ESPPAccount) return "ESPP";
    if (account instanceof RSUAccount) return "RSU";
    if (account instanceof InvestedAccount) return "INVESTMENT";
    if (account instanceof PropertyAccount) return "PROPERTY";
    if (account instanceof DebtAccount) return "DEBT";
    return "ACCOUNT";
}

function getAccountIconBg(account: AnyAccount): string {
    if (account instanceof SavedAccount) return ACCOUNT_COLORS_BACKGROUND["Cash"];
    if (account instanceof ESPPAccount || account instanceof RSUAccount || account instanceof InvestedAccount) return ACCOUNT_COLORS_BACKGROUND["Invested"];
    if (account instanceof PropertyAccount) return ACCOUNT_COLORS_BACKGROUND["Property"];
    if (account instanceof DebtAccount) return ACCOUNT_COLORS_BACKGROUND["Debt"];
    return "bg-surface-muted";
}

function AccountCard({ account }: { account: AnyAccount }): ReactElement {
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const { expenses } = useContext(ExpenseContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { state: assumptions } = useContext(AssumptionsContext);
    const forceExact = assumptions.display?.useCompactCurrency === false;
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [isLotModalOpen, setIsLotModalOpen] = useState(false);
    const [editingLot, setEditingLot] = useState<ESPPLot | undefined>(undefined);

    const handleFieldUpdate = (field: AllAccountKeys, value: unknown): void => {
        accountDispatch({
            type: "UPDATE_ACCOUNT_FIELD",
            payload: { id: account.id, field, value },
        });

        if (account instanceof DebtAccount && account.linkedAccountId) {
            const fieldMap: Partial<Record<AllAccountKeys, AllExpenseKeys>> = { name: "name", amount: "amount", apr: "apr" };
            const expenseField = fieldMap[field];
            if (expenseField) {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: expenseField, value },
                });
            }
        }

        if (account instanceof PropertyAccount && account.linkedAccountId) {
            const fieldMap: Partial<Record<AllAccountKeys, AllExpenseKeys>> = {
                name: "name",
                amount: "valuation",
                loanAmount: "loan_balance",
                startingLoanBalance: "starting_loan_balance"
            };
            const expenseField = fieldMap[field];
            if (expenseField) {
                expenseDispatch({
                    type: "UPDATE_EXPENSE_FIELD",
                    payload: { id: account.linkedAccountId, field: expenseField, value },
                });
            }
        }

        if (field === "amount" && typeof value === 'number') {
            accountDispatch({
                type: "ADD_AMOUNT_SNAPSHOT",
                payload: { id: account.id, amount: value },
            });
        }
    };

    const getLinkedAccount = (): string | undefined => {
        if (account instanceof DebtAccount || account instanceof PropertyAccount) {
            const linkedAccount = expenses.find((exp) => exp.id === account.linkedAccountId);
            return linkedAccount?.name;
        }
        return undefined;
    };

    const displayAmount = formatCompactCurrency(account.amount, { forceExact });
    const descriptor = getAccountDescriptor(account);
    const iconBg = getAccountIconBg(account);

    const headerContent = (
        <NameInput
            label=""
            id={account.id}
            value={account.name}
            onChange={(val) => handleFieldUpdate("name", val)}
        />
    );

    const headerActions = (
        <>
            <button
                onClick={() => setIsHistoryOpen(true)}
                className="text-content-muted hover:text-white transition-colors p-1"
                aria-label={`Edit ${account.name} balance history`}
            >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                </svg>
            </button>
            <div className="text-chart-Red-75">
                <DeleteAccountControl accountId={account.id} accountName={account.name} />
            </div>
        </>
    );

    return (
        <>
            <ExpandableCard
                name={account.name}
                iconBg={iconBg}
                iconLabel={descriptor.slice(0, 1)}
                displayValue={displayAmount}
                headerContent={headerContent}
                headerActions={headerActions}
                ariaLabelType="account"
            >
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[var(--c-surface-raised)] p-6 rounded-xl border border-border-subtle">
                    <CurrencyInput
                        id={`${account.id}-amount`}
                        label="Current Amount"
                        value={account.amount}
                        onChange={(val) => handleFieldUpdate("amount", val)}
                        tooltip={account instanceof PropertyAccount
                            ? "Synced with the linked mortgage expense's valuation."
                            : account instanceof DebtAccount
                                ? "Synced with the linked loan expense's balance."
                                : undefined}
                    />

                    {account instanceof SavedAccount && (
                        <PercentageInput
                            id={`${account.id}-apr`}
                            label="APR"
                            value={account.apr}
                            onChange={(val) => handleFieldUpdate("apr", val)}
                        />
                    )}

                    {account instanceof InvestedAccount && (
                        <InvestedAccountFields account={account} onFieldUpdate={handleFieldUpdate} />
                    )}

                    {account instanceof PropertyAccount && (
                        <PropertyAccountFields account={account} onFieldUpdate={handleFieldUpdate} linkedAccountName={getLinkedAccount()} />
                    )}

                    {account instanceof DebtAccount && (
                        <DebtAccountFields account={account} onFieldUpdate={handleFieldUpdate} linkedAccountName={getLinkedAccount()} />
                    )}

                    {account instanceof ESPPAccount && (
                        <ESPPAccountFields
                            account={account}
                            onFieldUpdate={handleFieldUpdate}
                            onAddLot={() => {
                                setEditingLot(undefined);
                                setIsLotModalOpen(true);
                            }}
                            onEditLot={(lot) => {
                                setEditingLot(lot);
                                setIsLotModalOpen(true);
                            }}
                            onDeleteLot={(lotId) => {
                                accountDispatch({
                                    type: "UPDATE_ACCOUNT_FIELD",
                                    payload: { id: account.id, field: "lots", value: account.lots.filter(l => l.id !== lotId) }
                                });
                            }}
                        />
                    )}

                    {account instanceof RSUAccount && (
                        <RSUAccountFields
                            account={account}
                            onFieldUpdate={handleFieldUpdate}
                            onDeleteLot={(lotId) => {
                                const lot = account.lots.find(l => l.id === lotId);
                                accountDispatch({
                                    type: "UPDATE_ACCOUNT_FIELD",
                                    payload: { id: account.id, field: "lots", value: account.lots.filter(l => l.id !== lotId) }
                                });
                                // Keep the balance consistent: drop the lot's at-vest value.
                                if (lot) {
                                    accountDispatch({
                                        type: "UPDATE_ACCOUNT_FIELD",
                                        payload: { id: account.id, field: "amount", value: Math.max(0, account.amount - lot.fmvAtVest * lot.shares) }
                                    });
                                }
                            }}
                        />
                    )}
                </div>
            </ExpandableCard>

            <EditHistoryModal
                accountId={account.id}
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
            />

            {account instanceof ESPPAccount && (
                <AddESPPLotModal
                    isOpen={isLotModalOpen}
                    onClose={() => {
                        setIsLotModalOpen(false);
                        setEditingLot(undefined);
                    }}
                    existingLot={editingLot}
                    onSave={(lot) => {
                        if (editingLot) {
                            const updatedLots = account.lots.map(l => l.id === lot.id ? lot : l);
                            accountDispatch({
                                type: "UPDATE_ACCOUNT_FIELD",
                                payload: { id: account.id, field: "lots", value: updatedLots }
                            });
                        } else {
                            accountDispatch({
                                type: "UPDATE_ACCOUNT_FIELD",
                                payload: { id: account.id, field: "lots", value: [...account.lots, lot] }
                            });
                            const newAmount = account.amount + (lot.fmvAtPurchase * lot.shares);
                            accountDispatch({
                                type: "UPDATE_ACCOUNT_FIELD",
                                payload: { id: account.id, field: "amount", value: newAmount }
                            });
                        }
                    }}
                />
            )}
        </>
    );
}

// Extracted sub-components for type-specific fields

interface InvestedAccountFieldsProps {
    account: InvestedAccount;
    onFieldUpdate: (field: AllAccountKeys, value: unknown) => void;
}

function InvestedAccountFields({ account, onFieldUpdate }: InvestedAccountFieldsProps): ReactElement {
    return (
        <>
            {account.taxType === 'Brokerage' && (
                <>
                    <CurrencyInput
                        id={`${account.id}-cost-basis`}
                        label="Cost Basis"
                        value={account.costBasis}
                        onChange={(val) => onFieldUpdate("costBasis", val)}
                        tooltip="Your original purchase cost. Used to calculate capital gains taxes on withdrawals."
                    />
                    <BrokerageHoldingsSummary account={account} />
                </>
            )}
            {account.taxType === 'Roth IRA' && (
                <>
                    <CurrencyInput
                        id={`${account.id}-roth-contributions`}
                        label="Contributions to Date"
                        value={account.costBasis}
                        onChange={(val) => onFieldUpdate("costBasis", val)}
                        tooltip="Total you've contributed (plus any converted amounts). Everything above this is earnings. Sets the starting split — contributions are withdrawable anytime, earnings are locked until 59½."
                    />
                    <RothHoldingsSummary account={account} />
                </>
            )}
            <StyledSelect
                id={`${account.id}-tax-type`}
                label="Tax Type"
                value={account.taxType}
                onChange={(e) => onFieldUpdate("taxType", e.target.value)}
                options={TaxTypeEnum as unknown as string[]}
                tooltip="Tax treatment: Brokerage (taxable), Traditional (pre-tax, taxed on withdrawal), Roth (post-tax, tax-free growth)."
            />
            <CardSection
                id={`${account.id}-section-growth`}
                title="Growth & Fees"
                summary={getGrowthFeesSummary(account.customROR, account.expenseRatio)}
                gridClassName={CARD_SECTION_GRID}
            >
                <PercentageInput
                    id={`${account.id}-expense-ratio`}
                    label="Expense Ratio"
                    value={account.expenseRatio}
                    onChange={(val) => onFieldUpdate("expenseRatio", val)}
                    tooltip="Annual fee charged by the fund. Example: 0.15% = $15 per $10,000 invested per year."
                />
                <ToggleInput
                    id={`${account.id}-use-custom-ror`}
                    label="Custom Return Rate"
                    enabled={account.customROR !== undefined}
                    setEnabled={(checked) => {
                        onFieldUpdate("customROR", checked ? 7.0 : undefined);
                    }}
                    tooltip="Override global return rate assumptions with a custom rate for this account."
                />
                {account.customROR !== undefined && (
                    <PercentageInput
                        id={`${account.id}-custom-ror`}
                        label="Return Rate"
                        value={account.customROR}
                        onChange={(val) => onFieldUpdate("customROR", val)}
                        max={30}
                        tooltip="Expected annual return rate for this account. Overrides the global assumption."
                    />
                )}
            </CardSection>
            {(account.taxType === 'Roth 401k' || account.taxType === 'Traditional 401k') && (
                <CardSection
                    id={`${account.id}-section-401k`}
                    title="401k Details"
                    summary={get401kDetailsSummary(account)}
                    gridClassName={CARD_SECTION_GRID}
                >
                    <Contribution401kFields account={account} onFieldUpdate={onFieldUpdate} />
                </CardSection>
            )}
        </>
    );
}

interface Contribution401kFieldsProps {
    account: InvestedAccount;
    onFieldUpdate: (field: AllAccountKeys, value: unknown) => void;
}

function Contribution401kFields({ account, onFieldUpdate }: Contribution401kFieldsProps): ReactElement {
    return (
        <>
            <CurrencyInput
                id={`${account.id}-employer-balance`}
                label="Employer Balance"
                value={account.employerBalance}
                onChange={(val) => onFieldUpdate("employerBalance", val)}
                tooltip="Amount contributed by your employer (401k match). Subject to vesting schedule."
            />
            <ToggleInput
                id={`${account.id}-fully-vested`}
                label="100% Vested"
                enabled={account.vestedPerYear >= 1.0}
                setEnabled={(checked) => {
                    if (checked) {
                        onFieldUpdate("vestedPerYear", 1.0);
                        onFieldUpdate("tenureYears", 1);
                    } else {
                        onFieldUpdate("vestedPerYear", 0.2);
                        onFieldUpdate("tenureYears", 0);
                    }
                }}
                tooltip="Check if employer contributions are fully vested."
            />
            {account.vestedPerYear < 1.0 && (
                <>
                    <NumberInput
                        id={`${account.id}-tenure-years`}
                        label="Tenure (Years)"
                        value={account.tenureYears}
                        onChange={(val) => onFieldUpdate("tenureYears", val)}
                        tooltip="Years you've worked at this employer. Used to calculate vested amount."
                    />
                    <StyledDisplay
                        label="Non-Vested Amount"
                        value={account.nonVestedAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                        tooltip="Employer contributions you'd lose if you left today."
                    />
                    <StyledDisplay
                        label="Vested Amount"
                        value={account.vestedAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                        tooltip="Employer contributions that are yours to keep."
                    />
                    <PercentageInput
                        id={`${account.id}-vested-per-year`}
                        label="Vesting Schedule (per year)"
                        value={account.vestedPerYear}
                        onChange={(val) => onFieldUpdate("vestedPerYear", val)}
                        tooltip="Percentage of employer match that vests each year. Example: 20% means fully vested after 5 years."
                    />
                </>
            )}
            <ToggleInput
                id={`${account.id}-contribution-eligible`}
                label="Contribution Eligible"
                enabled={account.isContributionEligible}
                setEnabled={(val) => onFieldUpdate("isContributionEligible", val)}
                tooltip="Can you still contribute to this account? Turn off for accounts from previous employers."
            />
        </>
    );
}

interface PropertyAccountFieldsProps {
    account: PropertyAccount;
    onFieldUpdate: (field: AllAccountKeys, value: unknown) => void;
    linkedAccountName: string | undefined;
}

function PropertyAccountFields({ account, onFieldUpdate, linkedAccountName }: PropertyAccountFieldsProps): ReactElement {
    return (
        <>
            <StyledSelect
                id={`${account.id}-status`}
                label="Status"
                value={account.ownershipType}
                onChange={(e) => onFieldUpdate("ownershipType", e.target.value)}
                options={["Financed", "Owned"]}
            />
            {account.ownershipType === "Financed" && (
                <>
                    <CurrencyInput
                        id={`${account.id}-loan-amount`}
                        label="Loan Amount"
                        value={account.loanAmount}
                        onChange={(val) => onFieldUpdate("loanAmount", val)}
                        tooltip="Synced with the linked mortgage expense's current loan balance."
                    />
                    <CurrencyInput
                        id={`${account.id}-starting-loan-balance`}
                        label="Starting Loan Balance"
                        value={account.startingLoanBalance}
                        onChange={(val) => onFieldUpdate("startingLoanBalance", val)}
                        tooltip="Synced with the linked mortgage expense."
                    />
                    {linkedAccountName ? (
                        <StyledDisplay
                            label="Linked to Expense"
                            value={linkedAccountName}
                        />
                    ) : (
                        <div className="col-span-full bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-3 text-xs text-warning-bright">
                            <span className="font-semibold">Warning: Missing mortgage expense</span>
                            <p className="text-warning/80 mt-1">Mortgage payments won't be tracked. Try deleting and re-adding this property.</p>
                        </div>
                    )}
                </>
            )}
        </>
    );
}

interface DebtAccountFieldsProps {
    account: DebtAccount;
    onFieldUpdate: (field: AllAccountKeys, value: unknown) => void;
    linkedAccountName: string | undefined;
}

function DebtAccountFields({ account, onFieldUpdate, linkedAccountName }: DebtAccountFieldsProps): ReactElement {
    return (
        <>
            <PercentageInput
                id={`${account.id}-apr`}
                label="APR"
                value={account.apr}
                onChange={(val) => onFieldUpdate("apr", val)}
                tooltip="Synced with the linked loan expense's APR."
            />
            {linkedAccountName ? (
                <StyledDisplay
                    label="Linked to Expense"
                    value={linkedAccountName}
                />
            ) : (
                <div className="col-span-full bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-3 text-xs text-warning-bright">
                    <span className="font-semibold">Warning: Missing loan expense</span>
                    <p className="text-warning/80 mt-1">Loan payments won't be tracked. Try deleting and re-adding this debt.</p>
                </div>
            )}
            <div className="col-span-full">
                <ToggleInput
                    id={`${account.id}-accepts-surplus-paydown`}
                    label="Pay down with surplus cash"
                    enabled={account.acceptsSurplusPaydown}
                    setEnabled={(val) => onFieldUpdate("acceptsSurplusPaydown", val)}
                    tooltip="When on, leftover cash each year goes toward paying off this debt early (highest-APR flagged debts first) before being invested."
                />
            </div>
        </>
    );
}

interface ESPPAccountFieldsProps {
    account: ESPPAccount;
    onFieldUpdate: (field: AllAccountKeys, value: unknown) => void;
    onAddLot: () => void;
    onEditLot: (lot: ESPPLot) => void;
    onDeleteLot: (lotId: string) => void;
}

function ESPPAccountFields({ account, onFieldUpdate, onAddLot, onEditLot, onDeleteLot }: ESPPAccountFieldsProps): ReactElement {
    return (
        <>
            <CardSection
                id={`${account.id}-section-stock`}
                title="Stock & Purchase Settings"
                summary={getESPPSettingsSummary(account)}
                gridClassName={CARD_SECTION_GRID}
            >
                <NameInput
                    id={`${account.id}-ticker`}
                    label="Stock Ticker"
                    value={account.stockTicker || ''}
                    onChange={(val) => onFieldUpdate("stockTicker", val || undefined)}
                    placeholder="e.g., AAPL"
                />
                <CurrencyInput
                    id={`${account.id}-share-price`}
                    label="Current Share Price"
                    value={account.currentSharePrice ?? 0}
                    // Treat 0 as "unset": readers do `currentSharePrice ?? derived`,
                    // and 0 ?? x === 0 would value every lot at $0 (account unsellable).
                    onChange={(val) => onFieldUpdate("currentSharePrice", val || undefined)}
                    tooltip="Current price per share for easier value tracking"
                />
                <ToggleInput
                    id={`${account.id}-use-custom-ror`}
                    label="Custom Growth Rate"
                    enabled={account.customROR !== undefined}
                    setEnabled={(checked) => {
                        onFieldUpdate("customROR", checked ? 7.0 : undefined);
                    }}
                    tooltip="Override global return rate assumptions with a custom rate for this ESPP."
                />
                {account.customROR !== undefined && (
                    <PercentageInput
                        id={`${account.id}-custom-ror`}
                        label="Expected Growth"
                        value={account.customROR}
                        onChange={(val) => onFieldUpdate("customROR", val)}
                        max={30}
                        tooltip="Expected annual stock growth rate. Overrides global assumptions."
                    />
                )}
                <DropdownInput
                    id={`${account.id}-withdrawal-pref`}
                    label="Withdrawal Preference"
                    value={account.withdrawalPreference}
                    onChange={(val) => onFieldUpdate("withdrawalPreference", val as ESPPWithdrawalPreference)}
                    options={ESPP_WITHDRAWAL_PREFERENCE_OPTIONS}
                    tooltip="Controls which lots are sold first during retirement withdrawals"
                />
                <NumberInput
                    id={`${account.id}-min-hold`}
                    label="Min Holding (Days)"
                    value={account.minimumHoldingDays}
                    onChange={(val) => onFieldUpdate("minimumHoldingDays", val)}
                    min={0}
                    max={1095}
                    tooltip="Employer-required holding period before shares can be sold"
                />
            </CardSection>

            <ESPPHoldingsSummary account={account} />
            <ESPPLotsList account={account} onAddLot={onAddLot} onEditLot={onEditLot} onDeleteLot={onDeleteLot} />

            <div className="col-span-full text-sm text-content-muted">
                ESPP purchases are configured in the associated Work Income. Link this account to an income source with ESPP enabled to track future purchases.
            </div>
        </>
    );
}

function BrokerageHoldingsSummary({ account }: { account: InvestedAccount }): ReactElement {
    const principal = account.costBasis;
    // True gain/loss for display: account.unrealizedGains floors at 0 (correct
    // for the tax/withdrawal basis-vs-gains split), but the card should show a
    // loss when the account is underwater (current value below cost basis).
    const unrealizedGain = account.amount - account.costBasis;
    return (
        <div className="col-span-full bg-surface-overlay/50 border border-border-default rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">Cost Basis Breakdown</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <StatCell label="Current Value" value={fmt(account.amount)} />
                <StatCell label="Principal (Cost Basis)" value={fmt(principal)} />
                <GainLossCell label="Unrealized Gain/Loss" gain={unrealizedGain} basis={principal} />
            </div>
        </div>
    );
}

function RothHoldingsSummary({ account }: { account: InvestedAccount }): ReactElement {
    // Derive the split so the three cells always reconcile to Current Value — even
    // for an imported account whose costBasis (set via the Contributions input) is
    // below its conversion basis: clamp Converted to costBasis, then Contributions
    // is the remainder. Normal case (costBasis >= conversion basis) is unchanged:
    // `contributions` then equals `account.regularContributions`. (#100 review)
    const converted = Math.min(account.totalConversionBasis, account.costBasis);
    const contributions = account.costBasis - converted;
    // True earnings for display: account.unrealizedGains floors at 0 (correct for
    // the withdrawal basis split), but show a loss when the account is underwater.
    const earnings = account.amount - account.costBasis;
    // Collapse the conversion layer to a clean 2-way split when there are no conversions.
    const hasConversions = converted > 0.5;
    return (
        <div className="col-span-full bg-surface-overlay/50 border border-border-default rounded-lg p-4">
            <div className="flex items-center gap-1.5 mb-3">
                <h4 className="text-sm font-semibold text-white">Withdrawal Breakdown</h4>
                <Tooltip text="Roth withdrawal rules: contributions come out anytime tax- and penalty-free; each conversion has its own 5-year clock; earnings are locked until 59½." />
            </div>
            <div className={`grid grid-cols-2 ${hasConversions ? 'md:grid-cols-4' : 'md:grid-cols-3'} gap-4 text-sm`}>
                <StatCell label="Current Value" value={fmt(account.amount)} />
                <StatCell
                    label="Contributions"
                    value={fmt(contributions)}
                    className="text-positive font-medium"
                />
                {hasConversions && (
                    <StatCell
                        label="Converted"
                        value={fmt(converted)}
                        className="text-content-default font-medium"
                    />
                )}
                <GainLossCell label="Earnings" gain={earnings} basis={account.costBasis} />
            </div>
            <div className="mt-3 text-xs text-content-muted">
                Contributions are withdrawable anytime; {hasConversions ? 'each conversion clears after 5 years; ' : ''}earnings are locked until 59½.
            </div>
        </div>
    );
}

function ESPPHoldingsSummary({ account }: { account: ESPPAccount }): ReactElement {
    const counts = account.getLotCounts();
    return (
        <div className="col-span-full bg-surface-overlay/50 border border-border-default rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">ESPP Holdings Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <StatCell label="Total Lots" value={account.lots.length} />
                <StatCell label="Total Shares" value={account.totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
                <StatCell label="Cost Basis" value={fmt(account.totalCostBasis)} />
                <GainLossCell label="Unrealized Gain" gain={account.unrealizedGains} basis={account.totalCostBasis} />
                <StatCell
                    label="Lot Status"
                    value={`${counts.qualifying} qualifying, ${counts.disqualifying} disqualifying`}
                    wrapperClassName="col-span-2"
                />
            </div>
        </div>
    );
}

interface ESPPLotsListProps {
    account: ESPPAccount;
    onAddLot: () => void;
    onEditLot: (lot: ESPPLot) => void;
    onDeleteLot: (lotId: string) => void;
}

function ESPPLotsList({ account, onAddLot, onEditLot, onDeleteLot }: ESPPLotsListProps): ReactElement {
    return (
        <div className="col-span-full bg-surface-overlay/50 border border-border-default rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white">Individual Lots</h4>
                <button
                    onClick={onAddLot}
                    className="text-xs px-3 py-1.5 rounded-lg bg-positive-solid/20 text-positive hover:bg-positive-solid/30 transition-colors"
                >
                    + Add Lot
                </button>
            </div>

            {account.lots.length === 0 ? (
                <div className="text-content-muted text-sm text-center py-4">
                    No lots yet. Add lots manually or link to a Work Income with ESPP enabled.
                </div>
            ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {account.lots.map((lot, index) => (
                        <ESPPLotRow
                            key={lot.id}
                            lot={lot}
                            index={index}
                            account={account}
                            onEdit={() => onEditLot(lot)}
                            onDelete={() => onDeleteLot(lot.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface ESPPLotRowProps {
    lot: ESPPLot;
    index: number;
    account: ESPPAccount;
    onEdit: () => void;
    onDelete: () => void;
}

function ESPPLotRow({ lot, index, account, onEdit, onDelete }: ESPPLotRowProps): ReactElement {
    const isQualifying = account.calculateDispositionType(lot, new Date()) === 'qualifying';
    const grantDate = new Date(lot.grantDate);
    const purchaseDate = new Date(lot.purchaseDate);

    return (
        <div className="bg-surface-raised/50 border border-border-default rounded-lg p-3">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-medium">Lot {index + 1}</span>
                        <span className="text-content-muted">|</span>
                        <span className="text-content-default">{lot.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares</span>
                        <span className="text-content-muted">@</span>
                        <span className="text-content-default">${lot.purchasePrice.toFixed(2)}/sh</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isQualifying ? 'bg-positive-tint/50 text-positive' : 'bg-warning-tint/50 text-warning'}`}>
                            {isQualifying ? 'Qualifying' : 'Disqualifying'}
                        </span>
                    </div>
                    <div className="text-xs text-content-subtle">
                        Grant: {grantDate.toLocaleDateString()} | Purchase: {purchaseDate.toLocaleDateString()} |
                        FMV@Grant: ${lot.fmvAtGrant.toFixed(2)} | FMV@Purchase: ${lot.fmvAtPurchase.toFixed(2)} |
                        Basis: {lot.totalCost.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                    </div>
                </div>
                <div className="flex gap-1 ml-2">
                    <button
                        onClick={onEdit}
                        className="text-content-muted hover:text-white p-1 transition-colors"
                        aria-label="Edit lot"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button
                        onClick={onDelete}
                        className="text-content-muted hover:text-negative p-1 transition-colors"
                        aria-label="Delete lot"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}

interface RSUAccountFieldsProps {
    account: RSUAccount;
    onFieldUpdate: (field: AllAccountKeys, value: unknown) => void;
    onDeleteLot: (lotId: string) => void;
}

function RSUAccountFields({ account, onFieldUpdate, onDeleteLot }: RSUAccountFieldsProps): ReactElement {
    return (
        <>
            <CardSection
                id={`${account.id}-section-rsu-stock`}
                title="Stock & Vesting Settings"
                summary={getRSUSettingsSummary(account)}
                gridClassName={CARD_SECTION_GRID}
            >
                <NameInput
                    id={`${account.id}-rsu-ticker`}
                    label="Stock Ticker"
                    value={account.stockTicker || ''}
                    onChange={(val) => onFieldUpdate("stockTicker", val || undefined)}
                    placeholder="e.g., AAPL"
                />
                <CurrencyInput
                    id={`${account.id}-rsu-share-price`}
                    label="Current Share Price"
                    value={account.currentSharePrice ?? 0}
                    // Treat 0 as "unset": readers do `currentSharePrice ?? derived`,
                    // and 0 ?? x === 0 would value every lot at $0 (account unsellable).
                    onChange={(val) => onFieldUpdate("currentSharePrice", val || undefined)}
                    tooltip="Current price per share. Seeds the projected fair-market value at each vest."
                />
                <ToggleInput
                    id={`${account.id}-rsu-use-custom-ror`}
                    label="Custom Growth Rate"
                    enabled={account.customROR !== undefined}
                    setEnabled={(checked) => {
                        onFieldUpdate("customROR", checked ? 7.0 : undefined);
                    }}
                    tooltip="Override global return rate assumptions with a custom rate for this RSU account."
                />
                {account.customROR !== undefined && (
                    <PercentageInput
                        id={`${account.id}-rsu-custom-ror`}
                        label="Expected Growth"
                        value={account.customROR}
                        onChange={(val) => onFieldUpdate("customROR", val)}
                        max={30}
                        tooltip="Expected annual stock growth rate. Overrides global assumptions."
                    />
                )}
                <DropdownInput
                    id={`${account.id}-rsu-withdrawal-pref`}
                    label="Withdrawal Preference"
                    value={account.withdrawalPreference}
                    onChange={(val) => onFieldUpdate("withdrawalPreference", val as RSUWithdrawalPreference)}
                    options={RSU_WITHDRAWAL_PREFERENCE_OPTIONS}
                    tooltip="Controls which lots are sold first during retirement withdrawals."
                />
                <NumberInput
                    id={`${account.id}-rsu-min-hold`}
                    label="Min Holding (Days)"
                    value={account.minimumHoldingDays}
                    onChange={(val) => onFieldUpdate("minimumHoldingDays", val)}
                    min={0}
                    max={1095}
                    tooltip="Optional holding period before shares can be sold."
                />
            </CardSection>

            <RSUHoldingsSummary account={account} />
            <RSULotsList account={account} onDeleteLot={onDeleteLot} />

            <div className="col-span-full text-sm text-content-muted">
                RSU grants and vesting schedules are configured in the associated Work Income. Vesting tranches are added automatically during the simulation.
            </div>
        </>
    );
}

function RSUHoldingsSummary({ account }: { account: RSUAccount }): ReactElement {
    // True gain/loss for display: account.unrealizedGains floors at 0 (correct for
    // the tax/withdrawal basis-vs-gains split), but the card should show a loss
    // when the account is underwater (current value below cost basis) — the #71
    // brokerage-card precedent.
    const unrealizedGain = account.amount - account.totalCostBasis;
    return (
        <div className="col-span-full bg-surface-overlay/50 border border-border-default rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">RSU Holdings Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <StatCell label="Total Lots" value={account.lots.length} />
                <StatCell label="Total Shares" value={account.totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })} />
                <StatCell label="Cost Basis" value={fmt(account.totalCostBasis)} />
                <GainLossCell label="Unrealized Gain/Loss" gain={unrealizedGain} basis={account.totalCostBasis} />
            </div>
        </div>
    );
}

interface RSULotsListProps {
    account: RSUAccount;
    onDeleteLot: (lotId: string) => void;
}

function RSULotsList({ account, onDeleteLot }: RSULotsListProps): ReactElement {
    return (
        <div className="col-span-full bg-surface-overlay/50 border border-border-default rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">Vested Lots</h4>

            {account.lots.length === 0 ? (
                <div className="text-content-muted text-sm text-center py-4">
                    No vested lots yet. Link a Work Income with RSUs enabled to add vesting tranches during the simulation.
                </div>
            ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {account.lots.map((lot, index) => (
                        <RSULotRow
                            key={lot.id}
                            lot={lot}
                            index={index}
                            account={account}
                            onDelete={() => onDeleteLot(lot.id)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface RSULotRowProps {
    lot: RSULot;
    index: number;
    account: RSUAccount;
    onDelete: () => void;
}

function RSULotRow({ lot, index, account, onDelete }: RSULotRowProps): ReactElement {
    const isLongTerm = account.isLongTerm(lot, new Date());
    const vestDate = new Date(lot.vestDate);
    const sharePrice = account.currentSharePrice ?? (account.totalShares > 0 ? account.amount / account.totalShares : lot.fmvAtVest);
    const currentValue = lot.shares * sharePrice;
    // Real gain/loss for display (do NOT floor at 0 — show underwater losses, #71).
    const gain = currentValue - lot.costBasis;

    return (
        <div className="bg-surface-raised/50 border border-border-default rounded-lg p-3">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-medium">Lot {index + 1}</span>
                        <span className="text-content-muted">|</span>
                        <span className="text-content-default">{lot.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isLongTerm ? 'bg-positive-tint/50 text-positive' : 'bg-warning-tint/50 text-warning'}`}>
                            {isLongTerm ? 'Long-Term' : 'Short-Term'}
                        </span>
                    </div>
                    <div className="text-xs text-content-subtle">
                        Vested: {vestDate.toLocaleDateString()} |
                        FMV@Vest: ${lot.fmvAtVest.toFixed(2)} |
                        Basis: {lot.costBasis.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} |
                        Value: {currentValue.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} |
                        <span className={gain >= 0 ? 'text-positive' : 'text-negative'}>
                            {' '}{gain >= 0 ? 'Gain' : 'Loss'}: {gain.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}
                        </span>
                    </div>
                </div>
                <div className="flex gap-1 ml-2">
                    <button
                        onClick={onDelete}
                        className="text-content-muted hover:text-negative p-1 transition-colors"
                        aria-label="Delete lot"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}

export default memo(AccountCard);
