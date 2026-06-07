import { useContext, useState, useCallback } from 'react';
import { List, type RowComponentProps } from 'react-window';
import { BudgetContext, CategoryMapping } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { AnyExpense } from '../../components/Objects/Expense/models';

import { Button } from "../../components/Layout/Primitives";
const RULE_ROW_HEIGHT = 36;
const RULE_EDIT_ROW_HEIGHT = 52;
const RULE_LIST_MAX_HEIGHT = 480;
const RULE_GRID_COLS = 'grid grid-cols-[1fr_1fr_80px] items-center';

export default function SettingsTab() {
    const { importSettings, dispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

    const [showRules, setShowRules] = useState(false);
    const [showFormats, setShowFormats] = useState(false);
    const [showAddRule, setShowAddRule] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        pattern: '',
        expenseId: '',
        isRegex: false,
    });

    const handleAddRule = useCallback(() => {
        if (!formData.pattern || !formData.expenseId) return;

        const newRule: CategoryMapping = {
            id: `RULE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            pattern: formData.pattern,
            expenseId: formData.expenseId,
            isRegex: formData.isRegex,
        };

        dispatch({ type: 'ADD_CATEGORY_MAPPING', payload: newRule });
        // Apply the new rule to all existing uncategorized transactions
        const ruleExpense = expenses.find(e => e.id === newRule.expenseId);
        dispatch({ type: 'APPLY_CATEGORY_RULE', payload: { ...newRule, expenseStart: ruleExpense?.startDate, expenseEnd: ruleExpense?.endDate } });

        setFormData({ pattern: '', expenseId: '', isRegex: false });
        setShowAddRule(false);
    }, [formData, dispatch]);

    const handleUpdateRule = useCallback((id: string, updates: Partial<CategoryMapping>) => {
        dispatch({
            type: 'UPDATE_CATEGORY_MAPPING',
            payload: { id, updates },
        });
        setEditingId(null);
    }, [dispatch]);

    const handleDeleteRule = useCallback((id: string) => {
        dispatch({ type: 'DELETE_CATEGORY_MAPPING', payload: { id } });
    }, [dispatch]);

    const handleEditStart = useCallback((id: string) => setEditingId(id), []);
    const handleEditCancel = useCallback(() => setEditingId(null), []);

    const handleDeleteFormat = useCallback((id: string) => {
        dispatch({ type: 'DELETE_CSV_FORMAT', payload: { id } });
    }, [dispatch]);

    const handleReapplyAllRules = useCallback(() => {
        // Apply each rule to all uncategorized transactions
        importSettings.categoryMappings.forEach(rule => {
            const ruleExpense = expenses.find(e => e.id === rule.expenseId);
            dispatch({ type: 'APPLY_CATEGORY_RULE', payload: { ...rule, expenseStart: ruleExpense?.startDate, expenseEnd: ruleExpense?.endDate } });
        });
    }, [dispatch, importSettings.categoryMappings, expenses]);

    const rules = importSettings.categoryMappings;
    const savedFormats = importSettings.savedCSVFormats || [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="text-lg font-semibold text-white">Budget Settings</h3>
                <p className="text-sm text-content-muted mt-1">
                    Configure auto-categorization rules and import settings.
                </p>
            </div>

            {/* Auto-categorization Rules */}
            <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
                <button
                    onClick={() => setShowRules(!showRules)}
                    className="w-full flex items-center justify-between text-left"
                >
                    <div>
                        <h4 className="font-medium text-white">Auto-categorization Rules</h4>
                        <p className="text-sm text-content-muted mt-1">
                            {rules.length} rule{rules.length !== 1 ? 's' : ''} defined
                        </p>
                    </div>
                    <svg
                        className={`w-4 h-4 text-content-muted transition-transform duration-200 ${showRules ? 'rotate-0' : '-rotate-90'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>

                {showRules && <>
                <div className="flex items-center justify-end gap-2 mt-4 mb-4">
                    {rules.length > 0 && (
                        <button
                            onClick={handleReapplyAllRules}
                            className="px-3 py-1.5 bg-surface-input hover:bg-surface-hover text-content-emphasis rounded-lg text-sm font-medium transition-colors"
                        >
                            Re-apply All
                        </button>
                    )}
                    <Button
                        onClick={() => setShowAddRule(true)}
                        variant="positive" size="sm"
                    >
                        Add Rule
                    </Button>
                </div>

                {/* Add Rule Form */}
                {showAddRule && (
                    <div className="bg-surface-raised rounded-lg p-4 mb-4 border border-border-default">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Pattern</label>
                                <input
                                    type="text"
                                    name="rule-pattern"
                                    placeholder="e.g., AMAZON, NETFLIX"
                                    value={formData.pattern}
                                    onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                                    className="w-full bg-surface-overlay border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-content-muted mb-1">Category</label>
                                <select
                                    name="rule-category"
                                    value={formData.expenseId}
                                    onChange={(e) => setFormData({ ...formData, expenseId: e.target.value })}
                                    className="w-full bg-surface-overlay border border-border-default rounded-lg px-3 py-2 text-white text-sm focus:border-positive-soft focus:outline-none"
                                >
                                    <option value="">Select category...</option>
                                    {expenses.map(exp => (
                                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-end gap-2">
                                <div className="flex items-center gap-2 text-sm text-content-default">
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, isRegex: !formData.isRegex })}
                                        className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${formData.isRegex ? 'bg-positive-solid' : 'bg-surface-hover'}`}
                                    >
                                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${formData.isRegex ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                                    </button>
                                    <span>Regex</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <Button
                                onClick={handleAddRule}
                                variant="positive"
                            >
                                Add Rule
                            </Button>
                            <Button
                                onClick={() => {
                                    setShowAddRule(false);
                                    setFormData({ pattern: '', expenseId: '', isRegex: false });
                                }}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                        </div>
                    </div>
                )}

                {/* Rules List */}
                {rules.length === 0 ? (
                    <div className="text-center py-8 text-content-subtle">
                        <p>No rules defined yet.</p>
                        <p className="text-sm mt-1">
                            Add rules to automatically categorize transactions when importing.
                        </p>
                    </div>
                ) : (
                    <div className="bg-surface-raised rounded-lg overflow-hidden text-sm">
                        <div className={`${RULE_GRID_COLS} border-b border-border-subtle`}>
                            <div className="text-left text-xs text-content-subtle font-medium px-3 py-2">Pattern</div>
                            <div className="text-left text-xs text-content-subtle font-medium px-3 py-2">Category</div>
                            <div className="text-right text-xs text-content-subtle font-medium px-3 py-2">Actions</div>
                        </div>
                        <List
                            rowComponent={RuleListRow}
                            rowCount={rules.length}
                            rowHeight={getRuleRowHeight}
                            rowProps={{
                                rules,
                                expenses,
                                editingId,
                                onEdit: handleEditStart,
                                onCancel: handleEditCancel,
                                onUpdate: handleUpdateRule,
                                onDelete: handleDeleteRule,
                            }}
                            style={{ height: Math.min(getRulesTotalHeight(rules, editingId), RULE_LIST_MAX_HEIGHT) }}
                        />
                    </div>
                )}
                </>}
            </div>

            {/* Saved Import Formats */}
            <div className="bg-surface-overlay rounded-xl p-4 border border-border-default">
                <button
                    onClick={() => setShowFormats(!showFormats)}
                    className="w-full flex items-center justify-between text-left"
                >
                    <div>
                        <h4 className="font-medium text-white">Saved Import Formats</h4>
                        <p className="text-sm text-content-muted mt-1">
                            {savedFormats.length} format{savedFormats.length !== 1 ? 's' : ''} saved
                        </p>
                    </div>
                    <svg
                        className={`w-4 h-4 text-content-muted transition-transform duration-200 ${showFormats ? 'rotate-0' : '-rotate-90'}`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                    >
                        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                </button>

                {showFormats && <>
                {savedFormats.length === 0 ? (
                    <div className="text-center py-8 text-content-subtle">
                        <p>No saved formats yet.</p>
                        <p className="text-sm mt-1">
                            Import a CSV to create one.
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {savedFormats.map(format => (
                            <div
                                key={format.id}
                                className="bg-surface-raised rounded-lg p-4 border border-border-default"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="font-medium text-white mb-1">
                                            {format.name}
                                        </div>
                                        <div className="text-sm text-content-muted mb-2">
                                            Columns: {format.fingerprint.headers.join(', ')}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-content-subtle">
                                            <span>
                                                Last used: {new Date(format.lastUsed).toLocaleDateString('en-US', {
                                                    month: 'short',
                                                    day: 'numeric',
                                                    year: 'numeric'
                                                })}
                                            </span>
                                            <span>
                                                {format.importCount} import{format.importCount !== 1 ? 's' : ''}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => handleDeleteFormat(format.id)}
                                        className="text-content-subtle hover:text-negative text-sm transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                </>}
            </div>

            {/* Info Section */}
            <div className="bg-info-tint/20 border border-info-strong/50 rounded-lg p-4">
                <h4 className="text-info font-medium mb-2">How Auto-categorization Works</h4>
                <ul className="text-sm text-content-default space-y-1">
                    <li>• Rules are matched against transaction descriptions (case-insensitive)</li>
                    <li>• Simple patterns match if the text appears anywhere in the description</li>
                    <li>• Enable "Regex" for advanced pattern matching (e.g., <code className="text-info">AMZN|AMAZON</code>)</li>
                    <li>• Rules are applied in order - first match wins</li>
                </ul>
            </div>
        </div>
    );
}

interface RuleRowExtraProps {
    rules: CategoryMapping[];
    expenses: AnyExpense[];
    editingId: string | null;
    onEdit: (id: string) => void;
    onCancel: () => void;
    onUpdate: (id: string, updates: Partial<CategoryMapping>) => void;
    onDelete: (id: string) => void;
}

function getRuleRowHeight(index: number, { rules, editingId }: RuleRowExtraProps): number {
    return rules[index]?.id === editingId ? RULE_EDIT_ROW_HEIGHT : RULE_ROW_HEIGHT;
}

function getRulesTotalHeight(rules: CategoryMapping[], editingId: string | null): number {
    const editing = editingId && rules.some(r => r.id === editingId);
    return rules.length * RULE_ROW_HEIGHT + (editing ? RULE_EDIT_ROW_HEIGHT - RULE_ROW_HEIGHT : 0);
}

function RuleListRow({
    index,
    style,
    rules,
    expenses,
    editingId,
    onEdit,
    onCancel,
    onUpdate,
    onDelete,
}: RowComponentProps<RuleRowExtraProps>) {
    const rule = rules[index];
    if (!rule) return null;

    const isEditing = rule.id === editingId;
    const expense = expenses.find(e => e.id === rule.expenseId);
    const borderClass = index < rules.length - 1 ? 'border-b border-border-subtle' : '';

    if (isEditing) {
        return (
            <div style={style} className={`hover:bg-surface-overlay/50 px-3 py-2 ${borderClass}`}>
                <EditRuleForm
                    rule={rule}
                    expenses={expenses}
                    onSave={(updates) => onUpdate(rule.id, updates)}
                    onCancel={onCancel}
                />
            </div>
        );
    }

    return (
        <div style={style} className={`${RULE_GRID_COLS} hover:bg-surface-overlay/50 ${borderClass}`}>
            <div className="px-3 py-1.5 min-w-0 truncate">
                <code className="text-positive text-xs">{rule.pattern}</code>
                {rule.isRegex && (
                    <span className="text-[10px] text-content-faint ml-1">regex</span>
                )}
            </div>
            <div className="px-3 py-1.5 text-content-muted min-w-0 truncate">
                {expense?.name || 'Unknown'}
            </div>
            <div className="px-3 py-1.5 text-right">
                <button
                    onClick={() => onEdit(rule.id)}
                    className="text-content-faint hover:text-content-default text-xs mr-2"
                >
                    Edit
                </button>
                <button
                    onClick={() => onDelete(rule.id)}
                    className="text-content-faint hover:text-negative text-xs"
                >
                    ×
                </button>
            </div>
        </div>
    );
}

// Edit rule inline form
function EditRuleForm({
    rule,
    expenses,
    onSave,
    onCancel,
}: {
    rule: CategoryMapping;
    expenses: AnyExpense[];
    onSave: (updates: Partial<CategoryMapping>) => void;
    onCancel: () => void;
}) {
    const [pattern, setPattern] = useState(rule.pattern);
    const [expenseId, setExpenseId] = useState(rule.expenseId);
    const [isRegex, setIsRegex] = useState(rule.isRegex || false);

    return (
        <div className="flex-1 flex items-center gap-3">
            <input
                type="text"
                name="edit-rule-pattern"
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="flex-1 bg-surface-overlay border border-border-default rounded px-2 py-1 text-white text-sm focus:border-positive-soft focus:outline-none"
            />
            <select
                name="edit-rule-category"
                value={expenseId}
                onChange={(e) => setExpenseId(e.target.value)}
                className="bg-surface-overlay border border-border-default rounded px-2 py-1 text-white text-sm focus:border-positive-soft focus:outline-none"
            >
                {expenses.map(exp => (
                    <option key={exp.id} value={exp.id}>{exp.name}</option>
                ))}
            </select>
            <div className="flex items-center gap-1.5 text-xs text-content-muted">
                <button
                    type="button"
                    onClick={() => setIsRegex(!isRegex)}
                    className={`relative inline-flex items-center h-4 rounded-full w-7 shrink-0 transition-colors duration-200 ${isRegex ? 'bg-positive-solid' : 'bg-surface-hover'}`}
                >
                    <span className={`inline-block w-2.5 h-2.5 transform bg-white rounded-full transition-transform duration-200 ${isRegex ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
                </button>
                <span>Regex</span>
            </div>
            <button
                onClick={() => onSave({ pattern, expenseId, isRegex })}
                className="px-2 py-1 bg-positive-solid hover:bg-positive-soft text-white rounded text-xs"
            >
                Save
            </button>
            <button
                onClick={onCancel}
                className="px-2 py-1 bg-surface-hover hover:bg-surface-muted text-white rounded text-xs"
            >
                Cancel
            </button>
        </div>
    );
}
