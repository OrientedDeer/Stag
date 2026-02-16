import { Link, useLocation } from "react-router-dom";
import { useContext, useState } from "react";
import { AssumptionsContext } from "../../Objects/Assumptions/AssumptionsContext";
import { CloudBackupContext } from "../../Objects/CloudBackup/CloudBackupContext";
import CloudBackupPanel from "../../Objects/CloudBackup/CloudBackupPanel";
import SidebarCollapseLink from './SidebarCollapseLink'; // Make sure the path is correct
type SidebarProps = {
  isOpen: boolean;
  onClose?: () => void;
};

export default function Sidebar({ isOpen, onClose }: SidebarProps) {
	const { pathname } = useLocation();
	const { state: assumptions } = useContext(AssumptionsContext);
	const showExperimental = assumptions.display?.showExperimentalFeatures ?? false;
	const { isAuthenticated, lastBackupTimestamp } = useContext(CloudBackupContext);
	const [dataPanelOpen, setDataPanelOpen] = useState(false);

	const link = `flex items-center mb-1 p-2 rounded text-White ${
		isOpen ? "" : "hover:bg-gray-600"
	}`;

	const active = `${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"} bg-gray-600 font-semibold text-green-300`;

	const currentSubLinks = [
        { path: "/current/accounts", label: "Accounts" },
        { path: "/current/income", label: "Income" },
        { path: "/current/expense", label: "Expenses" },
        { path: "/current/taxes", label: "Taxes" },
    ];
	const futureSubLinks = [
        { path: "/future/assumptions", label: "Assumptions" },
        { path: "/future/allocation", label: "Allocation" },
        { path: "/future/withdrawal", label: "Withdrawal" },
        { path: "/future/charts", label: "Charts" },
    ];


	const currentIcon = (
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960">
			<path d="M200-280v-280h80v280zm240 0v-280h80v280zM80-120v-80h800v80zm600-160v-280h80v280zM80-640v-80l400-200 400 200v80zm178-80h444zm0 0h444L480-830z" />
		</svg>
    );

	const futureIcon = (
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960">
			<path d="m136-240-56-56 296-298 160 160 208-206H640v-80h240v240h-80v-104L536-320 376-480z" />
		</svg>
	);

	const budgetIcon = (
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960">
			<path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm40-80h200v-80H240v80Zm324-132 156-156-56-56-100 100-44-44-56 56 100 100ZM240-520h200v-80H240v80Zm0-160h200v-80H240v80Z" />
		</svg>
	);

	// Handle link click - close sidebar on mobile
	const handleLinkClick = () => {
		if (onClose && window.innerWidth < 768) {
			onClose();
		}
	};

	// Sidebar is "closed" when isOpen is true (confusing naming, but matches existing logic)
	const isSidebarVisible = !isOpen;

	return (
		<>
			{/* Backdrop overlay for mobile - closes sidebar when clicked */}
			{isSidebarVisible && (
				<div
					className="fixed inset-0 bg-black/50 z-40 md:hidden"
					onClick={onClose}
					aria-hidden="true"
				/>
			)}

			{/* Sidebar */}
			<div className={`
				h-full text-white bg-gray-900 transition-all duration-300 flex flex-col z-50
				${isOpen ? "w-0" : "w-48"}
				md:relative md:z-auto
				fixed top-0 left-0
				${isSidebarVisible ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
			`}>
				<nav className="flex flex-col gap-1 pt-14 md:pt-0 flex-1">
					<Link
						className={`${link} ${pathname === "/dashboard" && active} ${isOpen ? "pointer-events-none" : ""}`}
						to="/dashboard"
						onClick={handleLinkClick}
					>
						<span className={`flex items-center gap-2 overflow-hidden whitespace-nowrap transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960">
								<path d="M640-160v-280h160v280zm-240 0v-640h160v640zm-240 0v-440h160v440z" />
							</svg>
							<span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
								Dashboard
							</span>
						</span>
					</Link>

					<SidebarCollapseLink
						label="Current"
						icon={currentIcon}
						subLinks={currentSubLinks}
						isOpen={isOpen}
						linkBaseClass={link}
						activeClass={active}
						onLinkClick={handleLinkClick}
					/>

					<Link
						className={`${link} ${pathname.startsWith("/budget") && active} ${isOpen ? "pointer-events-none" : ""}`}
						to="/budget"
						onClick={handleLinkClick}
					>
						<span className={`flex items-center gap-2 overflow-hidden whitespace-nowrap transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
							{budgetIcon}
							<span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
								Budget
							</span>
						</span>
					</Link>

					<SidebarCollapseLink
						label="Future"
						icon={futureIcon}
						subLinks={futureSubLinks}
						isOpen={isOpen}
						linkBaseClass={link}
						activeClass={active}
						onLinkClick={handleLinkClick}
					/>

					{showExperimental && (
					<Link
						className={`${link} ${pathname === "/testing" && active} ${isOpen ? "pointer-events-none" : ""}`}
						to="/testing"
						onClick={handleLinkClick}
					>
						<span className={`flex items-center gap-2 overflow-hidden whitespace-nowrap transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
							<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 -960 960 960">
								<path d="M200-120q-51 0-72.5-45.5T138-250l222-270v-240h-40q-17 0-28.5-11.5T280-800t11.5-28.5T320-840h320q17 0 28.5 11.5T680-800t-11.5 28.5T640-760h-40v240l222 270q32 39 10.5 84.5T760-120zm80-120h400L544-400H416zm-80 40h560L520-492v-268h-80v268zm280-280"/>
							</svg>
							<span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
								Testing
							</span>
						</span>
					</Link>
				)}
				</nav>

				{/* Data Management Footer */}
				<div className={`border-t border-gray-700 p-2 overflow-hidden transition-all duration-300 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
					<button
						onClick={() => setDataPanelOpen(!dataPanelOpen)}
						className={`flex items-center gap-2 w-full p-2 rounded text-sm transition-colors ${
							isOpen ? "pointer-events-none" : "hover:bg-gray-700"
						}`}
						title="Data Management"
					>
						<div className="relative shrink-0">
							<svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
							</svg>
							{isAuthenticated && lastBackupTimestamp && (
								<span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-400 rounded-full" />
							)}
						</div>
						<span className={`overflow-hidden whitespace-nowrap transition-all duration-300 text-gray-400 ${isOpen ? "w-0 opacity-0" : "w-auto opacity-100"}`}>
							Data
						</span>
					</button>
				</div>
			</div>

			{/* Data Management Panel - outside sidebar div to avoid transform containment */}
			<CloudBackupPanel isOpen={dataPanelOpen} onClose={() => setDataPanelOpen(false)} />
		</>
	);
}
