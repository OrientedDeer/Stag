import { useContext, useState, ReactElement } from "react";
import { AnyAccount, SavedAccount, InvestedAccount, ESPPAccount, PropertyAccount, DebtAccount, ACCOUNT_COLORS_BACKGROUND, TaxTypeEnum, ESPPLot, ESPPWithdrawalPreference, ESPP_WITHDRAWAL_PREFERENCE_OPTIONS } from "./models.js";
import { AccountContext, AllAccountKeys } from "./AccountContext.js";
import { ExpenseContext, AllExpenseKeys } from "../Expense/ExpenseContext.js";
import { StyledSelect, StyledDisplay } from "../../Layout/InputFields/StyleUI.js";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput.js";
import { PercentageInput } from "../../Layout/InputFields/PercentageInput.js";
import { ToggleInput } from "../../Layout/InputFields/ToggleInput.js";
import { NumberInput } from "../../Layout/InputFields/NumberInput.js";
import { NameInput } from "../../Layout/InputFields/NameInput.js";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput.js";
import DeleteAccountControl from './DeleteAccountUI.js';
import { EditHistoryModal } from "./EditHistoryModal.js";
import AddESPPLotModal from "./AddESPPLotModal.js";
import { formatCompactCurrency } from "../../../tabs/Future/tabs/FutureUtils.js";
import { AssumptionsContext } from "../Assumptions/AssumptionsContext.js";
import { ExpandableCard } from "../../Layout/ExpandableCard.js";

function getAccountDescriptor(account: AnyAccount): string {
    if (account instanceof SavedAccount) return "CASH";
    if (account instanceof ESPPAccount) return "ESPP";
    if (account instanceof InvestedAccount) return "INVESTMENT";
    if (account instanceof PropertyAccount) return "PROPERTY";
    if (account instanceof DebtAccount) return "DEBT";
    return "ACCOUNT";
}

function getAccountIconBg(account: AnyAccount): string {
    if (account instanceof SavedAccount) return ACCOUNT_COLORS_BACKGROUND["Cash"];
    if (account instanceof ESPPAccount || account instanceof InvestedAccount) return ACCOUNT_COLORS_BACKGROUND["Invested"];
    if (account instanceof PropertyAccount) return ACCOUNT_COLORS_BACKGROUND["Property"];
    if (account instanceof DebtAccount) return ACCOUNT_COLORS_BACKGROUND["Debt"];
    return "bg-gray-500";
}

