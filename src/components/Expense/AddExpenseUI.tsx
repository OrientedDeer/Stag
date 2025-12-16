import React, { useState, useContext } from "react";
import { ExpenseContext } from "./ExpenseContext";
import { AnyExpense } from "./models";

const generateUniqueId = () =>
	`INC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddControlProps {
	ExpenseClass: new (
		id: string,
		name: string,
		amount: number,
        frequency: 'Weekly' | 'BiWeekly' | 'Monthly' | 'Annually',
        endDate: Date,
		...args: any[]
	) => AnyExpense;
	title: string;
	defaultArgs?: any[];
}

const AddExpenseControl: React.FC<AddControlProps> = ({
	ExpenseClass,
	title,
	defaultArgs = [],
}) => {
	const { dispatch } = useContext(ExpenseContext);
	const [name, setName] = useState("");
	const isDisabled = name.trim() === "";

	const handleAdd = () => {
		if (isDisabled) return;

		const id = generateUniqueId();
		const ExpenseName = name.trim();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Default base values: amount=0, frequency='Monthly', endDate=today
		const newExpense = new ExpenseClass(
            id, 
            ExpenseName, 
            0, 
            'Monthly', 
            today, 
            today, 
            ...defaultArgs
        );
		dispatch({ type: "ADD_EXPENSE", payload: newExpense });
		setName("");
	};

	const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleAdd();
		}
	};

	return (
		<div className="flex items-center gap-4 mb-6">
			<div className="grow ">
				<input
					className="text-white border border-gray-700 rounded-lg p-2 w-full 
					focus:outline-none 
					focus:border-green-300"
					type="text"
					placeholder={`Add New ${title} Expense`}
					value={name}
					onChange={(e) => setName(e.target.value)}
					onKeyDown={handleKeyPress}
				/>
			</div>
			<button
				onClick={handleAdd}
				disabled={isDisabled}
				className={`py-4 px-6 rounded font-medium transition-colors duration-200 whitespace-nowrap ${
					isDisabled
						? "bg-gray-700 text-gray-500 cursor-not-allowed"
						: "bg-green-600 text-white hover:bg-green-700"
				}`}
			>
                + Add
			</button>
		</div>
	);
};

export default AddExpenseControl;