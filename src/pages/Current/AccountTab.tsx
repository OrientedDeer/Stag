import React, { useState, useContext, useRef } from "react"; // Added useRef
import { AccountContext, reconstituteAccount } from "../../components/Accounts/AccountContext";
import {
    SavedAccount,
    InvestedAccount,
    PropertyAccount,
    DebtAccount,
    ACCOUNT_CATEGORIES,
} from "../../components/Accounts/models";
import AccountCard from "../../components/Accounts/AccountCard";
import HorizontalBarChart from "../../components/Accounts/HorizontalBarChart";
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import AddAccountModal from "../../components/Accounts/AddAccountModal";
import { TaxContext } from "../../components/Taxes/TaxContext";
import { IncomeContext, reconstituteIncome } from "../../components/Income/IncomeContext";
import { ExpenseContext, reconstituteExpense } from "../../components/Expense/ExpenseContext";

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

const TabsContent = () => {
    // Get export/import functions from context
    const { accounts, amountHistory, dispatch: accountDispatch } = useContext(AccountContext);
    const { incomes, dispatch: incomeDispatch } = useContext(IncomeContext);
    const { expenses, dispatch: expenseDispatch } = useContext(ExpenseContext);
    const taxContext = useContext(TaxContext); // Note: TaxContext returns { state, dispatch }
    const [activeTab, setActiveTab] = useState<string>("Saved");
    const [isModalOpen, setIsModalOpen] = useState(false);
    
    // Ref for the hidden file input
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleGlobalExport = () => {
        const fullBackup = {
            version: 1,
            accounts: accounts.map(a => ({ ...a, className: a.constructor.name })),
            amountHistory,
            incomes: incomes.map(i => ({ ...i, className: i.constructor.name })),
            expenses: expenses.map(e => ({ ...e, className: e.constructor.name })),
            taxSettings: taxContext?.state
        };

        const blob = new Blob([JSON.stringify(fullBackup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stag_full_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
    };

    const handleGlobalImport = (json: string) => {
        try {
            const data = JSON.parse(json);

            // 1. Reconstitute all data using the new resilient helpers
            const newAccounts = data.accounts.map(reconstituteAccount).filter(Boolean);
            const newIncomes = data.incomes.map(reconstituteIncome).filter(Boolean);
            const newExpenses = data.expenses.map(reconstituteExpense).filter(Boolean);

            // 2. Dispatch to all contexts
            accountDispatch({ type: 'SET_BULK_DATA', payload: { accounts: newAccounts, amountHistory: data.amountHistory || {} } });
            incomeDispatch({ type: 'SET_BULK_DATA', payload: { incomes: newIncomes } });
            expenseDispatch({ type: 'SET_BULK_DATA', payload: { expenses: newExpenses } });
            if (data.taxSettings) taxContext?.dispatch({ type: 'SET_BULK_DATA', payload: data.taxSettings });

            alert("Global backup restored successfully!");
        } catch (e) {
            console.error(e);
            alert("Error importing backup. Please check file format.");
        }
    };

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

    const allAccounts = accounts;
    const savedAccounts = accounts.filter((acc) => acc instanceof SavedAccount);
    const investedAccounts = accounts.filter((acc) => acc instanceof InvestedAccount);
    const propertyAccounts = accounts.filter((acc) => acc instanceof PropertyAccount);
    const debtAccounts = accounts.filter((acc) => acc instanceof DebtAccount);

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

    const isSavedVisible = savedAccounts.length > 0 && (investedAccounts.length > 0 || propertyAccounts.length > 0 || debtAccounts.length > 0);
    const isInvestedVisible = investedAccounts.length > 0 && (savedAccounts.length > 0 || propertyAccounts.length > 0 || debtAccounts.length > 0);
    const isPropertyVisible = propertyAccounts.length > 0 && (savedAccounts.length > 0 || investedAccounts.length > 0 || debtAccounts.length > 0);
    const isDebtVisible = debtAccounts.length > 0 && (savedAccounts.length > 0 || investedAccounts.length > 0 || propertyAccounts.length > 0);

    const visibleChartCount = [
        isSavedVisible,
        isInvestedVisible,
        isPropertyVisible,
        isDebtVisible
    ].filter(Boolean).length;
    
    const gridClass = visibleChartCount > 1 ? 'grid-cols-2' : 'grid-cols-1';

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

                    {allAccounts.length > 0 && (
                        <HorizontalBarChart
                            type="Total Net Worth"
                            accountList={allAccounts}
                        />
                    )}
                    {visibleChartCount > 0 && (
                        <div className={`grid ${gridClass} gap-4 pt-2`}>
                            {isSavedVisible && (
                                <HorizontalBarChart
                                    type="Saved Accounts"
                                    accountList={savedAccounts}
                                />
                            )}
                            {isInvestedVisible && (
                                <HorizontalBarChart
                                    type="Investment Accounts"
                                    accountList={investedAccounts}
                                />
                            )}
                            {isPropertyVisible && (
                                <HorizontalBarChart
                                    type="Property Accounts"
                                    accountList={propertyAccounts}
                                />
                            )}
                            {isDebtVisible && (
                                <HorizontalBarChart
                                    type="Debt Accounts"
                                    accountList={debtAccounts}
                                />
                            )}
                        </div>
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
                <div className="bg-[#09090b] border border-gray-800 rounded-xl min-h-[400px] mb-4">
                    {tabContent[activeTab]}
                </div>
            </div>
        </div>
    );
};

export default function AccountTab() {
    return <TabsContent />;
}