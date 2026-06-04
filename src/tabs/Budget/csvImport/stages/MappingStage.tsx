import React, { useMemo } from 'react';
import type { Dispatch } from 'react';
import { DropdownInput } from '../../../../components/Layout/InputFields/DropdownInput';
import { ToggleInput } from '../../../../components/Layout/InputFields/ToggleInput';
import { NameInput } from '../../../../components/Layout/InputFields/NameInput';
import type { ParsedCSV, CSVMapping, CSVImportOptions } from '../../../../services/CSVImportService';
import type { CSVImportAction } from '../csvImportReducer';

interface MappingStageProps {
    csvContent: ParsedCSV;
    mapping: Partial<CSVMapping>;
    options: Partial<CSVImportOptions>;
    useDebitCredit: boolean;
    formatName: string;
    saveFormat: boolean;
    dispatch: Dispatch<CSVImportAction>;
    applyMappingAndPreview: () => void;
}

export const MappingStage: React.FC<MappingStageProps> = ({
    csvContent,
    mapping,
    options,
    useDebitCredit,
    formatName,
    saveFormat,
    dispatch,
    applyMappingAndPreview,
}) => {
    const columnOptions = useMemo(
        () =>
            csvContent.headers.map((header, index) => ({
                value: String(index),
                label: header || `Column ${index + 1}`,
            })),
        [csvContent.headers]
    );

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-semibold mb-4">Map Your CSV Columns</h3>

                {/* Preview Table */}
                <div className="overflow-x-auto mb-6">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-gray-700">
                                {csvContent.headers.map((header, i) => (
                                    <th
                                        key={i}
                                        className="text-left px-2 py-2 text-gray-400 font-medium"
                                    >
                                        {header}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {csvContent.rows.slice(0, 3).map((row, rowIndex) => (
                                <tr key={rowIndex} className="border-b border-gray-800">
                                    {row.map((cell, cellIndex) => (
                                        <td
                                            key={cellIndex}
                                            className="px-2 py-2 text-gray-300 truncate max-w-37.5"
                                        >
                                            {cell || '-'}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Column Mapping */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <DropdownInput
                        id="date-column"
                        label="Date Column"
                        value={mapping.dateColumn !== undefined ? String(mapping.dateColumn) : ''}
                        onChange={(val) =>
                            dispatch({
                                type: 'UPDATE_MAPPING',
                                mapping: { dateColumn: parseInt(val, 10) },
                            })
                        }
                        options={columnOptions}
                    />
                    <DropdownInput
                        id="desc-column"
                        label="Description Column"
                        value={
                            mapping.descriptionColumn !== undefined
                                ? String(mapping.descriptionColumn)
                                : ''
                        }
                        onChange={(val) =>
                            dispatch({
                                type: 'UPDATE_MAPPING',
                                mapping: { descriptionColumn: parseInt(val, 10) },
                            })
                        }
                        options={columnOptions}
                    />

                    <div className="col-span-full">
                        <ToggleInput
                            id="use-debit-credit"
                            label="Separate Debit/Credit Columns"
                            enabled={useDebitCredit}
                            setEnabled={(val) =>
                                dispatch({ type: 'SET_USE_DEBIT_CREDIT', value: val })
                            }
                            tooltip="Enable if your CSV has separate columns for debits and credits instead of a single amount column"
                        />
                    </div>

                    {useDebitCredit ? (
                        <>
                            <DropdownInput
                                id="debit-column"
                                label="Debit Column"
                                value={
                                    mapping.debitColumn !== undefined
                                        ? String(mapping.debitColumn)
                                        : ''
                                }
                                onChange={(val) =>
                                    dispatch({
                                        type: 'UPDATE_MAPPING',
                                        mapping: { debitColumn: parseInt(val, 10) },
                                    })
                                }
                                options={columnOptions}
                            />
                            <DropdownInput
                                id="credit-column"
                                label="Credit Column"
                                value={
                                    mapping.creditColumn !== undefined
                                        ? String(mapping.creditColumn)
                                        : ''
                                }
                                onChange={(val) =>
                                    dispatch({
                                        type: 'UPDATE_MAPPING',
                                        mapping: { creditColumn: parseInt(val, 10) },
                                    })
                                }
                                options={columnOptions}
                            />
                        </>
                    ) : (
                        <>
                            <DropdownInput
                                id="amount-column"
                                label="Amount Column"
                                value={
                                    mapping.amountColumn !== undefined
                                        ? String(mapping.amountColumn)
                                        : ''
                                }
                                onChange={(val) =>
                                    dispatch({
                                        type: 'UPDATE_MAPPING',
                                        mapping: { amountColumn: parseInt(val, 10) },
                                    })
                                }
                                options={columnOptions}
                            />
                            <DropdownInput
                                id="transaction-type-column"
                                label="Transaction Type Column"
                                value={
                                    mapping.transactionTypeColumn !== undefined
                                        ? String(mapping.transactionTypeColumn)
                                        : '__NONE__'
                                }
                                onChange={(val) =>
                                    dispatch({
                                        type: 'UPDATE_MAPPING',
                                        mapping: {
                                            transactionTypeColumn:
                                                val === '__NONE__' ? undefined : parseInt(val, 10),
                                        },
                                    })
                                }
                                options={[
                                    { value: '__NONE__', label: 'None (use amount sign)' },
                                    ...columnOptions,
                                ]}
                                tooltip="Optional: Column that says Credit or Debit (e.g., Capital One)"
                            />
                        </>
                    )}

                    {!useDebitCredit && mapping.transactionTypeColumn === undefined && (
                        <ToggleInput
                            id="negative-expense"
                            label="Negative = Expense"
                            enabled={options.negativeIsExpense ?? true}
                            setEnabled={(val) =>
                                dispatch({
                                    type: 'UPDATE_OPTIONS',
                                    options: { negativeIsExpense: val },
                                })
                            }
                            tooltip="Check if negative amounts represent expenses (common for bank statements)"
                        />
                    )}
                </div>

                {/* Save Format Option */}
                <div className="mt-6 pt-4 border-t border-gray-800">
                    <ToggleInput
                        id="save-format"
                        label="Remember this mapping for future imports"
                        enabled={saveFormat}
                        setEnabled={(val) => dispatch({ type: 'SET_SAVE_FORMAT', value: val })}
                    />
                    {saveFormat && (
                        <div className="mt-3">
                            <NameInput
                                id="format-name"
                                label="Format Name"
                                value={formatName}
                                onChange={(val) =>
                                    dispatch({ type: 'SET_FORMAT_NAME', value: val })
                                }
                                placeholder="e.g., Chase Checking"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3">
                <button
                    onClick={() => dispatch({ type: 'BACK_TO_UPLOAD' })}
                    className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                    Back
                </button>
                <button
                    onClick={applyMappingAndPreview}
                    className="px-5 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                >
                    Preview Import
                </button>
            </div>
        </div>
    );
};