function AccountCard({ account }: { account: AnyAccount }): ReactElement {
    const { dispatch: accountDispatch } = useContext(AccountContext);
    const { expenses, dispatch: expenseDispatch } = useContext(ExpenseContext);
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
                className="text-gray-400 hover:text-white transition-colors p-1"
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
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 bg-[#18181b] p-6 rounded-xl border border-gray-800">
                    <CurrencyInput
                        id={`${account.id}-amount`}
                        label="Current Amount"
                        value={account.amount}
                        onChange={(val) => handleFieldUpdate("amount", val)}
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
            <StyledSelect
                id={`${account.id}-tax-type`}
                label="Tax Type"
                value={account.taxType}
                onChange={(e) => onFieldUpdate("taxType", e.target.value)}
                options={TaxTypeEnum as unknown as string[]}
                tooltip="Tax treatment: Brokerage (taxable), Traditional (pre-tax, taxed on withdrawal), Roth (post-tax, tax-free growth)."
            />
            {(account.taxType === 'Roth 401k' || account.taxType === 'Traditional 401k') && (
                <Contribution401kFields account={account} onFieldUpdate={onFieldUpdate} />
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
                        value={account.nonVestedAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        tooltip="Employer contributions you'd lose if you left today."
                    />
                    <StyledDisplay
                        label="Vested Amount"
                        value={account.vestedAmount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
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
                    />
                    <CurrencyInput
                        id={`${account.id}-starting-loan-balance`}
                        label="Starting Loan Balance"
                        value={account.startingLoanBalance}
                        onChange={(val) => onFieldUpdate("startingLoanBalance", val)}
                    />
                    {!linkedAccountName && (
                        <div className="col-span-full bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-xs text-yellow-300">
                            <span className="font-semibold">Warning: Missing mortgage expense</span>
                            <p className="text-yellow-400/80 mt-1">Mortgage payments won't be tracked. Try deleting and re-adding this property.</p>
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
            />
            {!linkedAccountName && (
                <div className="col-span-full bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-3 text-xs text-yellow-300">
                    <span className="font-semibold">Warning: Missing loan expense</span>
                    <p className="text-yellow-400/80 mt-1">Loan payments won't be tracked. Try deleting and re-adding this debt.</p>
                </div>
            )}
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

            <ESPPHoldingsSummary account={account} />
            <ESPPLotsList account={account} onAddLot={onAddLot} onEditLot={onEditLot} onDeleteLot={onDeleteLot} />

            <div className="col-span-full text-sm text-gray-400">
                ESPP purchases are configured in the associated Work Income. Link this account to an income source with ESPP enabled to track future purchases.
            </div>
        </>
    );
}

function ESPPHoldingsSummary({ account }: { account: ESPPAccount }): ReactElement {
    const counts = account.getLotCounts();
    return (
        <div className="col-span-full bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <h4 className="text-sm font-semibold text-white mb-3">ESPP Holdings Summary</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                    <div className="text-gray-400">Total Lots</div>
                    <div className="text-white font-medium">{account.lots.length}</div>
                </div>
                <div>
                    <div className="text-gray-400">Total Shares</div>
                    <div className="text-white font-medium">{account.totalShares.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                </div>
                <div>
                    <div className="text-gray-400">Cost Basis</div>
                    <div className="text-white font-medium">
                        {account.totalCostBasis.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                    </div>
                </div>
                <div>
                    <div className="text-gray-400">Unrealized Gain</div>
                    <div className={`font-medium ${account.unrealizedGains >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {account.unrealizedGains.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                        {account.totalCostBasis > 0 && (
                            <span className="text-xs ml-1">
                                ({((account.unrealizedGains / account.totalCostBasis) * 100).toFixed(1)}%)
                            </span>
                        )}
                    </div>
                </div>
                <div className="col-span-2">
                    <div className="text-gray-400">Lot Status</div>
                    <div className="text-white font-medium">
                        {counts.qualifying} qualifying, {counts.disqualifying} disqualifying
                    </div>
                </div>
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
        <div className="col-span-full bg-gray-800/50 border border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white">Individual Lots</h4>
                <button
                    onClick={onAddLot}
                    className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors"
                >
                    + Add Lot
                </button>
            </div>

            {account.lots.length === 0 ? (
                <div className="text-gray-400 text-sm text-center py-4">
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
        <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-3">
            <div className="flex items-start justify-between">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-medium">Lot {index + 1}</span>
                        <span className="text-gray-400">|</span>
                        <span className="text-gray-300">{lot.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares</span>
                        <span className="text-gray-400">@</span>
                        <span className="text-gray-300">${lot.purchasePrice.toFixed(2)}/sh</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${isQualifying ? 'bg-green-900/50 text-green-400' : 'bg-yellow-900/50 text-yellow-400'}`}>
                            {isQualifying ? 'Qualifying' : 'Disqualifying'}
                        </span>
                    </div>
                    <div className="text-xs text-gray-500">
                        Grant: {grantDate.toLocaleDateString()} | Purchase: {purchaseDate.toLocaleDateString()} |
                        FMV@Grant: ${lot.fmvAtGrant.toFixed(2)} | FMV@Purchase: ${lot.fmvAtPurchase.toFixed(2)} |
                        Basis: {lot.totalCost.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
                    </div>
                </div>
                <div className="flex gap-1 ml-2">
                    <button
                        onClick={onEdit}
                        className="text-gray-400 hover:text-white p-1 transition-colors"
                        aria-label="Edit lot"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                    </button>
                    <button
                        onClick={onDelete}
                        className="text-gray-400 hover:text-red-400 p-1 transition-colors"
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

export default AccountCard;
