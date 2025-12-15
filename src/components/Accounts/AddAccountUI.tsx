import React, { useState, useContext } from "react";
import { AccountContext } from "./AccountContext";
import { AnyAccount } from "./models";

const generateUniqueId = () =>
	`ACC-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface AddControlProps {
	AccountClass: new (
		id: string,
		name: string,
		balance: number,
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
	const { dispatch } = useContext(AccountContext);
	const [name, setName] = useState("");
	const isDisabled = name.trim() === "";

	const handleAdd = () => {
		if (isDisabled) return;

		const id = generateUniqueId();
		const accountName = name.trim();

		const newAccount = new AccountClass(id, accountName, 0, ...defaultArgs);
		dispatch({ type: "ADD_ACCOUNT", payload: newAccount });
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
