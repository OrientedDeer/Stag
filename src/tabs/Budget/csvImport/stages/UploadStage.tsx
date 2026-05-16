import React, { useState, useCallback } from 'react';
import type { Dispatch } from 'react';
import type { SavedCSVMapping } from '../../../../components/Objects/Budget/BudgetContext';
import type { CSVImportAction } from '../csvImportReducer';

interface UploadStageProps {
    dispatch: Dispatch<CSVImportAction>;
    processFile: (content: string) => void;
    savedCSVFormats: SavedCSVMapping[];
}

export const UploadStage: React.FC<UploadStageProps> = ({
    dispatch,
    processFile,
    savedCSVFormats,
}) => {
    const [isDragging, setIsDragging] = useState(false);

    const readFile = useCallback(
        (file: File) => {
            const reader = new FileReader();
            reader.onload = (event) => {
                const content = event.target?.result as string;
                processFile(content);
            };
            reader.onerror = () => dispatch({ type: 'SET_ERROR', error: 'Failed to read file.' });
            reader.readAsText(file);
        },
        [dispatch, processFile]
    );

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            setIsDragging(false);
            dispatch({ type: 'CLEAR_ERROR' });

            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (!file.name.toLowerCase().endsWith('.csv')) {
                dispatch({ type: 'SET_ERROR', error: 'Please upload a CSV file.' });
                return;
            }
            readFile(file);
        },
        [dispatch, readFile]
    );

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0];
            if (!file) return;
            dispatch({ type: 'CLEAR_ERROR' });
            readFile(file);
        },
        [dispatch, readFile]
    );

    return (
        <div>
            <div
                onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`
                    border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer
                    ${isDragging ? 'border-green-500 bg-green-500/10' : 'border-gray-700 hover:border-gray-500'}
                `}
                onClick={() => document.getElementById('csv-file-input')?.click()}
            >
                <input
                    id="csv-file-input"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileSelect}
                    className="hidden"
                />
                <div className="text-gray-400 mb-2">
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="48"
                        height="48"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        viewBox="0 0 24 24"
                        className="mx-auto mb-4"
                    >
                        <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <p className="text-lg font-medium">Drop CSV file here or click to browse</p>
                </div>
                <p className="text-gray-500 text-sm mt-2">
                    Supported: Chase, Checking, Bank of America, or any CSV
                </p>
            </div>

            {savedCSVFormats.length > 0 && (
                <div className="mt-6">
                    <p className="text-sm text-gray-400 mb-2">
                        Previously recognized formats:{' '}
                        {savedCSVFormats.map((f) => f.name).join(', ')}
                    </p>
                </div>
            )}
        </div>
    );
};
