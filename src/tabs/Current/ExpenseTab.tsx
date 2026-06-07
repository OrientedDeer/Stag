import { useState, useContext, useMemo, useEffect } from 'react';
import { useSubTabKeyboardNav } from '../../hooks/useKeyboardShortcuts';
import { ExpenseContext, ExpenseDispatchContext } from '../../components/Objects/Expense/ExpenseContext';
import {
    AnyExpense,
    ExpenseFrequency,
    LoanExpense,
    CLASS_TO_CATEGORY,
    CATEGORY_PALETTES,
    EXPENSE_CATEGORIES,
    isExpenseActiveInCurrentMonth,
    isExpenseDone,
    isLongTermGoal
} from '../../components/Objects/Expense/models';
import ExpenseCard from '../../components/Objects/Expense/ExpenseCard';
import AddExpenseModal from '../../components/Objects/Expense/AddExpenseModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { ObjectsIcicleChart, tailwindToCssVar, getDistributedColors } from '../../components/Charts/ObjectsIcicleChart';
import { Panel } from "../../components/Layout/Primitives";

// Cadence sub-tabs for the expense list, mirroring the Accounts page. Weekly +
// Monthly roll up into "Monthly"; "Annually" expenses form "Annual". "Longer
// term" (multi-year goals) arrives in a later phase. `defaultFrequency` pre-sets
// the Add Expense modal so a new expense lands on the tab you're viewing.
const CADENCE_TABS: { label: string; defaultFrequency: ExpenseFrequency; goal?: boolean; match: (exp: AnyExpense) => boolean }[] = [
  { label: 'Monthly', defaultFrequency: 'Monthly', match: (exp) => !isLongTermGoal(exp) && exp.frequency !== 'Annually' },
  { label: 'Annual', defaultFrequency: 'Annually', match: (exp) => !isLongTermGoal(exp) && exp.frequency === 'Annually' },
  { label: 'Longer term', defaultFrequency: 'Monthly', goal: true, match: (exp) => isLongTermGoal(exp) },
];

interface ExpenseListProps {
  title: string;
  match: (exp: AnyExpense) => boolean;
  collapsible?: boolean; // render header as a toggle, body collapsed by default
  dimmed?: boolean;      // visually de-emphasize cards (used for past/done expenses)
}

