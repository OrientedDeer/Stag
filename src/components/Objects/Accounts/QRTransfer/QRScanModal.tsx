import { useState, useCallback } from 'react';
import { Scanner, type IDetectedBarcode } from '@yudiel/react-qr-scanner';
import { decompressData, validatePayload, isCompactFormat, expandCompactBackup } from './qrUtils';
import { useModalAccessibility } from '../../../../hooks/useModalAccessibility';
import { Button } from "../../../Layout/Primitives";

interface ParsedData {
    version: number;
    accounts: unknown[];
    amountHistory: Record<string, unknown>;
    incomes: unknown[];
    expenses: unknown[];
    taxSettings: unknown;
    assumptions: unknown;
}

interface QRScanModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (jsonString: string) => void;
}

type ScanStatus = 'scanning' | 'success' | 'error';

export default function QRScanModal({ isOpen, onClose, onImport }: QRScanModalProps) {
    const [status, setStatus] = useState<ScanStatus>('scanning');
    const [errorMessage, setErrorMessage] = useState<string>('');
    const [parsedData, setParsedData] = useState<ParsedData | null>(null);
    const [rawJson, setRawJson] = useState<string>('');
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const handleScan = useCallback((detectedCodes: IDetectedBarcode[]) => {
        if (detectedCodes.length === 0 || status !== 'scanning') return;

        const scannedData = detectedCodes[0].rawValue;

        try {
            let decompressed = decompressData(scannedData);

            // Expand compact format if detected
            if (isCompactFormat(decompressed)) {
                decompressed = expandCompactBackup(decompressed);
            }

            if (!validatePayload(decompressed)) {
                setStatus('error');
                setErrorMessage('Invalid backup format. The QR code does not contain valid backup data.');
                return;
            }

            const json = JSON.stringify(decompressed);
            setRawJson(json);
            setParsedData(decompressed as ParsedData);
            setStatus('success');
        } catch {
            setStatus('error');
            setErrorMessage('Failed to decode QR data. The QR code may be corrupted or not from this app.');
        }
    }, [status]);

    const handleError = useCallback((error: unknown) => {
        if (error instanceof Error && error.name === 'NotAllowedError') {
            setStatus('error');
            setErrorMessage('Camera access denied. Please allow camera access in your browser settings.');
        }
    }, []);

    const handleImportClick = () => {
        if (rawJson) {
            onImport(rawJson);
            handleClose();
        }
    };

    const handleClose = () => {
        setStatus('scanning');
        setErrorMessage('');
        setParsedData(null);
        setRawJson('');
        onClose();
    };

    const handleRetry = () => {
        setStatus('scanning');
        setErrorMessage('');
        setParsedData(null);
        setRawJson('');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                onKeyDown={handleKeyDown}
                className="bg-surface-raised border border-border-default rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4"
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-4 border-b border-border-default pb-3">
                    <h3 className="text-xl font-bold text-white">Scan QR Code</h3>
                    <button
                        onClick={handleClose}
                        className="text-content-muted hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {status === 'scanning' && (
                    <>
                        {/* Camera Viewport */}
                        <div className="rounded-lg overflow-hidden mb-4 bg-black aspect-square">
                            <Scanner
                                onScan={handleScan}
                                onError={handleError}
                                formats={['qr_code']}
                                sound={false}
                                styles={{
                                    container: { width: '100%', height: '100%' },
                                    video: { width: '100%', height: '100%', objectFit: 'cover' }
                                }}
                            />
                        </div>
                        <p className="text-content-muted text-sm text-center">
                            Point your camera at a QR code generated by this app.
                        </p>
                    </>
                )}

                {status === 'error' && (
                    <div className="bg-negative-tint/20 border border-negative-strong rounded-lg p-4 mb-4">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-negative shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div>
                                <h4 className="text-negative font-semibold">Scan Failed</h4>
                                <p className="text-negative/80 text-sm mt-1">{errorMessage}</p>
                            </div>
                        </div>
                    </div>
                )}

                {status === 'success' && parsedData && (
                    <div className="bg-positive-tint/20 border border-positive-strong rounded-lg p-4 mb-4">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-positive shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <div>
                                <h4 className="text-positive font-semibold">Data Received!</h4>
                                <ul className="text-content-default text-sm mt-2 space-y-1">
                                    <li>• {parsedData.accounts.length} account{parsedData.accounts.length !== 1 ? 's' : ''}</li>
                                    <li>• {parsedData.incomes.length} income source{parsedData.incomes.length !== 1 ? 's' : ''}</li>
                                    <li>• {parsedData.expenses.length} expense{parsedData.expenses.length !== 1 ? 's' : ''}</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 justify-end mt-4">
                    {status === 'scanning' && (
                        <Button
                            onClick={handleClose}
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                    )}

                    {status === 'error' && (
                        <>
                            <Button
                                onClick={handleClose}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleRetry}
                                variant="positive"
                            >
                                Try Again
                            </Button>
                        </>
                    )}

                    {status === 'success' && (
                        <>
                            <Button
                                onClick={handleClose}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleImportClick}
                                variant="positive"
                            >
                                Import Data
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
