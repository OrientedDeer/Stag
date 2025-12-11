import { Income, INCOME_TYPES, TYPE_COLOR_BACKGROUND_MAP, TYPE_COLOR_TEXT_MAP} from '../../types';
import { useIncomes } from '../../context/IncomeTypesContext';
import { useState} from 'react';

type IncomeListProps = {
  filteredIncomes: Income[],
  type: Income["type"];
};

export default function IncomeList({filteredIncomes, type}: IncomeListProps) {
  const {removeIncome, updateIncome} = useIncomes();
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editingamountId, setEditingamountId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [editingAmount, setEditingAmount] = useState('');

  const saveName = (Income: Income) => {
    if (editingName.trim() === '' || editingName === Income.name) {
      setEditingNameId(null);
      return;
    }
    
    const updatedIncome = { ...Income, name: editingName };
    updateIncome(updatedIncome);
    setEditingNameId(null);
  };

  const saveamount = (Income: Income) => {
    const newamount = parseFloat(editingAmount);
    if (isNaN(newamount) || newamount === Income.amount) {
      setEditingamountId(null);
      return;
    }
    
    const updatedIncome = { ...Income, amount: newamount };
    updateIncome(updatedIncome);
    setEditingamountId(null);
  };

  return (
    <div className="rounded-lg shadow-sm overflow-hidden">
            <div className="divide-y divide-gray-900">
              {filteredIncomes.length === 0 ? (
                <div className="p-2 text-center text-white">
                  No {type} yet. Add one below!
                </div>
              ) : (
                filteredIncomes.map((income) => {
                  const bgColorClass = TYPE_COLOR_BACKGROUND_MAP[income.type];
                  const txColorClass = TYPE_COLOR_TEXT_MAP[income.type];
                  return(
                  <div key={income.id} className="p-4 flex items-center justify-between hover:bg-gray-600 group">
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-12 rounded-full ${bgColorClass}`}></div>
                      {editingNameId === income.id ? (
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          
                          // Save/Exit logic
                          onBlur={() => saveName(income)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveName(income);
                            }
                            if (e.key === 'Escape') setEditingNameId(null);
                          }}
                          
                          className="font-medium text-white bg-transparent focus:outline-none"
                          autoFocus 
                        /> ) : (
                        <h3 
                          className="font-medium text-white cursor-pointer hover:underline"
                          // Start edit logic
                          onClick={() => {
                            setEditingName(income.name);
                            setEditingNameId(income.id);
                          }}
                        >
                          {income.name}
                        </h3>
                      )}
                    </div>
                    <div className="flex items-center gap-6">
                      {editingamountId === income.id ? (
                        <input
                          type="number"
                          value={editingAmount}
                          onChange={(e) => setEditingAmount(e.target.value)}
                          
                          // Save/Exit logic
                          onBlur={() => saveamount(income)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              saveamount(income);
                            }
                            if (e.key === 'Escape') setEditingamountId(null);
                          }}
                          
                          className={`font-bold bg-transparent text-right focus:outline-none w-24 ${
                            txColorClass
                          }`}
                          autoFocus
                        />
                      ) : (
                        <span
                          className={`font-bold cursor-pointer hover:underline ${
                            txColorClass
                          }`}
                          // Start edit logic
                          onClick={() => {
                            setEditingAmount(income.amount.toFixed(2));
                            setEditingamountId(income.id);
                          }}
                        >
                          ${income.amount.toLocaleString()}
                        </span>
                      )}
                      <button
                        onClick={() => removeIncome(income.id)}
                        className="text-red-500 invisible group-hover:visible"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                )})
              )}
            </div>
          </div>
  );
}