import React, { useState, useContext } from "react";
import { AccountContext } from "./AccountContext";
import { AnyAccount } from "./models";

const generateUniqueId = (prefix: string = 'ACC') =>
	`${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddControlProps {
	AccountClass: new (
		id: string,
		name: string,
		amount: number,
		...args: any[]
	) => AnyAccount;
	title: string;
	defaultArgs?: any[];
}

const AddAccountControl: React.FC<AddControlProps> = ({
	AccountClass,
	title,
	defaultArgs = [],
}) => {
	const { dispatch: accountDispatch } = useContext(AccountContext);
    
	const [name, setName] = useState("");
	const isDisabled = name.trim() === "";

	const handleAdd = () => {
		if (isDisabled) return;

		const accountId = generateUniqueId('ACC');
		const accountName = name.trim();

		const newAccount = new AccountClass(accountId, accountName, 0, ...defaultArgs);
		accountDispatch({ type: "ADD_ACCOUNT", payload: newAccount });
		setName("");
	};

    // ... rest of component (handleKeyPress, return) remains the same
    // Just ensure handleKeyPress calls the updated handleAdd
    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleAdd();
		}
	};
    
	return (
		<div className="flex items-center gap-4 mb-6">
			<div className="grow ">
				<input
					className="text-white border border-gray-700 rounded-lg p-2 w-full focus:outline-none focus:border-green-300"
					type="text"
					placeholder={`Add New ${title} account`}
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

export default AddAccountControl;