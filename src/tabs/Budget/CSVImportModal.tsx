import React, { useReducer, useCallback, useContext, useMemo } from 'react';
import { BudgetContext } from '../../components/Objects/Budget/BudgetContext';
import { ExpenseContext } from '../../components/Objects/Expense/ExpenseContext';
import { useModalAccessibility } from '../../hooks/useModalAccessibility';
import {
    csvImportReducer,
    initialCSVImportState,
} from './csvImport/csvImportReducer';
import { useCSVImportFlow } from './csvImport/useCSVImportFlow';
import { UploadStage } from './csvImport/stages/UploadStage';
import { MappingStage } from './csvImport/stages/MappingStage';
import { PreviewStage } from './csvImport/stages/PreviewStage';
import { ResultStage } from './csvImport/stages/ResultStage';
import { Panel } from "../../components/Layout/Primitives";

interface CSVImportModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CSVImportModal: React.FC<CSVImportModalProps> = ({ isOpen, onClose }) => {
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    const {
        dispatch: budgetDispatch,
        getOrCreateMonth,
        selectedMonth,
        selectedYear,
        importSettings,
        months,
    } = useContext(BudgetContext);
    const { expenses } = useContext(ExpenseContext);

    const [state, dispatch] = useReducer(csvImportReducer, initialCSVImportState);

    const existingTransactions = useMemo(() => {
        const snapshot = months.find((m) => m.month === selectedMonth && m.year === selectedYear);
        return snapshot?.transactions || [];
    }, [months, selectedMonth, selectedYear]);

    const actions = useCSVImportFlow({
        state,
        dispatch,
        importSettings,
        existingTransactions,
        budgetDispatch,
        getOrCreateMonth,
    });

    const handleClose = useCallback(() => {
        dispatch({ type: 'RESET' });
        onClose();
    }, [onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="csv-import-modal-title"
                className="bg-surface-raised border border-border-subtle rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto text-white w-full max-w-2xl"
                onKeyDown={handleKeyDown}
            >
                {/* Header */}
                <Panel padding="none" className="sticky top-0 border-b px-6 py-4 flex items-center justify-between">
                    <h2 id="csv-import-modal-title" className="text-xl font-bold text-white">
                        Import Transactions
                    </h2>
                    <button
                        onClick={handleClose}
                        className="text-content-muted hover:text-white transition-colors p-1"
                        aria-label="Close"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            viewBox="0 0 24 24"
                        >
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                </Panel>

                <div className="p-6">
                    {state.error && (
                        <div className="mb-4 bg-negative-tint/20 border border-negative-strong rounded-lg p-3 text-negative text-sm">
                            {state.error}
                        </div>
                    )}

                    {state.stage === 'upload' && (
                        <UploadStage
                            dispatch={dispatch}
                            processFile={actions.processFile}
                            savedCSVFormats={importSettings.savedCSVFormats}
                        />
                    )}

                    {state.stage === 'mapping' && state.csvContent && (
                        <MappingStage
                            csvContent={state.csvContent}
                            mapping={state.mapping}
                            options={state.options}
                            useDebitCredit={state.useDebitCredit}
                            formatName={state.formatName}
                            saveFormat={state.saveFormat}
                            dispatch={dispatch}
                            applyMappingAndPreview={actions.applyMappingAndPreview}
                        />
                    )}

                    {state.stage === 'preview' && (
                        <PreviewStage
                            transactions={state.transactions}
                            duplicates={state.duplicates}
                            autoCategorizedCount={state.autoCategorizedCount}
                            matchedFormat={state.matchedFormat}
                            matchConfidence={state.matchConfidence}
                            dispatch={dispatch}
                            handleImport={actions.handleImport}
                        />
                    )}

                    {state.stage === 'result' && (
                        <ResultStage
                            transactions={state.transactions}
                            duplicates={state.duplicates}
                            autoCategorizedCount={state.autoCategorizedCount}
                            expenses={expenses}
                            onClose={handleClose}
                        />
                    )}
                </div>
            </div>
        </div>
    );
};

export default CSVImportModal;
