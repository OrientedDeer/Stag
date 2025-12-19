import { useState, useContext } from 'react';
import { ExpenseContext } from '../../components/Expense/ExpenseContext';
import { 
    BaseExpense, 
    HousingExpense,
    LoanExpense,
    DependentExpense,
    HealthcareExpense,
    VacationExpense,
    EmergencyExpense,
    OtherExpense
} from '../../components/Expense/models';
import ExpenseCard from '../../components/Expense/ExpenseCard';
import ExpenseHorizontalBarChart from '../../components/Expense/ExpenseHorizontalBarChart';
import AddExpenseModal from '../../components/Expense/AddExpenseModal';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';

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

    // Filtering logic for charts
    const houseingExpenses = expenses.filter(exp => exp instanceof HousingExpense);
    const loanExpenses = expenses.filter(exp => exp instanceof LoanExpense);
    const dependentExpenses = expenses.filter(exp => exp instanceof DependentExpense);
    const healthcareExpenses = expenses.filter(exp => exp instanceof HealthcareExpense);
    const vacationExpenses = expenses.filter(exp => exp instanceof VacationExpense);
    const emergencyExpenses = expenses.filter(exp => exp instanceof EmergencyExpense);
    const otherExpenses = expenses.filter(exp => exp instanceof OtherExpense);

    // Only show sub-charts if both types exist (consistent with your existing logic)
    const showSubCharts = houseingExpenses.length > 0
                           && loanExpenses.length > 0
                           && dependentExpenses.length > 0
                           && healthcareExpenses.length > 0
                           && vacationExpenses.length > 0
                           && emergencyExpenses.length > 0
                           && otherExpenses.length > 0;

    const visibleCharts = [
        { type: "HousingExpense", list: houseingExpenses },
        { type: "LoanExpense", list: loanExpenses },
        { type: "DependentExpense", list: dependentExpenses },
        { type: "HealthcareExpense", list: healthcareExpenses },
        { type: "VacationExpense", list: vacationExpenses },
        { type: "EmergencyExpense", list: emergencyExpenses },
        { type: "OtherExpense", list: otherExpenses }
    ].filter(chart => showSubCharts && chart.list.length > 0);

    const gridClass = visibleCharts.length > 1 ? 'grid-cols-2' : 'grid-cols-1';

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-15/16 max-w-5xl">
                {/* Chart Section */}
                <div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">
                        Expense Breakdown (Monthly Normalized)
                    </h2>
                    
                    {expenses.length > 0 && (
                        <ExpenseHorizontalBarChart 
                            type="Total Monthly Expenses" 
                            expenseList={expenses}
                        />
                    )}

                    {visibleCharts.length > 0 && (
                        <div className={`grid ${gridClass} gap-4 pt-2`}>
                            {visibleCharts.map((chart) => (
                                <ExpenseHorizontalBarChart 
                                    key={chart.type}
                                    type={chart.type} 
                                    expenseList={chart.list}
                                />
                            ))}
                        </div>
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