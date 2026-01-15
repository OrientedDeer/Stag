type TopBarProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  title: string;
};

export default function TopBar({setIsOpen, title}: TopBarProps ) {
	return (
		<div
			className={`w-full text-white h-10 bg-gray-900 transition-all duration-300 flex flex-row items-center pl-2`}
		>
			<button
                onClick={() => setIsOpen(prev => !prev)}
                aria-label="Toggle navigation menu"
                className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-700 transition-colors"
			>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960" aria-hidden="true">
                    <path d="M120-240v-80h720v80zm0-200v-80h720v80zm0-200v-80h720v80z" />
                </svg>
                <span>{title}</span>
			</button>
		</div>
	);
}
