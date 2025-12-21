import { useContext } from 'react';
import { IncomeContext } from '../components/Income/IncomeContext';
import { ExpenseContext } from '../components/Expense/ExpenseContext';
import { TaxContext } from '../components/Taxes/TaxContext';

export default function Dashboard() {
  const incomeCtx = useContext(IncomeContext);
  const expenseCtx = useContext(ExpenseContext);
  const taxCtx = useContext(TaxContext);

  // Guard clause if contexts aren't ready
  if (!incomeCtx || !expenseCtx || !taxCtx) return null;

  return (
    <div className='w-full min-h-full flex bg-gray-950 p-4 text-white'>
			<div className="flex flex-col">
        <h1 className="text-2xl">Dashboard</h1>
    </div>
    </div>
  );
}