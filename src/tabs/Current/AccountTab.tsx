import React, { useState, useContext, useEffect, useMemo } from "react";
import { AccountContext, AccountDispatchContext } from "../../components/Objects/Accounts/AccountContext";
import { useSubTabKeyboardNav } from "../../hooks/useKeyboardShortcuts";
import { useSubTabDeepLink } from "../../hooks/useSubTabDeepLink";
import {
    SavedAccount,
    InvestedAccount,
    ESPPAccount,
    RSUAccount,
    PropertyAccount,
    DebtAccount,
    ACCOUNT_CATEGORIES,
    type AnyAccount,
    CLASS_TO_CATEGORY,
    CATEGORY_PALETTES,
} from "../../components/Objects/Accounts/models";
import AccountCard from "../../components/Objects/Accounts/AccountCard";
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import AddAccountModal from "../../components/Objects/Accounts/AddAccountModal";
import ImportBalancesModal from "./ImportBalancesModal";
import { ObjectsIcicleChart } from "../../components/Charts/ObjectsIcicleChart";
import { tailwindToCssVar, getDistributedColors } from "../../components/Charts/icicleChartHelpers";
import { Panel } from "../../components/Layout/Primitives";

const AccountList = ({ type }: { type: abstract new (...args: never[]) => unknown }) => {
    const { accounts } = useContext(AccountContext);
    const { dispatch } = useContext(AccountDispatchContext);

    const filteredAccounts = accounts
        .map((acc, index) => ({ acc, originalIndex: index }))
        .filter(({ acc }) => acc instanceof type);

    const onDragEnd = (result: DropResult) => {
        if (!result.destination) return;

        const sourceIndex = filteredAccounts[result.source.index].originalIndex;
        const destinationIndex = filteredAccounts[result.destination.index].originalIndex;

        dispatch({
            type: 'REORDER_ACCOUNTS',
            payload: { startIndex: sourceIndex, endIndex: destinationIndex }
        });
    };

    if (filteredAccounts.length === 0) return null;

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId="accounts-list">
                {(provided) => (
                    <div
                        {...provided.droppableProps}
                        ref={provided.innerRef}
                        className="flex flex-col"
                    >
                        {filteredAccounts.map(({ acc }, index) => (
                            <Draggable key={acc.id} draggableId={acc.id} index={index}>
                                {(provided, snapshot) => (
                                    <div
                                        ref={provided.innerRef}
                                        {...provided.draggableProps}
                                        className={`relative group pb-6 ${snapshot.isDragging ? 'z-50' : ''}`}
                                    >
                                        <div
                                            {...provided.dragHandleProps}
                                            className="absolute -left-3 top-2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-2 text-positive-bright"
                                        >
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <line x1="8" y1="6" x2="21" y2="6"></line>
                                                <line x1="8" y1="12" x2="21" y2="12"></line>
                                                <line x1="8" y1="18" x2="21" y2="18"></line>
                                                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                                                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                                                <line x1="3" y1="18" x2="3.01" y2="18"></line>
                                            </svg>
                                        </div>
                                        <div className="ml-4">
                                            <AccountCard account={acc} />
                                        </div>
                                    </div>
                                )}
                            </Draggable>
                        ))}
                        {provided.placeholder}
                    </div>
                )}
            </Droppable>
        </DragDropContext>
    );
};

// Helper to get account value (handles special cases for Property, Invested, Debt)
const getAccountValue = (account: AnyAccount): number => {
    if (account instanceof PropertyAccount) {
        return account.amount - account.loanAmount;
    }
    if (account instanceof InvestedAccount) {
        return account.amount - account.nonVestedAmount;
    }
    if (account instanceof DebtAccount) {
        return -account.amount;
    }
    return account.amount;
};

