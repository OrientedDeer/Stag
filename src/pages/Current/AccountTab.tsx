import React, { useState, useContext } from "react";
import { AccountContext } from "../../components/Accounts/AccountContext";
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

const AccountList = ({ type }: { type: any }) => {
	const { accounts, dispatch } = useContext(AccountContext);
	
	// Map to track original index for the global state update
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
						className="flex flex-col" // Horizontal padding for handle gutter
					>
						{filteredAccounts.map(({ acc }, index) => (
							<Draggable key={acc.id} draggableId={acc.id} index={index}>
								{(provided, snapshot) => (
									<div
										ref={provided.innerRef}
										{...provided.draggableProps}
										// pb-6 ensures consistent spacing and correct placeholder height
										className={`relative group pb-6 ${snapshot.isDragging ? 'z-50' : ''}`}
									>
										{/* Drag Handle inside the gutter */}
										<div 
											{...provided.dragHandleProps}
											className="absolute -left-3 top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-2 text-green-200"
										>
											⋮⋮
										</div>
										<div className="ml-4"> {/* Card offset */}
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
	const { accounts } = useContext(AccountContext);
	const [activeTab, setActiveTab] = useState<string>("Saved");
    const [isModalOpen, setIsModalOpen] = useState(false);

	const allAccounts = accounts;
	const savedAccounts = accounts.filter((acc) => acc instanceof SavedAccount);
	const investedAccounts = accounts.filter(
		(acc) => acc instanceof InvestedAccount
	);
	const propertyAccounts = accounts.filter(
		(acc) => acc instanceof PropertyAccount
	);
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
			<div className="w-15/16 max-w-5xl">
				
				<div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
					<h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">
                        Account Amounts
                    </h2>
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
