type TopBarProps = {
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  title: string;
};

export default function TopBar({setIsOpen, title}: TopBarProps ) {
	return (
		<div
			className={`w-full text-white bg-gray-900 transition-all duration-300 flex flex-row gap-2`}
		>
			<button
                onClick={() => setIsOpen(prev => !prev)}
			>
				<span className="flex items-center">
                    <span className="hover:bg-gray-800">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960">
                            <path d="M120-240v-80h720v80zm0-200v-80h720v80zm0-200v-80h720v80z" />
                        </svg>
                    </span>
					<span>&nbsp;{title}</span>
				</span>
			</button>
		</div>
	);
}
