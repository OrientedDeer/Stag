import React, { useState, useContext } from "react";
import { AssumptionsContext, isBuiltinMilestone, BUILTIN_MILESTONE_IDS } from "./AssumptionsContext";
import { CustomMilestone, MilestoneCondition, MilestoneConditionType, MilestoneOperator, MilestoneValueType } from "../../../services/simulation/types";
import { NameInput } from "../../Layout/InputFields/NameInput";
import { NumberInput } from "../../Layout/InputFields/NumberInput";
import { DropdownInput } from "../../Layout/InputFields/DropdownInput";
import { CurrencyInput } from "../../Layout/InputFields/CurrencyInput";
import { useModalAccessibility } from "../../../hooks/useModalAccessibility";

const generateUniqueId = () =>
    `MILE-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

interface MilestoneModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface MilestoneFormState {
    name: string;
    conditions: MilestoneCondition[];
}

const CONDITION_TYPE_OPTIONS: { value: MilestoneConditionType; label: string }[] = [
    { value: 'NET_WORTH', label: 'Net Worth' },
    { value: 'LIQUID_NET_WORTH', label: 'Liquid Net Worth' },
    { value: 'TOTAL_DEBT', label: 'Total Debt' },
    { value: 'YEAR', label: 'Year' },
    { value: 'AGE', label: 'Age' },
];

const ALL_OPERATOR_OPTIONS: { value: MilestoneOperator; label: string }[] = [
    { value: '>=', label: '>=' },
    { value: '<=', label: '<=' },
    { value: '>', label: '>' },
    { value: '<', label: '<' },
    { value: '=', label: '=' },
];

// Exact match ('=') is hidden for monetary conditions — hitting an exact dollar amount is near-impossible
const getOperatorOptions = (type: MilestoneConditionType) =>
    (type === 'NET_WORTH' || type === 'LIQUID_NET_WORTH' || type === 'TOTAL_DEBT')
        ? ALL_OPERATOR_OPTIONS.filter(o => o.value !== '=')
        : ALL_OPERATOR_OPTIONS;

const VALUE_TYPE_OPTIONS: { value: MilestoneValueType; label: string }[] = [
    { value: 'FIXED', label: 'Fixed' },
    { value: 'EXPENSES', label: '× Expenses' },
    { value: 'EXPENSES_GROSSED_UP', label: '× Expenses (w/ tax)' },
    { value: 'MILESTONE_PLUS', label: '+ Milestone' },
];

function getInitialFormState(): MilestoneFormState {
    return {
        name: '',
        conditions: [{ type: 'NET_WORTH', operator: '>=', value: 0 }],
    };
}

const MilestoneModal: React.FC<MilestoneModalProps> = ({ isOpen, onClose }) => {
    const { state, dispatch } = useContext(AssumptionsContext);
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const [view, setView] = useState<'list' | 'edit'>('list');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<MilestoneFormState>(getInitialFormState);

    const milestones = state.milestones || [];

    const handleClose = () => {
        setView('list');
        setEditingId(null);
        setForm(getInitialFormState());
        onClose();
    };

    const handleAdd = () => {
        setEditingId(null);
        setForm(getInitialFormState());
        setView('edit');
    };

    const handleEdit = (milestone: CustomMilestone) => {
        setEditingId(milestone.id);
        setForm({
            name: milestone.name,
            conditions: [...milestone.conditions],
        });
        setView('edit');
    };

    const handleDelete = (id: string) => {
        dispatch({ type: 'REMOVE_MILESTONE', payload: id });
    };

    const handleSave = () => {
        if (!form.name.trim() || form.conditions.length === 0) return;

        const milestone: CustomMilestone = {
            id: editingId || generateUniqueId(),
            name: form.name.trim(),
            conditions: form.conditions,
        };

        if (editingId) {
            dispatch({ type: 'UPDATE_MILESTONE', payload: milestone });
        } else {
            dispatch({ type: 'ADD_MILESTONE', payload: milestone });
        }

        setView('list');
        setEditingId(null);
        setForm(getInitialFormState());
    };

    const handleBack = () => {
        setView('list');
        setEditingId(null);
        setForm(getInitialFormState());
    };

    const addCondition = () => {
        setForm(prev => ({
            ...prev,
            conditions: [...prev.conditions, { type: 'NET_WORTH', operator: '>=', value: 0 }],
        }));
    };

    const removeCondition = (index: number) => {
        setForm(prev => ({
            ...prev,
            conditions: prev.conditions.filter((_, i) => i !== index),
        }));
    };

    const updateCondition = (index: number, field: keyof MilestoneCondition, value: string | number | undefined) => {
        setForm(prev => ({
            ...prev,
            conditions: prev.conditions.map((cond, i) =>
                i === index ? { ...cond, [field]: value } : cond
            ),
        }));
    };

    const isMonetaryCondition = (type: MilestoneConditionType) =>
        type === 'NET_WORTH' || type === 'LIQUID_NET_WORTH' || type === 'TOTAL_DEBT';

    // Get locked condition type for built-in milestones (only Birth and End of Plan are locked)
    const getLockedConditionType = (milestoneId: string | null): MilestoneConditionType | null => {
        if (!milestoneId) return null;
        switch (milestoneId) {
            case BUILTIN_MILESTONE_IDS.BIRTH:
                return 'YEAR';
            case BUILTIN_MILESTONE_IDS.END_OF_PLAN:
                return 'AGE';
            default:
                return null;
        }
    };

    const lockedConditionType = getLockedConditionType(editingId);
    const isBuiltinEdit = editingId ? isBuiltinMilestone(editingId) : false;

    // Get milestones available for reference (excluding the one being edited)
    const getReferenceMilestones = () =>
        milestones.filter(m => m.id !== editingId);

    // Format condition for display
    const formatConditionDisplay = (cond: MilestoneCondition) => {
        const typeLabel = cond.type.replace(/_/g, ' ');
        const valueType = cond.valueType || 'FIXED';

        let rightSide: string;
        if (valueType === 'EXPENSES') {
            rightSide = `${cond.value}× Expenses`;
        } else if (valueType === 'EXPENSES_GROSSED_UP') {
            rightSide = `${cond.value}× Expenses (incl. ~15% tax)`;
        } else if (valueType === 'MILESTONE_PLUS') {
            const refMilestone = milestones.find(m => m.id === cond.referenceMilestoneId);
            const milestoneName = refMilestone?.name || 'Unknown';
            rightSide = cond.value === 0
                ? `"${milestoneName}"`
                : `"${milestoneName}" + ${cond.value}`;
        } else if (isMonetaryCondition(cond.type)) {
            rightSide = `$${cond.value.toLocaleString()}`;
        } else {
            rightSide = `${cond.value}`;
        }

        return `${typeLabel} ${cond.operator} ${rightSide}`;
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="milestone-modal-title"
                className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-2xl"
                onKeyDown={handleKeyDown}
            >
                <h2 id="milestone-modal-title" className="text-xl font-bold mb-4 border-b border-gray-800 pb-3">
                    {view === 'list' ? 'Milestones' : editingId ? 'Edit Milestone' : 'New Milestone'}
                </h2>

                {view === 'list' ? (
                    <div className="space-y-4">
                        {milestones.length === 0 ? (
                            <div className="text-center py-8">
                                <p className="text-gray-400 mb-4">No milestones defined yet.</p>
                                <p className="text-gray-500 text-sm">
                                    Milestones let you trigger income or expense changes based on financial goals like reaching Coast FIRE or becoming debt-free.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {milestones.map(milestone => (
                                    <div
                                        key={milestone.id}
                                        className="flex items-center justify-between p-3 bg-gray-800 rounded-lg border border-gray-700"
                                    >
                                        <div className="flex-1">
                                            <div className="font-medium text-white">{milestone.name}</div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                {milestone.conditions.map((cond, i) => (
                                                    <span key={i}>
                                                        {i > 0 && ' AND '}
                                                        {formatConditionDisplay(cond)}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex gap-2 ml-4">
                                            <button
                                                onClick={() => handleEdit(milestone)}
                                                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                                                title="Edit milestone"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                                </svg>
                                            </button>
                                            {!isBuiltinMilestone(milestone.id) && (
                                                <button
                                                    onClick={() => handleDelete(milestone.id)}
                                                    className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                                                    title="Delete milestone"
                                                >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="flex justify-between pt-4 border-t border-gray-800">
                            <button
                                onClick={handleClose}
                                className="px-4 py-2 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                            >
                                Close
                            </button>
                            <button
                                onClick={handleAdd}
                                className="px-4 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 transition-colors flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Add Milestone
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {editingId && isBuiltinMilestone(editingId) ? (
                            <div>
                                <span className="block text-xs sm:text-sm text-gray-400 font-medium mb-0.5 uppercase tracking-wide">
                                    Milestone Name
                                </span>
                                <div className="bg-gray-900 border border-gray-700 rounded-md px-3 py-2">
                                    <div className="text-white text-md font-semibold flex items-center gap-2">
                                        {form.name}
                                        <span className="text-xs text-gray-500 font-normal">(built-in)</span>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <NameInput
                                label="Milestone Name"
                                id={editingId || 'new-milestone'}
                                value={form.name}
                                onChange={(val) => setForm(prev => ({ ...prev, name: val }))}
                                placeholder="e.g., Coast FIRE, Debt Free"
                            />
                        )}

                        <div className="space-y-3">
                            {(!isBuiltinEdit || !lockedConditionType) && (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium text-gray-300">Conditions</span>
                                    {!isBuiltinEdit && <span className="text-xs text-gray-500">All conditions must be met (AND logic)</span>}
                                </div>
                            )}

                            {/* Simplified view for built-in milestones */}
                            {isBuiltinEdit && lockedConditionType ? (
                                <div className="p-3 bg-gray-800 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3">
                                        <span className="text-gray-400 text-sm">
                                            {lockedConditionType === 'YEAR' ? 'Year' : 'Age'} =
                                        </span>
                                        <div className="w-24">
                                            <NumberInput
                                                label=""
                                                value={form.conditions[0]?.value || 0}
                                                onChange={(val) => updateCondition(0, 'value', val)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                /* Full condition editor for custom milestones */
                                <>
                                    {form.conditions.map((condition, index) => (
                                        <div key={index} className="p-3 bg-gray-800 rounded-lg border border-gray-700 space-y-2">
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 grid grid-cols-[1fr_70px_minmax(120px,1fr)_1fr] gap-2 items-end">
                                                    {/* Left side: what we're measuring */}
                                                    <DropdownInput
                                                        label=""
                                                        value={condition.type}
                                                        options={CONDITION_TYPE_OPTIONS}
                                                        onChange={(val) => {
                                                            updateCondition(index, 'type', val as MilestoneConditionType);
                                                            // Auto-correct '=' to '>=' when switching to monetary type
                                                            const isMon = val === 'NET_WORTH' || val === 'LIQUID_NET_WORTH' || val === 'TOTAL_DEBT';
                                                            if (isMon && condition.operator === '=') {
                                                                updateCondition(index, 'operator', '>=');
                                                            }
                                                        }}
                                                    />
                                                    {/* Operator */}
                                                    <DropdownInput
                                                        label=""
                                                        value={condition.operator}
                                                        options={getOperatorOptions(condition.type)}
                                                        onChange={(val) => updateCondition(index, 'operator', val as MilestoneOperator)}
                                                    />
                                                    {/* Value */}
                                                    {isMonetaryCondition(condition.type) && (condition.valueType || 'FIXED') === 'FIXED' ? (
                                                        <CurrencyInput
                                                            label=""
                                                            value={condition.value}
                                                            onChange={(val) => updateCondition(index, 'value', val)}
                                                        />
                                                    ) : (
                                                        <NumberInput
                                                            label=""
                                                            value={condition.value}
                                                            onChange={(val) => updateCondition(index, 'value', val)}
                                                        />
                                                    )}
                                                    {/* Value type: Fixed, × Expenses, + Milestone */}
                                                    <DropdownInput
                                                        label=""
                                                        value={condition.valueType || 'FIXED'}
                                                        options={VALUE_TYPE_OPTIONS}
                                                        onChange={(val) => {
                                                            updateCondition(index, 'valueType', val as MilestoneValueType);
                                                            // Clear reference milestone when not using MILESTONE_PLUS
                                                            if (val !== 'MILESTONE_PLUS') {
                                                                updateCondition(index, 'referenceMilestoneId', undefined);
                                                            }
                                                        }}
                                                    />
                                                </div>
                                                {form.conditions.length > 1 && !isBuiltinEdit && (
                                                    <button
                                                        onClick={() => removeCondition(index)}
                                                        className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded transition-colors"
                                                        title="Remove condition"
                                                    >
                                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </div>
                                            {/* Reference milestone dropdown for MILESTONE_PLUS */}
                                            {condition.valueType === 'MILESTONE_PLUS' && (
                                                <div className="pl-2">
                                                    <DropdownInput
                                                        label="Reference Milestone"
                                                        value={condition.referenceMilestoneId || ''}
                                                        options={[
                                                            { value: '', label: 'Select a milestone...' },
                                                            ...getReferenceMilestones().map(m => ({ value: m.id, label: m.name }))
                                                        ]}
                                                        onChange={(val) => updateCondition(index, 'referenceMilestoneId', val || undefined)}
                                                    />
                                                    {getReferenceMilestones().length === 0 && (
                                                        <p className="text-xs text-yellow-400 mt-1">
                                                            Create other milestones first to use "+ Milestone"
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                            {/* Preview of what this condition means */}
                                            <p className="text-xs text-gray-500 pl-1">
                                                {formatConditionDisplay(condition)}
                                            </p>
                                        </div>
                                    ))}

                                    {!isBuiltinEdit && (
                                        <button
                                            onClick={addCondition}
                                            className="w-full p-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors text-sm"
                                        >
                                            + Add Another Condition
                                        </button>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Example milestones info - only show for custom milestones */}
                        {!isBuiltinEdit && (
                            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 text-xs">
                                <div className="font-semibold text-blue-200 mb-2">Example Milestones</div>
                                <ul className="text-gray-400 space-y-1">
                                    <li><span className="text-gray-300">FI (4% Rule):</span> Net Worth {">="} 25 × Expenses</li>
                                    <li><span className="text-gray-300">FI (w/ taxes):</span> Net Worth {">="} 25 × Expenses (w/ tax)</li>
                                    <li><span className="text-gray-300">Coast FIRE:</span> Net Worth {">="} $750,000 (Fixed)</li>
                                    <li><span className="text-gray-300">Debt Free:</span> Total Debt {"<="} $0 (Fixed)</li>
                                </ul>
                                <p className="text-gray-500 mt-2">"× Expenses" uses living expenses only. "× Expenses (w/ tax)" grosses up by ~15% for taxes.</p>
                            </div>
                        )}

                        <div className="flex justify-between pt-4 border-t border-gray-800">
                            <button
                                onClick={handleBack}
                                className="px-4 py-2 rounded-lg font-medium text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={!form.name.trim() || form.conditions.length === 0}
                                className="px-4 py-2 rounded-lg font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                {editingId ? 'Save Changes' : 'Create Milestone'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MilestoneModal;
