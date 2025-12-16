import React, { useState, useContext } from 'react';
import { ExpenseContext } from '../../components/Expense/ExpenseContext';
import { 
  DefaultExpense,
  SecondaryExpense,
  EXPENSE_CATEGORIES
} from '../../components/Expense/models';
import ExpenseCard from '../../components/Expense/ExpenseCard';
import ExpenseHorizontalBarChart from '../../components/Expense/ExpenseHorizontalBarChart';
import AddExpenseControl from '../../components/Expense/AddExpenseUI';

const ExpenseList = ({ type }: { type: any }) => {
  const { expenses } = useContext(ExpenseContext);
  const filteredExpenses = expenses.filter((exp) =>exp instanceof type);

  if (filteredExpenses.length === 0) {
    return null;
  }

  return (
    <div className="space-y-6">
      {filteredExpenses.map((expense) => (
        <ExpenseCard key={`${expense.id}-${expense.constructor.name}`} expense={expense} />
      ))}
    </div>
  );
};

const TabsContent = () => {
    const { expenses } = useContext(ExpenseContext);
    const [activeTab, setActiveTab] = useState<string>('DefaultExpense');

    const allExpenses = expenses; 
    const defaultExpense = expenses.filter(exp => exp instanceof DefaultExpense);
    const secondaryExpense = expenses.filter(exp => exp instanceof SecondaryExpense);

    const tabs = EXPENSE_CATEGORIES;

    const tabContent: Record<string, React.ReactNode> = {
        Default: (
            <div className="p-4">
                <ExpenseList type={DefaultExpense} />
                <AddExpenseControl 
                    ExpenseClass={DefaultExpense} 
                    title="DefaultExpense" 
                    defaultArgs={['']}
                />
            </div>
        ),
        Secondary: (
            <div className="p-4">
                <ExpenseList type={SecondaryExpense} />
                <AddExpenseControl 
                    ExpenseClass={SecondaryExpense} 
                    title="SecondaryExpense" 
                    defaultArgs={['']}
                />
            </div>
        ),
    };

    return (
        <div className="w-full min-h-full flex bg-gray-950 justify-center pt-6">
            <div className="w-15/16 max-w-5xl">
                <div className="space-y-4 mb-4 p-4 bg-gray-900 rounded-xl border border-gray-800">
                    <h2 className="text-xl font-bold text-white mb-4 border-b border-gray-700 pb-2">Expense Breakdown (Monthly Normalized)</h2>
                    <ExpenseHorizontalBarChart 
                        type="Total Monthly Expenses" 
                        expenseList={allExpenses}
                    />
                    <div className="grid grid-cols-2 gap-4 pt-2">
                        <ExpenseHorizontalBarChart 
                            type="DefaultExpense" 
                            expenseList={defaultExpense}
                        />
                        <ExpenseHorizontalBarChart 
                            type="SecondaryExpense" 
                            expenseList={secondaryExpense}
                        />
                    </div>
                </div>
                <div className="bg-gray-900 rounded-lg overflow-hidden mb-1 flex border border-gray-800 flex-wrap">
                    {tabs.map((tab) => (
                        <button
                            key={tab}
                            className={`flex-1 min-w-[100px] font-semibold p-3 transition-colors duration-200 ${
                                activeTab === tab
                                    ? 'text-green-300 bg-gray-900 border-b-2 border-green-300'
                                    : 'text-gray-400 hover:bg-gray-900 hover:text-white'
                            }`}
                            onClick={() => setActiveTab(tab)}
                        >
                            {tab === 'SecondaryExpense' ? 'Secondary' : tab}
                        </button>
                    ))}
                </div>
                <div className="bg-[#09090b] border border-gray-800 rounded-xl min-h-[400px] mb-4">
                    {tabContent[activeTab]}
                </div>

            </div>
        </div>
    );
}

export default function ExpenseTab() {
  return (
    <TabsContent />
  );
}