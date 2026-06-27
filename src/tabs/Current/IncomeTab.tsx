import { useState, useContext, useMemo } from "react";
import { IncomeContext, IncomeDispatchContext } from "../../components/Objects/Income/IncomeContext";
import { useTodayMilestoneSet } from "../../components/Objects/Assumptions/useTodayMilestoneSet";
import { isIncomeActiveToday } from "../../services/simulation/MilestoneEvaluator";
import {
	AnyIncome,
	CLASS_TO_CATEGORY,
	CATEGORY_PALETTES,
	INCOME_CATEGORIES,
} from "../../components/Objects/Income/models";
import IncomeCard from "../../components/Objects/Income/IncomeCard";
import {
	DragDropContext,
	Droppable,
	Draggable,
	DropResult,
} from "@hello-pangea/dnd";
import AddIncomeModal from "../../components/Objects/Income/AddIncomeModal";
import { ObjectsIcicleChart, tailwindToCssVar, getDistributedColors } from "../../components/Charts/ObjectsIcicleChart";
import { Panel } from "../../components/Layout/Primitives";

// Updated IncomeList to handle the base class or specific filtering
const IncomeList = () => {
	const { incomes } = useContext(IncomeContext);
	const dispatch = useContext(IncomeDispatchContext);

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

	// #152: the icicle below shows only income active right now. The fixed
	// start/end-date gate alone is milestone-BLIND and would count a
	// milestone-started income (no fixed start date) before its milestone fires —
	// the same gap #145 fixed on the Allocation tab. todayMilestoneSet (shared with
	// PriorityTab) is the set of milestones reached as of today; isIncomeActiveToday
	// AND-s it with the fixed-date window.
	const todayMilestoneSet = useTodayMilestoneSet();

	// Data wrangling for icicle chart
	const hierarchicalData = useMemo(() => {
		const grouped: Record<string, AnyIncome[]> = {};

		// 1. Group incomes (only those active TODAY — fixed-date window AND milestone)
		incomes
			.filter(inc => isIncomeActiveToday(inc, todayMilestoneSet))
			.forEach((inc) => {
				const category = CLASS_TO_CATEGORY[inc.constructor.name] || 'Other';
				if (!grouped[category]) grouped[category] = [];
				grouped[category].push(inc);
			});

		// 2. Build Children with Colors
		const categoryChildren = INCOME_CATEGORIES.map((category) => {
			const incomesInCategory = grouped[category] || [];
			if (incomesInCategory.length === 0) return null;

			// Get gradient colors for this specific group of incomes
			const palette = CATEGORY_PALETTES[category];
			const incomeColors = getDistributedColors(palette, incomesInCategory.length);
			// Pick a representative color for the Category header (middle of palette)
			const categoryColor = palette[Math.floor(palette.length / 2)];

			return {
				id: category,
				color: tailwindToCssVar(categoryColor), // Parent Color
				children: incomesInCategory.map((inc, i) => ({
					id: inc.name,
					value: inc.getMonthlyAmount(),
					color: tailwindToCssVar(incomeColors[i]), // Child Gradient Color
					// Metadata
					originalAmount: inc.amount,
					frequency: inc.frequency
				}))
			};
		}).filter(Boolean); // Remove empty categories

		return {
			id: "Total Incomes",
			color: "var(--color-chart-money)", // Root node color
			children: categoryChildren
		};
	}, [incomes, todayMilestoneSet]);

	return (
		<div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24">
			<div className="w-full px-4 sm:px-8 max-w-screen-2xl">
				{/* Chart Section */}
				<Panel className="space-y-4 mb-4">
					<h2 className="text-xl font-bold text-white mb-4 border-b border-border-default pb-2">
						Income Breakdown
					</h2>
					{incomes.length > 0 && (
						<ObjectsIcicleChart
							data={hierarchicalData}
							valueFormat=">+$0,.0f"
						/>
					)}
				</Panel>

				{/* Single List Section */}
				<div className="p-4">
					<IncomeList />

					<button
						onClick={() => setIsModalOpen(true)}
						className="bg-positive-solid p-4 rounded-xl text-white font-bold mt-4 hover:bg-positive-strong transition-colors"
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
