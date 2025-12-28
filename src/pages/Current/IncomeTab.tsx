import { useState, useContext } from "react";
import { IncomeContext } from "../../components/Income/IncomeContext";
import IncomeCard from "../../components/Income/IncomeCard";
import {
	DragDropContext,
	Droppable,
	Draggable,
	DropResult,
} from "@hello-pangea/dnd";
import AddIncomeModal from "../../components/Income/AddIncomeModal";
import IncomeIcicleChart from "../../components/Income/IncomeIcicleChart";

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

	return (
		<div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
			<div className="w-full px-8 max-w-screen-2xl">
				{/* Chart Section */}
				<div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
					<h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">
						Income Breakdown
					</h2>
					{incomes.length > 0 && (
						<IncomeIcicleChart incomeList= {incomes}
						/>
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
