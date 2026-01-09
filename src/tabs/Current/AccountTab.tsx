import React, { useState, useContext, useRef, useEffect, useMemo } from "react"; // Added useRef, useMemo
import { AccountContext } from "../../components/Objects/Accounts/AccountContext";
import {
    SavedAccount,
    InvestedAccount,
    PropertyAccount,
    DebtAccount,
    ACCOUNT_CATEGORIES,
    AnyAccount,
    CLASS_TO_CATEGORY,
    CATEGORY_PALETTES,
} from "../../components/Objects/Accounts/models";
import AccountCard from "../../components/Objects/Accounts/AccountCard";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import AddAccountModal from "../../components/Objects/Accounts/AddAccountModal";
import { ObjectsIcicleChart, tailwindToCssVar, getDistributedColors } from "../../components/Charts/ObjectsIcicleChart";
import { useFileManager } from "../../components/Objects/Accounts/useFileManager";

const AccountList = ({ type }: { type: any }) => {
    const { accounts, dispatch } = useContext(AccountContext);
    
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
                                            className="absolute -left-3 top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-2 text-green-200"
                                        >
                                            ⋮⋮
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
        return account.amount - account.employerBalance;
    }
    if (account instanceof DebtAccount) {
        return -account.amount;
    }
    return account.amount;
};

const TabsContent = () => {
    const { accounts } = useContext(AccountContext);
    const { handleGlobalExport, handleGlobalImport } = useFileManager();
    const [activeTab, setActiveTab] = useState<string>(() => {
        return localStorage.getItem('account_active_tab') || 'Saved';
    });
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Ref for the hidden file input
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Data wrangling for icicle chart
    const hierarchicalData = useMemo(() => {
        // Calculate real Net Worth (subtracting debts)
        const totalNetWorth = accounts.reduce((sum, acc) => sum + getAccountValue(acc), 0);

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
            // Pick a representative color for the Category header (approx middle of palette)
            const categoryColor = palette[50] || palette[Math.floor(palette.length/2)];

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
            color: "#10b981", // Root node color
            children: categoryChildren,
            netWorth: totalNetWorth
        };
    }, [accounts]);

    useEffect(() => {
        localStorage.setItem('account_active_tab', activeTab);
    }, [activeTab]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        
        // This is where the conversion happens from "File" to "String"
        reader.onload = (event) => {
            const result = event.target?.result;
            if (typeof result === 'string') {
                // NOW we call importData with the string it expects
                handleGlobalImport(result);
            }
        };

        reader.readAsText(file);

        // Reset the input value so you can import the same file again if needed
        e.target.value = ''; 
    };

    const tabs = ACCOUNT_CATEGORIES;

    const tabContent: Record<string, React.ReactNode> = {
        Saved: (
            <div className="p-4">
                <AccountList type={SavedAccount} />
                <button 
                    onClick={() => setIsModalOpen(true)}
                    className="bg-green-600 p-4 rounded-xl text-white font-bold mt-4 hover:bg-green-700 transition-colors"
                >
                    + Add Savings
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
                <button 
                    onClick={() => setIsModalOpen(true)}
                    className="bg-green-600 p-4 rounded-xl text-white font-bold mt-4 hover:bg-green-700 transition-colors"
                >
                    + Add Investment
                </button>
                <AddAccountModal
                    isOpen={isModalOpen} 
                    onClose={() => setIsModalOpen(false)} 
                    selectedType={InvestedAccount}
                />
            </div>
        ),
        Property: (
            <div className="p-4">
                <AccountList type={PropertyAccount} />
                <button 
                    onClick={() => setIsModalOpen(true)}
                    className="bg-green-600 p-4 rounded-xl text-white font-bold mt-4 hover:bg-green-700 transition-colors"
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
                    className="bg-green-600 p-4 rounded-xl text-white font-bold mt-4 hover:bg-green-700 transition-colors"
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
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-full px-8 max-w-screen-2xl">
                
                <div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
                    {/* Header with Export/Import Buttons */}
                    <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-2">
                        <h2 className="text-xl font-bold text-white">
                            Account Amounts
                        </h2>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleGlobalExport}
                                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 text-xs font-medium transition-colors"
                            >
                                Export Backup
                            </button>
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 text-xs font-medium transition-colors"
                            >
                                Import Backup
                            </button>
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                onChange={handleFileChange} 
                                accept=".json" 
                                className="hidden" 
                            />
                        </div>
                    </div>

                    {accounts.length > 0 && (
                        <ObjectsIcicleChart
                            data={hierarchicalData}
                            valueFormat=">-$0,.0f"
                        />
                    )}
                </div>

                <div className="bg-gray-900 rounded-lg overflow-hidden mb-1 flex border border-gray-800">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 font-semibold p-3 transition-colors duration-200 ${
                                activeTab === tab
                                    ? "text-green-300 bg-gray-900 border-b-2 border-green-300"
                                    : "text-gray-400 hover:bg-gray-900 hover:text-white"
                            }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <div className="bg-[#09090b] border border-gray-800 rounded-xl min-h-100 mb-4">
                    {tabContent[activeTab]}
                </div>
            </div>
        </div>
    );
};

export default function AccountTab() {
    return <TabsContent />;
}