import React, { useState, useRef, useEffect } from 'react';
import { SavedScenario } from '../../../services/ScenarioTypes';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';
import { getRetirementAge, getLifeExpectancy, BUILTIN_MILESTONE_IDS } from '../Assumptions/AssumptionsContext';

interface ScenarioCardProps {
    scenario: SavedScenario;
    isBaseline: boolean;
    isComparison: boolean;
    onSelectBaseline: () => void;
    onSelectComparison: () => void;
    onDelete: () => void;
    onExport: () => void;
    onRename: (newName: string) => void;
    onUpdateAssumptions?: (assumptions: any) => void;
}

/**
 * Modal for viewing/editing scenario assumptions
 */
const ScenarioAssumptionsModal: React.FC<{
    isOpen: boolean;
    scenario: SavedScenario;
    onClose: () => void;
    onSave: (assumptions: any) => void;
}> = ({ isOpen, scenario, onClose, onSave }) => {
    const assumptions = scenario.inputs?.assumptions || {};
    const [editedAssumptions, setEditedAssumptions] = useState(assumptions);

    // Reset when scenario changes
    useEffect(() => {
        setEditedAssumptions(scenario.inputs?.assumptions || {});
    }, [scenario]);

    if (!isOpen) return null;

    const handleChange = (section: string, key: string, value: number) => {
        setEditedAssumptions((prev: any) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [key]: value,
            },
        }));
    };

    const handleNestedChange = (section: string, subsection: string, key: string, value: number) => {
        setEditedAssumptions((prev: any) => ({
            ...prev,
            [section]: {
                ...prev[section],
                [subsection]: {
                    ...(prev[section]?.[subsection] || {}),
                    [key]: value,
                },
            },
        }));
    };

    // Update a milestone's condition value
    const handleMilestoneChange = (milestoneId: string, conditionType: 'AGE' | 'YEAR', value: number) => {
        setEditedAssumptions((prev: any) => {
            const milestones = prev.milestones || [];
            const updatedMilestones = milestones.map((m: any) => {
                if (m.id !== milestoneId) return m;
                return {
                    ...m,
                    conditions: m.conditions.map((c: any) =>
                        c.type === conditionType ? { ...c, value } : c
                    ),
                };
            });
            return { ...prev, milestones: updatedMilestones };
        });
    };

    const handleSave = () => {
        onSave(editedAssumptions);
        onClose();
    };

    const macro = editedAssumptions.macro || {};
    const investments = editedAssumptions.investments || {};
    const milestones = editedAssumptions.milestones || [];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div
                className="bg-surface-raised rounded-xl border border-border-default w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-border-default flex items-center justify-between">
                    <h3 className="text-white font-semibold">
                        Edit Assumptions: {scenario.metadata.name}
                    </h3>
                    <button onClick={onClose} className="text-content-muted hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Macro Assumptions */}
                    <div>
                        <h4 className="text-sm font-medium text-content-default mb-2">Economic Assumptions</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Inflation Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={macro.inflationRate ?? 3}
                                    onChange={(e) => handleChange('macro', 'inflationRate', parseFloat(e.target.value))}
                                    className="w-full bg-surface-overlay border border-border-default rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Housing Appreciation (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={macro.housingAppreciation ?? 3}
                                    onChange={(e) => handleChange('macro', 'housingAppreciation', parseFloat(e.target.value))}
                                    className="w-full bg-surface-overlay border border-border-default rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Investment Assumptions */}
                    <div>
                        <h4 className="text-sm font-medium text-content-default mb-2">Investment Assumptions</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Return Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={investments.returnRates?.ror ?? 5.9}
                                    onChange={(e) => handleNestedChange('investments', 'returnRates', 'ror', parseFloat(e.target.value))}
                                    className="w-full bg-surface-overlay border border-border-default rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Withdrawal Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={investments.withdrawalRate ?? 4}
                                    onChange={(e) => handleChange('investments', 'withdrawalRate', parseFloat(e.target.value))}
                                    className="w-full bg-surface-overlay border border-border-default rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Demographics (from Milestones) */}
                    <div>
                        <h4 className="text-sm font-medium text-content-default mb-2">Demographics</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Retirement Age</label>
                                <input
                                    type="number"
                                    value={getRetirementAge(milestones)}
                                    onChange={(e) => handleMilestoneChange(BUILTIN_MILESTONE_IDS.RETIRE, 'AGE', parseInt(e.target.value))}
                                    className="w-full bg-surface-overlay border border-border-default rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Life Expectancy</label>
                                <input
                                    type="number"
                                    value={getLifeExpectancy(milestones)}
                                    onChange={(e) => handleMilestoneChange(BUILTIN_MILESTONE_IDS.END_OF_PLAN, 'AGE', parseInt(e.target.value))}
                                    className="w-full bg-surface-overlay border border-border-default rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-border-default flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-surface-input hover:bg-surface-hover text-white rounded-lg text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-positive-solid hover:bg-positive-soft text-white rounded-lg text-sm font-medium"
                    >
                        Save Changes
                    </button>
                </div>
            </div>
        </div>
    );
};

/**
 * Format a date string for display
 */
const formatDate = (dateString: string): string => {
    try {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    } catch {
        return dateString;
    }
};

/**
 * Card component for displaying a single scenario
 */
