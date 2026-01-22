import { floatColumn } from 'react-datasheet-grid';

/**
 * Custom currency column for react-datasheet-grid that always shows 2 decimal places.
 * When focused, shows an editable input; when not focused, shows formatted value.
 */
export const currencyColumn = {
    ...floatColumn,
    component: function CurrencyCell({ rowData, setRowData, focus, stopEditing }: {
        rowData: number | null;
        setRowData: (value: number | null) => void;
        focus: boolean;
        stopEditing?: (options: { nextRow: boolean }) => void;
    }) {
        if (focus) {
            return (
                <input
                    className="dsg-input"
                    value={rowData ?? ''}
                    type="number"
                    step="0.01"
                    autoFocus
                    onChange={(e) => {
                        const val = e.target.value;
                        setRowData(val === '' ? null : parseFloat(val));
                    }}
                    onBlur={() => stopEditing?.({ nextRow: false })}
                />
            );
        }
        const displayValue = typeof rowData === 'number' ? rowData.toFixed(2) : '';
        return <span className="dsg-input dsg-input-align-right">{displayValue}</span>;
    },
};
