import { useState, useContext, useMemo } from "react";
import { IncomeContext, IncomeDispatchContext } from "../../components/Objects/Income/IncomeContext";
import { useTodayMilestoneSet } from "../../components/Objects/Assumptions/useTodayMilestoneSet";
import { isIncomeActiveToday } from "../../services/simulation/MilestoneEvaluator";
import {
	type AnyIncome,
	CLASS_TO_CATEGORY,
	CATEGORY_PALETTES,
	INCOME_CATEGORIES,
	hasIncomeEnded,
} from "../../components/Objects/Income/models";
import { ChevronIcon } from "../../components/Layout/Icons/ChevronIcon";
import IncomeCard from "../../components/Objects/Income/IncomeCard";
import {
	DragDropContext,
	Droppable,
	Draggable,
	type DropResult,
} from "@hello-pangea/dnd";
import AddIncomeModal from "../../components/Objects/Income/AddIncomeModal";
import { ObjectsIcicleChart } from "../../components/Charts/ObjectsIcicleChart";
import { tailwindToCssVar, getDistributedColors } from "../../components/Charts/icicleChartHelpers";
import { Panel } from "../../components/Layout/Primitives";

interface IncomeListProps {
	/** Which incomes belong to this list; drag-reorder maps back to master indices. */
	match: (inc: AnyIncome) => boolean;
	title?: string;        // header label (collapsible sections)
	collapsible?: boolean; // render header as a toggle, body collapsed by default
	dimmed?: boolean;      // visually de-emphasize cards (past/ended incomes)
}

// Mirrors ExpenseTab's ExpenseList: one master list in context, each section
// filters it and maps drag indices back through the original positions.
const IncomeList = ({ match, title, collapsible = false, dimmed = false }: IncomeListProps) => {
	const { incomes } = useContext(IncomeContext);
	const dispatch = useContext(IncomeDispatchContext);
	const [open, setOpen] = useState(!collapsible);

	const listIncomes = incomes
		.map((inc, index) => ({ inc, originalIndex: index }))
		.filter(({ inc }) => match(inc));

	const onDragEnd = (result: DropResult) => {
		if (!result.destination) return;

		dispatch({
			type: "REORDER_INCOMES",
			payload: {
				startIndex: listIncomes[result.source.index].originalIndex,
				endIndex: listIncomes[result.destination.index].originalIndex,
			},
		});
	};

	if (listIncomes.length === 0) return null;

	const header = collapsible ? (
		<button
			type="button"
			onClick={() => setOpen((v) => !v)}
			className="flex items-center gap-2 text-content-muted hover:text-white text-xs font-bold uppercase tracking-widest mb-3 transition-colors"
		>
			<ChevronIcon expanded={false} className={open ? '' : '-rotate-90'} />
			{open ? 'Hide' : 'Show'} {title} <span className="text-content-faint">· {listIncomes.length}</span>
		</button>
	) : null;

	return (
		<div className={collapsible ? 'mt-6' : ''}>
		{header}
		{open && (
		<div className={dimmed ? 'opacity-60' : ''}>
		<DragDropContext onDragEnd={onDragEnd}>
			<Droppable droppableId={`income-list-${title ?? 'main'}`}>
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
		</div>
		)}
		</div>
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
	//
	// Everything comes from the SINGLE hook call (finding 10), so the derivation runs
	// once. isIncomeMilestoneGateUnresolved is the PER-INCOME fallback (findings 1/2/3):
	// on a fresh session (no projection cached) an income gated on a sim-dependent
	// (relative) milestone that already fired can't be confirmed from the empty timeline.
	// isIncomeActiveToday and PriorityTab's gate now share the SAME milestone resolver
	// (isMilestoneActiveToday, re-review finding 1), so both honor a resolvable absolute
	// END that has already fired and default only the genuinely sim-bound side — they
	// can't disagree on an ended income. milestonesById lets that shared resolver classify
	// each referenced milestone's kind, so we thread it through here too (was previously
	// passed only on the Priority path, which made the two surfaces diverge).
	const { todayMilestoneSet, isIncomeMilestoneGateUnresolved, milestonesById } = useTodayMilestoneSet();

	// Data wrangling for icicle chart
	const hierarchicalData = useMemo(() => {
		const grouped: Record<string, AnyIncome[]> = {};

		// 1. Group incomes (only those active TODAY — fixed-date window AND milestone)
		incomes
			.filter(inc => isIncomeActiveToday(inc, todayMilestoneSet, isIncomeMilestoneGateUnresolved(inc), milestonesById))
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
	}, [incomes, todayMilestoneSet, isIncomeMilestoneGateUnresolved, milestonesById]);

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

				{/* Single List Section (ended incomes live in the collapsed section below) */}
				<div className="p-4">
					<IncomeList match={(inc) => !hasIncomeEnded(inc)} />

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

					{/* Past (ended) incomes — fixed end date in a past month, collapsed by
					    default; milestone-ended incomes aren't cheaply resolvable and stay
					    in the main list (same rule as the "ended YYYY" card hint). */}
					<IncomeList
						title="past incomes"
						match={hasIncomeEnded}
						collapsible
						dimmed
					/>
				</div>
			</div>
		</div>
	);
};

export default function IncomeTab() {
	return <TabsContent />;
}