const ExpenseList = ({ title, match, collapsible = false, dimmed = false }: ExpenseListProps) => {
  const { expenses } = useContext(ExpenseContext);
  const dispatch = useContext(ExpenseDispatchContext);
  const [open, setOpen] = useState(!collapsible);

  // Track original index to update the master list correctly
  const filteredExpenses = expenses
    .map((exp, index) => ({ exp, originalIndex: index }))
    .filter(({ exp }) => match(exp));

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;

    // Map the local filtered index back to the global index in the context
    const sourceIndex = filteredExpenses[result.source.index].originalIndex;
    const destinationIndex = filteredExpenses[result.destination.index].originalIndex;

    dispatch({
      type: 'REORDER_EXPENSES',
      payload: { startIndex: sourceIndex, endIndex: destinationIndex }
    });
  };

  if (filteredExpenses.length === 0) return null;

  // Inside a cadence tab the title is redundant with the tab label, so an empty
  // title renders no header. The collapsible "past" section always shows its toggle.
  const header = collapsible ? (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      className="flex items-center gap-2 text-content-muted hover:text-white text-xs font-bold uppercase tracking-widest mb-3 transition-colors"
    >
      <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
      {open ? 'Hide' : 'Show'} {title} <span className="text-content-faint">· {filteredExpenses.length}</span>
    </button>
  ) : title ? (
    <h3 className="text-content-muted text-xs font-bold uppercase tracking-widest mb-3">
      {title} <span className="text-content-faint">· {filteredExpenses.length}</span>
    </h3>
  ) : null;

  return (
    <div className="mb-6">
      {header}
      {open && (
        <div className={dimmed ? 'opacity-60' : ''}>
          <DragDropContext onDragEnd={onDragEnd}>
            <Droppable droppableId={`expenses-list-${title}`}>
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="flex flex-col" // Added horizontal padding for handle gutter
                >
                  {filteredExpenses.map(({ exp }, index) => (
                    <Draggable key={exp.id} draggableId={exp.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`relative group pb-6 ${snapshot.isDragging ? 'z-50' : ''}`}
                        >
                          {/* Drag Handle inside the gutter */}
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
                            <ExpenseCard expense={exp} />
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
    const { expenses } = useContext(ExpenseContext);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const tabs = CADENCE_TABS.map((t) => t.label);
    const [activeTab, setActiveTab] = useState<string>(() => {
        const saved = localStorage.getItem('expense_active_tab');
        return saved && tabs.includes(saved) ? saved : tabs[0];
    });
    useEffect(() => {
        localStorage.setItem('expense_active_tab', activeTab);
    }, [activeTab]);
    useSubTabKeyboardNav(tabs, activeTab, setActiveTab);

    const activeTabDef = CADENCE_TABS.find((t) => t.label === activeTab) ?? CADENCE_TABS[0];

    // Data wrangling for icicle chart
    const hierarchicalData = useMemo(() => {
        const grouped: Record<string, AnyExpense[]> = {};

        // 1. Group expenses (only active ones)
        expenses
            .filter(isExpenseActiveInCurrentMonth)
            .forEach((exp) => {
                const category = CLASS_TO_CATEGORY[exp.constructor.name] || 'Other';
                if (!grouped[category]) grouped[category] = [];
                grouped[category].push(exp);
            });

        // 2. Build Children with Colors
        const categoryChildren = EXPENSE_CATEGORIES.map((category) => {
            const expensesInCategory = grouped[category] || [];
            if (expensesInCategory.length === 0) return null;

            // Get gradient colors for this specific group of expenses
            const palette = CATEGORY_PALETTES[category];
            const expenseColors = getDistributedColors(palette, expensesInCategory.length);
            // Pick a representative color for the Category header (middle of palette)
            const categoryColor = palette[Math.floor(palette.length / 2)];

            return {
                id: category,
                color: tailwindToCssVar(categoryColor), // Parent Color
                children: expensesInCategory.map((exp, i) => ({
                    id: exp.name,
                    value: exp.getMonthlyAmount(),
                    color: tailwindToCssVar(expenseColors[i]), // Child Gradient Color
                    // Metadata
                    originalAmount: exp instanceof LoanExpense ? exp.payment : exp.amount,
                    frequency: exp.frequency
                }))
            };
        }).filter(Boolean); // Remove empty categories

        return {
            id: "Total Expenses",
            color: "var(--c-negative-soft)", // Root node color
            children: categoryChildren
        };
    }, [expenses]);

    return (
        <div className="w-full min-h-full flex bg-surface-base justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                {/* Chart Section */}
                <Panel className="space-y-4 mb-4">
                    <h2 className="text-xl font-bold text-white mb-4 border-b border-border-default pb-2">
                        Expense Breakdown
                    </h2>
                    
                    {expenses.length > 0 && (
                        <ObjectsIcicleChart
                            data={hierarchicalData}
                            valueFormat=">-$0,.0f"
                        />
                    )}
                </Panel>

                {/* Cadence sub-tabs (mirrors the Accounts page) */}
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

                {/* Active tab: that cadence's expenses (done ones excluded) */}
                <div data-sub-tab-content className="bg-surface-base border border-border-subtle rounded-xl min-h-100 mb-4">
                    <div className="p-4">
                        <ExpenseList
                            title=""
                            match={(exp) => activeTabDef.match(exp) && !isExpenseDone(exp)}
                        />

                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-positive-solid p-4 rounded-xl text-white font-bold mt-4 hover:bg-positive-strong transition-colors"
                        >
                            {activeTabDef.goal ? '+ Add Goal' : '+ Add Expense'}
                        </button>

                        {/* key forces a remount when the tab changes so the modal
                            re-initializes its form with the new default frequency/mode */}
                        <AddExpenseModal
                            key={activeTab}
                            isOpen={isModalOpen}
                            onClose={() => setIsModalOpen(false)}
                            defaultFrequency={activeTabDef.defaultFrequency}
                            goalMode={activeTabDef.goal}
                        />
                    </div>
                </div>

                {/* Past (done) expenses — shared across cadences, collapsed by default */}
                <div className="px-4">
                    <ExpenseList
                        title="past expenses"
                        match={isExpenseDone}
                        collapsible
                        dimmed
                    />
                </div>
            </div>
        </div>
    );
}

export default function ExpenseTab() {
  return <TabsContent />;
}