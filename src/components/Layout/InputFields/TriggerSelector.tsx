import { useState, useRef, useEffect, ReactElement } from 'react';
import { CustomMilestone } from '../../../services/simulation/types';
import { BUILTIN_MILESTONE_IDS } from '../../Objects/Assumptions/AssumptionsContext';
import { formatDateForInput } from '../../../utils/formatters';

interface TriggerSelectorProps {
    id: string;
    label: string;
    date: Date | undefined;
    milestoneId: string | undefined;
    milestones: CustomMilestone[];
    onDateChange: (date: Date | undefined) => void;
    onMilestoneChange: (milestoneId: string | undefined) => void;
    tooltip?: string;
    defaultMilestoneId?: string; // Default milestone if none set (usually END_OF_PLAN)
}

type TriggerMode = 'date' | 'milestone';

export function TriggerSelector({
    id,
    label,
    date,
    milestoneId,
    milestones,
    onDateChange,
    onMilestoneChange,
    tooltip,
    defaultMilestoneId = BUILTIN_MILESTONE_IDS.END_OF_PLAN
}: TriggerSelectorProps): ReactElement {
    const [isOpen, setIsOpen] = useState(false);
    const popupRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // Check if referenced milestone still exists
    const milestoneExists = milestoneId ? milestones.some(m => m.id === milestoneId) : false;

    // Determine current mode - default to milestone if nothing set
    const getCurrentMode = (): TriggerMode => {
        if (date) return 'date';
        return 'milestone'; // Default to milestone mode
    };

    const [mode, setMode] = useState<TriggerMode>(getCurrentMode);

    // Sync mode when external props change
    useEffect(() => {
        setMode(getCurrentMode());
    }, [date, milestoneId]);

    // If milestone was deleted, reset to default
    useEffect(() => {
        if (milestoneId && !milestoneExists) {
            onMilestoneChange(defaultMilestoneId);
        }
    }, [milestoneId, milestoneExists, defaultMilestoneId, onMilestoneChange]);

    // If nothing is set, set the default milestone
    useEffect(() => {
        if (!date && !milestoneId) {
            onMilestoneChange(defaultMilestoneId);
        }
    }, []);

    // Close popup when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                popupRef.current &&
                !popupRef.current.contains(event.target as Node) &&
                buttonRef.current &&
                !buttonRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => document.removeEventListener('mousedown', handleClickOutside);
        }
    }, [isOpen]);

    // Get display text for the button
    const getDisplayText = (): string => {
        if (date) {
            return formatDateForInput(date);
        }
        if (milestoneId) {
            const milestone = milestones.find(m => m.id === milestoneId);
            return milestone ? `@ ${milestone.name}` : '⚠️ Milestone deleted';
        }
        // Default to showing the default milestone
        const defaultMilestone = milestones.find(m => m.id === defaultMilestoneId);
        return defaultMilestone ? `@ ${defaultMilestone.name}` : 'Select trigger';
    };

    const handleModeChange = (newMode: TriggerMode) => {
        setMode(newMode);
        if (newMode === 'date') {
            onMilestoneChange(undefined);
            // Set a default date if none exists
            if (!date) {
                onDateChange(new Date());
            }
        } else if (newMode === 'milestone') {
            onDateChange(undefined);
            // Set default milestone if none exists
            if (!milestoneId) {
                onMilestoneChange(defaultMilestoneId);
            }
        }
    };

    const handleDateInput = (dateString: string) => {
        if (dateString) {
            const [y, m, d] = dateString.split('-').map(Number);
            onDateChange(new Date(y, m - 1, d));
        } else {
            onDateChange(undefined);
        }
    };

    const handleMilestoneSelect = (selectedId: string) => {
        if (selectedId) {
            onMilestoneChange(selectedId);
        } else {
            onMilestoneChange(undefined);
        }
    };

    const labelId = `${id}-label`;

    return (
        <div className="relative">
            <span id={labelId} className="block text-sm font-medium text-content-muted mb-1" title={tooltip}>
                {label}
            </span>
            <button
                ref={buttonRef}
                type="button"
                id={id}
                aria-labelledby={labelId}
                onClick={() => setIsOpen(!isOpen)}
                className={`
                    w-full text-left px-3 py-2 rounded-lg border transition-colors
                    bg-surface-overlay hover:bg-surface-input
                    ${isOpen ? 'border-accent-soft ring-1 ring-accent-soft' : 'border-border-default hover:border-border-strong'}
                    ${mode === 'milestone' ? 'text-info' : 'text-content-default'}
                `}
            >
                <div className="flex items-center justify-between">
                    <span>
                        {getDisplayText()}
                    </span>
                    <svg
                        className={`w-4 h-4 text-content-subtle transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </div>
            </button>

            {isOpen && (
                <div
                    ref={popupRef}
                    className="absolute z-50 mt-1 w-64 bg-surface-raised border border-border-default rounded-lg shadow-xl"
                >
                    {/* Mode tabs */}
                    <div className="flex border-b border-border-default">
                        <button
                            type="button"
                            onClick={() => handleModeChange('milestone')}
                            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors
                                ${mode === 'milestone'
                                    ? 'bg-surface-overlay text-white border-b-2 border-accent-soft'
                                    : 'text-content-muted hover:text-content-default hover:bg-surface-overlay/50'
                                }`}
                        >
                            Milestone
                        </button>
                        <button
                            type="button"
                            onClick={() => handleModeChange('date')}
                            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors
                                ${mode === 'date'
                                    ? 'bg-surface-overlay text-white border-b-2 border-accent-soft'
                                    : 'text-content-muted hover:text-content-default hover:bg-surface-overlay/50'
                                }`}
                        >
                            Fixed Date
                        </button>
                    </div>

                    {/* Content based on mode */}
                    <div className="p-3">
                        {mode === 'date' && (
                            <input
                                id={`${id}-date-input`}
                                type="date"
                                value={formatDateForInput(date)}
                                onChange={(e) => handleDateInput(e.target.value)}
                                className="w-full px-3 py-2 bg-surface-overlay border border-border-default rounded-lg text-content-default text-sm focus:border-accent-soft focus:ring-1 focus:ring-accent-soft"
                            />
                        )}

                        {mode === 'milestone' && (
                            <>
                                {milestones.length === 0 ? (
                                    <p className="text-xs text-content-subtle text-center py-2">
                                        No milestones defined. Create milestones in Assumptions tab.
                                    </p>
                                ) : (
                                    <div className="space-y-1 max-h-48 overflow-y-auto">
                                        {milestones.map(m => (
                                            <button
                                                key={m.id}
                                                type="button"
                                                onClick={() => {
                                                    handleMilestoneSelect(m.id);
                                                    setIsOpen(false);
                                                }}
                                                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors
                                                    ${milestoneId === m.id
                                                        ? 'bg-accent text-white'
                                                        : 'text-content-default hover:bg-surface-overlay'
                                                    }`}
                                            >
                                                <div className="flex items-center gap-2">
                                                    {m.color && (
                                                        <span
                                                            className="w-2 h-2 rounded-full flex-shrink-0"
                                                            style={{ backgroundColor: m.color }}
                                                        />
                                                    )}
                                                    <span className="truncate">{m.name}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Done button */}
                    <div className="border-t border-border-default p-2">
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="w-full px-3 py-1.5 bg-surface-overlay hover:bg-surface-input text-content-default text-xs rounded-md transition-colors"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