export const ScenarioCard: React.FC<ScenarioCardProps> = ({
    scenario,
    isBaseline,
    isComparison,
    onSelectBaseline,
    onSelectComparison,
    onDelete,
    onExport,
    onRename,
    onUpdateAssumptions
}) => {
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showAssumptionsModal, setShowAssumptionsModal] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(scenario.metadata.name);
    const inputRef = useRef<HTMLInputElement>(null);

    // Focus input when entering edit mode
    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [isEditing]);

    const handleDelete = () => {
        setShowDeleteConfirm(true);
    };

    const confirmDelete = () => {
        setShowDeleteConfirm(false);
        onDelete();
    };

    const handleStartEdit = () => {
        setEditName(scenario.metadata.name);
        setIsEditing(true);
    };

    const handleSaveEdit = () => {
        const trimmed = editName.trim();
        if (trimmed && trimmed !== scenario.metadata.name) {
            onRename(trimmed);
        }
        setIsEditing(false);
    };

    const handleCancelEdit = () => {
        setEditName(scenario.metadata.name);
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleSaveEdit();
        } else if (e.key === 'Escape') {
            handleCancelEdit();
        }
    };

    return (
        <>
            <div className={`bg-surface-overlay/50 rounded-xl border p-4 transition-all ${
                isBaseline
                    ? 'border-accent-soft ring-1 ring-accent-soft/50'
                    : isComparison
                        ? 'border-cat-orange-soft ring-1 ring-cat-orange-soft/50'
                        : 'border-border-default hover:border-border-strong'
            }`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                        {isEditing ? (
                            <input
                                ref={inputRef}
                                type="text"
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onBlur={handleSaveEdit}
                                onKeyDown={handleKeyDown}
                                className="bg-surface-input text-white font-semibold px-2 py-1 rounded border border-border-strong w-full focus:outline-none focus:border-accent-soft"
                            />
                        ) : (
                            <h3
                                className="text-white font-semibold truncate cursor-pointer hover:text-info transition-colors"
                                onClick={handleStartEdit}
                                title="Click to rename"
                            >
                                {scenario.metadata.name}
                            </h3>
                        )}
                        <p className="text-xs text-content-muted mt-0.5">
                            Created {formatDate(scenario.metadata.createdAt)}
                        </p>
                    </div>

                    {/* Selection badges */}
                    <div className="flex gap-1 ml-2 shrink-0">
                        {isBaseline && (
                            <span className="px-2 py-0.5 bg-info-tint/20 text-info text-xs rounded font-medium">
                                Baseline
                            </span>
                        )}
                        {isComparison && (
                            <span className="px-2 py-0.5 bg-cat-orange-soft/20 text-cat-orange text-xs rounded font-medium">
                                Compare
                            </span>
                        )}
                    </div>
                </div>

                {/* Description */}
                {scenario.metadata.description && (
                    <p className="text-sm text-content-muted mb-3 line-clamp-2">
                        {scenario.metadata.description}
                    </p>
                )}

                {/* Tags */}
                {scenario.metadata.tags && scenario.metadata.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                        {scenario.metadata.tags.map((tag, i) => (
                            <span
                                key={i}
                                className="px-2 py-0.5 bg-surface-input text-content-default text-xs rounded"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-border-default">
                    <button
                        onClick={onSelectBaseline}
                        className={`px-3 py-1.5 text-xs rounded transition-colors ${
                            isBaseline
                                ? 'bg-accent-soft text-white'
                                : 'bg-surface-input text-content-default hover:bg-accent hover:text-white'
                        }`}
                    >
                        {isBaseline ? 'Baseline' : 'Set Baseline'}
                    </button>
                    <button
                        onClick={onSelectComparison}
                        className={`px-3 py-1.5 text-xs rounded transition-colors ${
                            isComparison
                                ? 'bg-cat-orange-soft text-white'
                                : 'bg-surface-input text-content-default hover:bg-cat-orange-solid hover:text-white'
                        }`}
                    >
                        {isComparison ? 'Comparing' : 'Set Compare'}
                    </button>
                    {onUpdateAssumptions && (
                        <button
                            onClick={() => setShowAssumptionsModal(true)}
                            className="px-3 py-1.5 text-xs rounded bg-surface-input text-content-default hover:bg-surface-hover transition-colors"
                        >
                            Edit
                        </button>
                    )}
                    <button
                        onClick={onExport}
                        className="px-3 py-1.5 text-xs rounded bg-surface-input text-content-default hover:bg-surface-hover transition-colors"
                    >
                        Export
                    </button>
                    <button
                        onClick={handleDelete}
                        className="px-3 py-1.5 text-xs rounded bg-surface-input text-negative hover:bg-negative-solid hover:text-white transition-colors ml-auto"
                    >
                        Delete
                    </button>
                </div>
            </div>

            {/* Delete confirmation dialog */}
            <ConfirmDialog
                isOpen={showDeleteConfirm}
                title="Delete Scenario"
                message={`Are you sure you want to delete "${scenario.metadata.name}"? This cannot be undone.`}
                confirmLabel="Delete"
                onConfirm={confirmDelete}
                onCancel={() => setShowDeleteConfirm(false)}
            />

            {/* Assumptions editing modal */}
            {onUpdateAssumptions && (
                <ScenarioAssumptionsModal
                    isOpen={showAssumptionsModal}
                    scenario={scenario}
                    onClose={() => setShowAssumptionsModal(false)}
                    onSave={onUpdateAssumptions}
                />
            )}
        </>
    );
};
