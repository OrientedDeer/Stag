import { useState, useContext, useMemo } from 'react';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import {
    BaseExpense,
    AnyExpense,
    LoanExpense,
    CLASS_TO_CATEGORY,
    CATEGORY_PALETTES,
    EXPENSE_CATEGORIES,
    isExpenseActiveInCurrentMonth
} from '../../components/Objects/Expense/models';
import ExpenseCard from '../../components/Objects/Expense/ExpenseCard';
import AddExpenseModal from '../../components/Objects/Expense/AddExpenseModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { ObjectsIcicleChart, tailwindToCssVar, getDistributedColors } from '../../components/Charts/ObjectsIcicleChart';

const ExpenseList = ({ type }: { type: any }) => {
  const { expenses, dispatch } = useContext(ExpenseContext);
  
  // Track original index to update the master list correctly
  const filteredExpenses = expenses
    .map((exp, index) => ({ exp, originalIndex: index }))
    .filter(({ exp }) => exp instanceof type);

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

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <Droppable droppableId="expenses-list">
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
                      className="absolute -left-3 top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing p-2 text-green-200"
                    >
                      ⋮⋮
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
  );
};

const TabsContent = () => {
    const { expenses } = useContext(ExpenseContext);
    const [isModalOpen, setIsModalOpen] = useState(false);

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
            // Pick a representative color for the Category header (approx middle of palette)
            const categoryColor = palette[50] || palette[Math.floor(palette.length/2)];

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
            color: "#ef4444", // Root node color
            children: categoryChildren
        };
    }, [expenses]);

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6 pb-24">
            <div className="w-full px-4 sm:px-8 max-w-screen-2xl">
                {/* Chart Section */}
                <div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">
                        Expense Breakdown
                    </h2>
                    
                    {expenses.length > 0 && (
                        <ObjectsIcicleChart
                            data={hierarchicalData}
                            valueFormat=">-$0,.0f"
                        />
                    )}
                </div>

                {/* List Section */}
                <div className="p-4">
                    <ExpenseList type={BaseExpense} />
                    
                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="bg-green-600 p-4 rounded-xl text-white font-bold mt-4 hover:bg-green-700 transition-colors"
                    >
                        + Add Expense
                    </button>

                    <AddExpenseModal 
                        isOpen={isModalOpen} 
                        onClose={() => setIsModalOpen(false)} 
                    />
                </div>
            </div>
        </div>
    );
}

export default function ExpenseTab() {
  return <TabsContent />;
}