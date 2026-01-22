import { useContext, useState, useCallback } from 'react';
import { BudgetContext, CategoryMapping } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';

export default function SettingsTab() {
    const { importSettings, dispatch } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

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
        dispatch({ type: 'APPLY_CATEGORY_RULE', payload: newRule });

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

    const handleDeleteFormat = useCallback((id: string) => {
        dispatch({ type: 'DELETE_CSV_FORMAT', payload: { id } });
    }, [dispatch]);

    const handleReapplyAllRules = useCallback(() => {
        // Apply each rule to all uncategorized transactions
        importSettings.categoryMappings.forEach(rule => {
            dispatch({ type: 'APPLY_CATEGORY_RULE', payload: rule });
        });
    }, [dispatch, importSettings.categoryMappings]);

    const rules = importSettings.categoryMappings;
    const savedFormats = importSettings.savedCSVFormats || [];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h3 className="text-lg font-semibold text-white">Budget Settings</h3>
                <p className="text-sm text-gray-400 mt-1">
                    Configure auto-categorization rules and import settings.
                </p>
            </div>

            {/* Auto-categorization Rules */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h4 className="font-medium text-white">Auto-categorization Rules</h4>
                        <p className="text-sm text-gray-400 mt-1">
                            Define patterns to automatically categorize imported transactions.
                        </p>
                    </div>
                    <div className="flex gap-2">
                        {rules.length > 0 && (
                            <button
                                onClick={handleReapplyAllRules}
                                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded-lg text-sm font-medium transition-colors"
                            >
                                Re-apply All
                            </button>
                        )}
                        <button
                            onClick={() => setShowAddRule(true)}
                            className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Add Rule
                        </button>
                    </div>
                </div>

                {/* Add Rule Form */}
                {showAddRule && (
                    <div className="bg-gray-900 rounded-lg p-4 mb-4 border border-gray-700">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Pattern</label>
                                <input
                                    type="text"
                                    placeholder="e.g., AMAZON, NETFLIX"
                                    value={formData.pattern}
                                    onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-gray-400 mb-1">Category</label>
                                <select
                                    value={formData.expenseId}
                                    onChange={(e) => setFormData({ ...formData, expenseId: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:border-green-500 focus:outline-none"
                                >
                                    <option value="">Select category...</option>
                                    {expenses.map(exp => (
                                        <option key={exp.id} value={exp.id}>{exp.name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="flex items-end gap-2">
                                <div className="flex items-center gap-2 text-sm text-gray-300">
                                    <button
                                        type="button"
                                        onClick={() => setFormData({ ...formData, isRegex: !formData.isRegex })}
                                        className={`relative inline-flex items-center h-5 rounded-full w-9 shrink-0 transition-colors duration-200 ${formData.isRegex ? 'bg-green-600' : 'bg-gray-600'}`}
                                    >
                                        <span className={`inline-block w-3.5 h-3.5 transform bg-white rounded-full transition-transform duration-200 ${formData.isRegex ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                                    </button>
                                    <span>Regex</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex gap-2 mt-4">
                            <button
                                onClick={handleAddRule}
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                Add Rule
                            </button>
                            <button
                                onClick={() => {
                                    setShowAddRule(false);
                                    setFormData({ pattern: '', expenseId: '', isRegex: false });
                                }}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                )}

                {/* Rules List */}
                {rules.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        <p>No rules defined yet.</p>
                        <p className="text-sm mt-1">
                            Add rules to automatically categorize transactions when importing.
                        </p>
                    </div>
                ) : (
                    <div className="bg-gray-900 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-800">
                                    <th className="text-left text-xs text-gray-500 font-medium px-3 py-2">Pattern</th>
                                    <th className="text-left text-xs text-gray-500 font-medium px-3 py-2">Category</th>
                                    <th className="text-right text-xs text-gray-500 font-medium px-3 py-2 w-20">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                                {rules.map(rule => {
                                    const expense = expenses.find(e => e.id === rule.expenseId);
                                    const isEditing = editingId === rule.id;

                                    return (
                                        <tr key={rule.id} className="hover:bg-gray-800/50">
                                            {isEditing ? (
                                                <td colSpan={3} className="px-3 py-2">
                                                    <EditRuleForm
                                                        rule={rule}
                                                        expenses={expenses}
                                                        onSave={(updates) => handleUpdateRule(rule.id, updates)}
                                                        onCancel={() => setEditingId(null)}
                                                    />
                                                </td>
                                            ) : (
                                                <>
                                                    <td className="px-3 py-1.5">
                                                        <code className="text-green-400 text-xs">{rule.pattern}</code>
                                                        {rule.isRegex && (
                                                            <span className="text-[10px] text-gray-600 ml-1">regex</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-gray-400">
                                                        {expense?.name || 'Unknown'}
                                                    </td>
                                                    <td className="px-3 py-1.5 text-right">
                                                        <button
                                                            onClick={() => setEditingId(rule.id)}
                                                            className="text-gray-600 hover:text-gray-300 text-xs mr-2"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteRule(rule.id)}
                                                            className="text-gray-600 hover:text-red-400 text-xs"
                                                        >
                                                            ×
                                                        </button>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Saved Import Formats */}
            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="mb-4">
                    <h4 className="font-medium text-white">Saved Import Formats</h4>
                    <p className="text-sm text-gray-400 mt-1">
                        Previously used CSV formats are automatically recognized.
                    </p>
                </div>

                {savedFormats.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
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
                                className="bg-gray-900 rounded-lg p-4 border border-gray-700"
                            >
                                <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                        <div className="font-medium text-white mb-1">
                                            {format.name}
                                        </div>
                                        <div className="text-sm text-gray-400 mb-2">
                                            Columns: {format.fingerprint.headers.join(', ')}
                                        </div>
                                        <div className="flex items-center gap-4 text-xs text-gray-500">
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
                                        className="text-gray-500 hover:text-red-400 text-sm transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Info Section */}
            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
                <h4 className="text-blue-400 font-medium mb-2">How Auto-categorization Works</h4>
                <ul className="text-sm text-gray-300 space-y-1">
                    <li>• Rules are matched against transaction descriptions (case-insensitive)</li>
                    <li>• Simple patterns match if the text appears anywhere in the description</li>
                    <li>• Enable "Regex" for advanced pattern matching (e.g., <code className="text-blue-400">AMZN|AMAZON</code>)</li>
                    <li>• Rules are applied in order - first match wins</li>
                </ul>
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
    expenses: any[];
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
                value={pattern}
                onChange={(e) => setPattern(e.target.value)}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:border-green-500 focus:outline-none"
            />
            <select
                value={expenseId}
                onChange={(e) => setExpenseId(e.target.value)}
                className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-sm focus:border-green-500 focus:outline-none"
            >
                {expenses.map(exp => (
                    <option key={exp.id} value={exp.id}>{exp.name}</option>
                ))}
            </select>
            <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <button
                    type="button"
                    onClick={() => setIsRegex(!isRegex)}
                    className={`relative inline-flex items-center h-4 rounded-full w-7 shrink-0 transition-colors duration-200 ${isRegex ? 'bg-green-600' : 'bg-gray-600'}`}
                >
                    <span className={`inline-block w-2.5 h-2.5 transform bg-white rounded-full transition-transform duration-200 ${isRegex ? 'translate-x-[14px]' : 'translate-x-0.5'}`} />
                </button>
                <span>Regex</span>
            </div>
            <button
                onClick={() => onSave({ pattern, expenseId, isRegex })}
                className="px-2 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-xs"
            >
                Save
            </button>
            <button
                onClick={onCancel}
                className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs"
            >
                Cancel
            </button>
        </div>
    );
}