export default function AccountTab() {
    const { accounts } = useContext(AccountContext);

    const [activeTab, setActiveTab] = useState<string>(() => {
        const saved = localStorage.getItem('account_active_tab');
        // Guard against stale localStorage values (e.g. category renamed since)
        return saved && (ACCOUNT_CATEGORIES as readonly string[]).includes(saved)
            ? saved
            : ACCOUNT_CATEGORIES[0];
    });
    // Receipt links arrive as /current/accounts?tab=Cash — select that
    // category instead of whatever tab localStorage last saved.
    useSubTabDeepLink(ACCOUNT_CATEGORIES, setActiveTab);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [showESPPModal, setShowESPPModal] = useState(false);
    const [showRSUModal, setShowRSUModal] = useState(false);
    const [showImportModal, setShowImportModal] = useState(false);

    // Data wrangling for icicle chart
    const hierarchicalData = useMemo(() => {
        // Calculate real Net Worth (subtracting debts)
        const totalNetWorth = accounts.reduce((sum, acc) => sum + getAccountValue(acc), 0);
        // Calculate total assets (excluding debt) for percentage calculations
        // Percentages should show "what % of my assets is this", not "what % of assets + debt"
        const totalAssets = accounts.reduce((sum, acc) => {
            const value = getAccountValue(acc);
            return value > 0 ? sum + value : sum;  // Only include positive values (assets, not debt)
        }, 0);

        const grouped: Record<string, AnyAccount[]> = {};

        // 1. Group accounts
        accounts.forEach((acc) => {
            const category = CLASS_TO_CATEGORY[acc.constructor.name] || 'Other';
            if (!grouped[category]) grouped[category] = [];
            grouped[category].push(acc);
        });

        // 2. Build Children with Colors
        const categoryChildren = ACCOUNT_CATEGORIES.map((category) => {
            const accountsInCategory = grouped[category] || [];
            if (accountsInCategory.length === 0) return null;

            // Get gradient colors for this specific group of accounts
            const palette = CATEGORY_PALETTES[category];
            const accountColors = getDistributedColors(palette, accountsInCategory.length);
            // Pick a representative color for the Category header (middle of palette)
            const categoryColor = palette[Math.floor(palette.length / 2)];

            return {
                id: category,
                color: tailwindToCssVar(categoryColor), // Parent Color
                isDebt: category === 'Debt',
                children: accountsInCategory.map((acc, i) => ({
                    id: acc.name,
                    value: Math.abs(getAccountValue(acc)),
                    color: tailwindToCssVar(accountColors[i]), // Child Gradient Color
                    // Metadata for tooltip
                    originalAmount: acc.amount,
                    isProperty: acc instanceof PropertyAccount,
                    isDebt: acc instanceof DebtAccount,
                    loanAmount: acc instanceof PropertyAccount ? acc.loanAmount : 0,
                    employerBalance: acc instanceof InvestedAccount ? acc.employerBalance : 0,
                }))
            };
        }).filter(Boolean); // Remove empty categories

        return {
            id: "Net Worth",
            color: "var(--color-chart-money)", // Root node color
            children: categoryChildren,
            netWorth: totalNetWorth,
            totalAssets: totalAssets  // For percentage calculations (avoids issues when debt exists)
        };
    }, [accounts]);

    useEffect(() => {
        localStorage.setItem('account_active_tab', activeTab);
    }, [activeTab]);

    const tabs = ACCOUNT_CATEGORIES;
    useSubTabKeyboardNav(tabs, activeTab, setActiveTab);

    const tabContent: Record<string, React.ReactNode> = {
        Cash: (
            <div className="p-4">
                <AccountList type={SavedAccount} />
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-positive-solid p-4 rounded-xl text-white font-bold mt-4 hover:bg-positive-strong transition-colors"
                >
                    + Add Cash
                </button>
                <AddAccountModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    selectedType={SavedAccount}
                />
            </div>
        ),
        Invested: (
            <div className="p-4">
                <AccountList type={InvestedAccount} />
                <AccountList type={ESPPAccount} />
                <AccountList type={RSUAccount} />
                <div className="flex gap-2 mt-4">
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-positive-solid p-4 rounded-xl text-white font-bold hover:bg-positive-strong transition-colors"
                    >
                        + Add Investment
                    </button>
                    <button
                        onClick={() => setShowESPPModal(true)}
                        className="bg-positive-strong p-4 rounded-xl text-white font-bold hover:bg-positive-solid transition-colors"
                    >
                        + Add ESPP
                    </button>
                    <button
                        onClick={() => setShowRSUModal(true)}
                        className="bg-positive-strong p-4 rounded-xl text-white font-bold hover:bg-positive-solid transition-colors"
                    >
                        + Add RSU
                    </button>
                </div>
                <AddAccountModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    selectedType={InvestedAccount}
                />
                <AddAccountModal
                    isOpen={showESPPModal}
                    onClose={() => setShowESPPModal(false)}
                    selectedType={ESPPAccount}
                />
                <AddAccountModal
                    isOpen={showRSUModal}
                    onClose={() => setShowRSUModal(false)}
                    selectedType={RSUAccount}
                />
            </div>
        ),
        Property: (
            <div className="p-4">
                <AccountList type={PropertyAccount} />
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-positive-solid p-4 rounded-xl text-white font-bold mt-4 hover:bg-positive-strong transition-colors"
                >
                    + Add Property
                </button>
                <AddAccountModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    selectedType={PropertyAccount}
                />
            </div>
        ),
        Debt: (
            <div className="p-4">
                <AccountList type={DebtAccount} />
                <button
                    onClick={() => setIsModalOpen(true)}
                    className="bg-positive-solid p-4 rounded-xl text-white font-bold mt-4 hover:bg-positive-strong transition-colors"
                >
                    + Add Debt
                </button>
                <AddAccountModal
                    isOpen={isModalOpen}
                    onClose={() => setIsModalOpen(false)}
                    selectedType={DebtAccount}
                />
            </div>
        ),
    };

    return (
        <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">

                <Panel className="space-y-4 mb-4">
                    <div className="flex justify-between items-center mb-4 border-b border-border-default pb-2">
                        <h2 className="text-xl font-bold text-white">
                            Account Amounts
                        </h2>
                        <button
                            onClick={() => setShowImportModal(true)}
                            className="text-sm font-semibold text-positive-bright border border-positive-strong/60 rounded-lg px-3 py-1.5 hover:bg-positive-tint/30 transition-colors"
                        >
                            Import balances
                        </button>
                    </div>
                    <ImportBalancesModal
                        isOpen={showImportModal}
                        onClose={() => setShowImportModal(false)}
                    />

                    {accounts.length > 0 && (
                        <ObjectsIcicleChart
                            data={hierarchicalData}
                            valueFormat=">-$0,.0f"
                        />
                    )}
                </Panel>

                <Panel padding="none" className="rounded-lg mb-1 flex overflow-x-auto custom-scrollbar">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            role="tab"
                            aria-selected={activeTab === tab}
                            className={`flex-1 min-w-fit font-semibold px-4 py-3 transition-colors duration-200 whitespace-nowrap ${
                                activeTab === tab
                                    ? "text-positive-bright bg-surface-raised border-b-2 border-positive-bright"
                                    : "text-content-muted hover:bg-surface-raised hover:text-white"
                            }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </Panel>
                <div data-sub-tab-content className="bg-[#09090b] border border-border-subtle rounded-xl min-h-100 mb-4">
                    {tabContent[activeTab]}
                </div>
            </div>
        </div>
    );
}
