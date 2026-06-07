import { formatMonthYear } from '../../../components/Objects/Budget/budgetUtils';

import { Button } from "../../../components/Layout/Primitives";
interface ClearAllDialogProps {
    transactionCount: number;
    selectedMonth: number;
    selectedYear: number;
    onConfirm: () => void;
    onCancel: () => void;
}

export function ClearAllDialog({
    transactionCount,
    selectedMonth,
    selectedYear,
    onConfirm,
    onCancel,
}: ClearAllDialogProps) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-surface-raised border border-border-default rounded-xl p-6 shadow-2xl max-w-sm w-full">
                <div className="flex items-start gap-4">
                    <div className="shrink-0 w-10 h-10 rounded-full bg-negative-tint/50 flex items-center justify-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-negative">
                            <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold text-white mb-2">Clear All Transactions?</h3>
                        <p className="text-sm text-content-muted">
                            This will delete all {transactionCount} transactions for {formatMonthYear(selectedMonth, selectedYear)}. This cannot be undone.
                        </p>
                    </div>
                </div>
                <div className="flex justify-end gap-3 mt-6">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-content-muted hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <Button
                        onClick={onConfirm}
                        variant="negative"
                    >
                        Delete All
                    </Button>
                </div>
            </div>
        </div>
    );
}
