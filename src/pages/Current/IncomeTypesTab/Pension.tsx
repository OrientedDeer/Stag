import { useIncomes } from "../../../context/IncomeTypesContext";
import IncomeList from "../../../components/Income/IncomeList";
import AddIncome from "../../../components/Income/AddIncome";
import {INCOME_TYPES} from '../../../types';

export default function Pension() {
  const { incomes } = useIncomes();

  return (
    <div className="flex flex-col rounded-b-lg">
      <IncomeList
        filteredIncomes={incomes.filter((income) => {
          return income.type === "Pension";
        })}
        type = "Pension"
      />
      <AddIncome type={INCOME_TYPES[0]} />
    </div>
  );
}
