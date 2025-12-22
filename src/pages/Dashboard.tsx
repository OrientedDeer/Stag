import { useContext } from 'react';
import { IncomeContext } from '../components/Income/IncomeContext';
import { ExpenseContext } from '../components/Expense/ExpenseContext';
import { TaxContext } from '../components/Taxes/TaxContext';
import { SankeyChart } from '../components/Charts/SankeyChart';
import { NetWorthCard } from '../components/Charts/Networth';

export default function Dashboard() {
  const incomeCtx = useContext(IncomeContext);
  const expenseCtx = useContext(ExpenseContext);
  const taxCtx = useContext(TaxContext);

  // Guard clause if contexts aren't ready
  if (!incomeCtx || !expenseCtx || !taxCtx) return null;

  return (
    <div className='w-full min-h-full flex bg-gray-950 justify-center pt-6'>
			<div className="w-full px-8 max-w-screen-2xl">
        <div className="flex flex-col gap-4 p-4 max-w-screen-2xl mx-auto w-full">
          <div className="flex justify-between items-end border-b border-gray-800 pb-4">
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Flow Chart - Spans 2 cols on large screens */}
            <div className="lg:col-span-2 bg-[#18181b] rounded-2xl border border-gray-800 p-6 shadow-xl">
              <h2 className="text-xl font-bold text-gray-200 mb-6">Yearly Cash Flow</h2>
              <div>
                {incomeCtx.incomes.length > 0 && (
                  <SankeyChart 
                    incomes={incomeCtx.incomes} 
                    expenses={expenseCtx.expenses}
                    taxState={taxCtx.state}
                  />
                )}
                {incomeCtx.incomes.length == 0 && (
                  <div className='h-full flex-col-1 m-50   text-white text-2xl justify-center justify-items-center'>
                    <div>
                      Enter some income for 
                    </div>
                    <div>
                      the chart to load.
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            <div>
              <NetWorthCard/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}