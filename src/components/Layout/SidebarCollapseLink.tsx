import React, { useState } from "react";
import { Link, useLocation } from "react-router-dom";

// Define the structure for a sub-link
interface SubLink {
	path: string;
	label: string;
}

interface SidebarCollapseLinkProps {
	label: string;
	icon: React.ReactNode;
	subLinks: SubLink[];
	isOpen: boolean; // From the parent Sidebar for overall collapse
	linkBaseClass: string;
	activeClass: string;
}

const SidebarCollapseLink: React.FC<SidebarCollapseLinkProps> = ({
	label,
	icon,
	subLinks,
	isOpen,
	linkBaseClass,
	activeClass,
}) => {
	const { pathname } = useLocation();
	// State to track if *this* collapsible menu is open
	const [isExpanded, setIsExpanded] = useState(false);

	// Check if any sub-link is currently active
	const isActiveParent = subLinks.some((link) =>
		pathname.startsWith(link.path)
	);

	// The base link class for the parent item
	const parentLinkClass = `${linkBaseClass} ${
		isActiveParent ? activeClass : ""
	} ${isOpen ? "pointer-events-none" : ""}`;

	// The base link class for the sub-items
	const subLinkBaseClass = `flex items-center p-1 rounded text-White ml-4 mb-1 text-sm ${
		isOpen ? "" : "hover:bg-gray-700"
	}`;

	// Helper to render the icon and text
	const renderContent = (
		<span
			className={`flex items-center gap-2 overflow-hidden whitespace-nowrap transition-all duration-300 ${
				isOpen ? "w-0 opacity-0" : "w-auto opacity-100"
			}`}
		>
			{icon}
			<span
				className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
					isOpen ? "w-0 opacity-0" : "w-auto opacity-100"
				}`}
			>
				{label}
			</span>
			{/* Optional: Add a subtle chevron/arrow for the collapse indicator */}
			{!isOpen && (
				<svg
					className={`w-4 h-4 transition-transform duration-200 ${
						isExpanded ? "rotate-180" : "rotate-0"
					}`}
					fill="currentColor"
					viewBox="0 0 20 20"
				>
					<path
						fillRule="evenodd"
						d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
						clipRule="evenodd"
					/>
				</svg>
			)}
		</span>
	);

	return (
		<div className="flex flex-col">
			{/* -------------------- PARENT LINK (TOGGLE) -------------------- */}
			<a
				className={parentLinkClass}
				onClick={() => setIsExpanded(!isExpanded)}
				href="#" // Prevent hash change/scroll on click
			>
				{renderContent}
			</a>

			{/* -------------------- SUB LINKS (COLLAPSIBLE) -------------------- */}
			{isExpanded && !isOpen && (
				<div className="flex flex-col pl-2 transition-all duration-300">
					{subLinks.map((sub) => (
						<Link
							key={sub.path}
							to={sub.path}
							className={`${subLinkBaseClass} ${
								pathname === sub.path ? activeClass : ""
							}`}
						>
							<span className="truncate">{sub.label}</span>
						</Link>
					))}
				</div>
			)}
		</div>
	);
};

export default SidebarCollapseLink;
