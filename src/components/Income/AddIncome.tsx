import { Income, INCOME_TYPES, INCOME_COLORS_BACKGROUND, INCOME_COLORS_TEXT} from '../../types';
import { useIncomes } from '../../context/IncomeTypesContext';
import { useState} from 'react';

type AddIncomeProps = {
  type: Income['type'];
};

export default function AddIncome({type}: AddIncomeProps) {

    const {addIncome} = useIncomes();
    const [name, setName] = useState('');
    const [amount, setAmount] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        var temp = new Date()
        temp.setHours(0, 0, 0, 0)
        e.preventDefault();
        if (!name || !amount) return;
        const newIncome: Income = {
          id: crypto.randomUUID(),
          name,
          amount:  parseFloat(amount),
          bgcolor: INCOME_COLORS_BACKGROUND[INCOME_TYPES.indexOf(type)],
          txcolor: INCOME_COLORS_TEXT[INCOME_TYPES.indexOf(type)],
          type,
          date: temp
        };
    
        addIncome(newIncome);
        setName('');
        setAmount('');
      };

    return (
        <div className="rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Add New Income</h2>
            <form onSubmit={handleSubmit} className="flex gap-4 items-end">
            <div className="flex-1">
                <label className="block text-sm font-medium text-white mb-1">Name</label>
                <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full p-2 focus:ring-blue-500 focus:border-blue-500 border-2 border-gray-800 rounded-lg"
                placeholder="e.g. Software Dev"
                />
            </div>
            <div className="w-48">
                <label className="block text-sm font-medium text-white mb-1">Income per Month</label>
                <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full p-2 border-2 border-gray-800 rounded-lg"
                placeholder="0"
                />
            </div>
            <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
                Add
            </button>
            </form>
        </div>
    );
}