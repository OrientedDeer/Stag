import React, { useState, useRef, useEffect } from 'react';
import { SavedScenario } from '../../../services/ScenarioTypes';
import { ConfirmDialog } from '../../Layout/ConfirmDialog';

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

    const handleSave = () => {
        onSave(editedAssumptions);
        onClose();
    };

    const macro = editedAssumptions.macro || {};
    const investments = editedAssumptions.investments || {};
    const demographics = editedAssumptions.demographics || {};

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
            <div
                className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                    <h3 className="text-white font-semibold">
                        Edit Assumptions: {scenario.metadata.name}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    {/* Macro Assumptions */}
                    <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Economic Assumptions</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Inflation Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={macro.inflationRate ?? 3}
                                    onChange={(e) => handleChange('macro', 'inflationRate', parseFloat(e.target.value))}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Housing Appreciation (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={macro.housingAppreciation ?? 3}
                                    onChange={(e) => handleChange('macro', 'housingAppreciation', parseFloat(e.target.value))}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Investment Assumptions */}
                    <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Investment Assumptions</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Return Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={investments.returnRates?.ror ?? 5.9}
                                    onChange={(e) => handleNestedChange('investments', 'returnRates', 'ror', parseFloat(e.target.value))}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Withdrawal Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    value={investments.withdrawalRate ?? 4}
                                    onChange={(e) => handleChange('investments', 'withdrawalRate', parseFloat(e.target.value))}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Demographics */}
                    <div>
                        <h4 className="text-sm font-medium text-gray-300 mb-2">Demographics</h4>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Retirement Age</label>
                                <input
                                    type="number"
                                    value={demographics.retirementAge ?? 65}
                                    onChange={(e) => handleChange('demographics', 'retirementAge', parseInt(e.target.value))}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Life Expectancy</label>
                                <input
                                    type="number"
                                    value={demographics.lifeExpectancy ?? 90}
                                    onChange={(e) => handleChange('demographics', 'lifeExpectancy', parseInt(e.target.value))}
                                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white text-sm"
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium"
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
            <div className={`bg-gray-800/50 rounded-xl border p-4 transition-all ${
                isBaseline
                    ? 'border-blue-500 ring-1 ring-blue-500/50'
                    : isComparison
                        ? 'border-orange-500 ring-1 ring-orange-500/50'
                        : 'border-gray-700 hover:border-gray-600'
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
                                className="bg-gray-700 text-white font-semibold px-2 py-1 rounded border border-gray-600 w-full focus:outline-none focus:border-blue-500"
                            />
                        ) : (
                            <h3
                                className="text-white font-semibold truncate cursor-pointer hover:text-blue-400 transition-colors"
                                onClick={handleStartEdit}
                                title="Click to rename"
                            >
                                {scenario.metadata.name}
                            </h3>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">
                            Created {formatDate(scenario.metadata.createdAt)}
                        </p>
                    </div>

                    {/* Selection badges */}
                    <div className="flex gap-1 ml-2 flex-shrink-0">
                        {isBaseline && (
                            <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 text-xs rounded font-medium">
                                Baseline
                            </span>
                        )}
                        {isComparison && (
                            <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs rounded font-medium">
                                Compare
                            </span>
                        )}
                    </div>
                </div>

                {/* Description */}
                {scenario.metadata.description && (
                    <p className="text-sm text-gray-400 mb-3 line-clamp-2">
                        {scenario.metadata.description}
                    </p>
                )}

                {/* Tags */}
                {scenario.metadata.tags && scenario.metadata.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                        {scenario.metadata.tags.map((tag, i) => (
                            <span
                                key={i}
                                className="px-2 py-0.5 bg-gray-700 text-gray-300 text-xs rounded"
                            >
                                {tag}
                            </span>
                        ))}
                    </div>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-700">
                    <button
                        onClick={onSelectBaseline}
                        className={`px-3 py-1.5 text-xs rounded transition-colors ${
                            isBaseline
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-blue-600 hover:text-white'
                        }`}
                    >
                        {isBaseline ? 'Baseline' : 'Set Baseline'}
                    </button>
                    <button
                        onClick={onSelectComparison}
                        className={`px-3 py-1.5 text-xs rounded transition-colors ${
                            isComparison
                                ? 'bg-orange-500 text-white'
                                : 'bg-gray-700 text-gray-300 hover:bg-orange-600 hover:text-white'
                        }`}
                    >
                        {isComparison ? 'Comparing' : 'Set Compare'}
                    </button>
                    {onUpdateAssumptions && (
                        <button
                            onClick={() => setShowAssumptionsModal(true)}
                            className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                        >
                            Edit
                        </button>
                    )}
                    <button
                        onClick={onExport}
                        className="px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                    >
                        Export
                    </button>
                    <button
                        onClick={handleDelete}
                        className="px-3 py-1.5 text-xs rounded bg-gray-700 text-red-400 hover:bg-red-600 hover:text-white transition-colors ml-auto"
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

export default ScenarioCard;
