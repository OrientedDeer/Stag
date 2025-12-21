import { useState, useContext } from "react";
import { IncomeContext } from "../../components/Income/IncomeContext";
import {
	WorkIncome,
	SocialSecurityIncome,
	PassiveIncome,
	WindfallIncome,
} from "../../components/Income/models";
import IncomeCard from "../../components/Income/IncomeCard";
import IncomeHorizontalBarChart from "../../components/Income/IncomeHorizontalBarChart";
import {
	DragDropContext,
	Droppable,
	Draggable,
	DropResult,
} from "@hello-pangea/dnd";
import AddIncomeModal from "../../components/Income/AddIncomeModal";

// Updated IncomeList to handle the base class or specific filtering
const IncomeList = () => {
	const { incomes, dispatch } = useContext(IncomeContext);

	// We don't filter by type anymore so it shows everything in one list
	const listIncomes = incomes.map((inc, index) => ({
		inc,
		originalIndex: index,
	}));

	const onDragEnd = (result: DropResult) => {
		if (!result.destination) return;

		dispatch({
			type: "REORDER_INCOMES",
			payload: {
				startIndex: result.source.index,
				endIndex: result.destination.index,
			},
		});
	};

	if (incomes.length === 0) return null;

	return (
		<DragDropContext onDragEnd={onDragEnd}>
			<Droppable droppableId="income-list">
				{(provided) => (
					<div
						{...provided.droppableProps}
						ref={provided.innerRef}
						className="flex flex-col"
					>
						{listIncomes.map(({ inc }, index) => (
							<Draggable key={inc.id} draggableId={inc.id} index={index}>
								{(provided, snapshot) => (
									<div
										ref={provided.innerRef}
										{...provided.draggableProps}
										className={`relative group pb-6 ${
											snapshot.isDragging ? "z-50" : ""
										}`}
									>
										<div
											{...provided.dragHandleProps}
											className="absolute -left-3 top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-2 text-green-200"
										>
											⋮⋮
										</div>
										<div className="ml-4">
											<IncomeCard income={inc} />
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
	const { incomes } = useContext(IncomeContext);
	const [isModalOpen, setIsModalOpen] = useState(false);

	// Keep individual filters only for the charts
	const workIncomes = incomes.filter((inc) => inc instanceof WorkIncome);
	const ssIncomes = incomes.filter(
		(inc) => inc instanceof SocialSecurityIncome
	);
	const passiveIncomes = incomes.filter((inc) => inc instanceof PassiveIncome);
	const windfallIncomes = incomes.filter(
		(inc) => inc instanceof WindfallIncome
	);

	const visibleCharts = [
		{ type: "Work", list: workIncomes },
		{ type: "Social Security", list: ssIncomes },
		{ type: "Passive", list: passiveIncomes },
		{ type: "Windfall", list: windfallIncomes },
	].filter((item) => item.list.length > 0 && incomes.length > item.list.length);

	const gridClass = visibleCharts.length > 1 ? "grid-cols-2" : "grid-cols-1";

	return (
		<div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
			<div className="w-full px-8 max-w-screen-2xl">
				{/* Chart Section */}
				<div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
					<h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">
						Income Breakdown
					</h2>
					{incomes.length > 0 && (
						<IncomeHorizontalBarChart
							type="Total Monthly Income"
							incomeList={incomes}
						/>
					)}
					{visibleCharts.length > 0 && (
						<div className={`grid ${gridClass} gap-4 pt-2`}>
							{visibleCharts.map((chart) => (
								<IncomeHorizontalBarChart
									key={chart.type}
									type={chart.type}
									incomeList={chart.list}
								/>
							))}
						</div>
					)}
				</div>

				{/* Single List Section */}
				<div className="p-4">
					<IncomeList />

					<button
						onClick={() => setIsModalOpen(true)}
						className="bg-green-600 p-4 rounded-xl text-white font-bold mt-4 hover:bg-green-700 transition-colors"
					>
						+ Add Income
					</button>

					<AddIncomeModal
						isOpen={isModalOpen}
						onClose={() => setIsModalOpen(false)}
					/>
				</div>
			</div>
		</div>
	);
};

export default function IncomeTab() {
	return <TabsContent />;
}
