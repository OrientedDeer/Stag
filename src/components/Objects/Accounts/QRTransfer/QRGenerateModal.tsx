import { useMemo, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { compressData, exceedsQRLimit, createCompactBackup } from './qrUtils';
import { useModalAccessibility } from '../../../../hooks/useModalAccessibility';
import { Button } from "../../../Layout/Primitives";
import { WarningTriangleIcon } from '../../../Layout/Icons/WarningTriangleIcon';

interface FullBackup {
    version: number;
    accounts: unknown[];
    amountHistory: Record<string, unknown>;
    incomes: unknown[];
    expenses: unknown[];
    taxSettings: unknown;
    assumptions: unknown;
}

interface QRGenerateModalProps {
    isOpen: boolean;
    onClose: () => void;
    backupData: FullBackup;
}

export default function QRGenerateModal({ isOpen, onClose, backupData }: QRGenerateModalProps) {
    const qrRef = useRef<HTMLDivElement>(null);
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);

    const { compressed, sizeKB, exceedsLimit } = useMemo(() => {
        // Convert to compact format before compressing
        const compactData = createCompactBackup(backupData as Parameters<typeof createCompactBackup>[0]);
        const compressedData = compressData(compactData);
        return {
            compressed: compressedData,
            sizeKB: (compressedData.length / 1024).toFixed(1),
            exceedsLimit: exceedsQRLimit(compressedData)
        };
    }, [backupData]);

    const handleDownload = () => {
        const canvas = qrRef.current?.querySelector('canvas');
        if (!canvas) return;

        const pngUrl = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.href = pngUrl;
        downloadLink.download = `stag_qr_backup_${new Date().toISOString().split('T')[0]}.png`;
        downloadLink.click();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-2 sm:p-4">
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                onKeyDown={handleKeyDown}
                className="bg-surface-raised border border-border-default rounded-2xl shadow-2xl p-4 sm:p-8 w-full max-w-[90vw] sm:max-w-xl md:max-w-2xl"
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-4 border-b border-border-default pb-3">
                    <h3 className="text-lg sm:text-xl font-bold text-white">Share via QR Code</h3>
                    <button
                        onClick={onClose}
                        className="text-content-muted hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {exceedsLimit ? (
                    <div className="bg-warning-tint/30 border border-warning-strong/50 rounded-lg p-4 mb-4">
                        <div className="flex items-start gap-3">
                            <WarningTriangleIcon className="w-6 h-6 text-warning-bright shrink-0 mt-0.5" />
                            <div>
                                <h4 className="text-warning-bright font-semibold">Data Too Large for QR Code</h4>
                                <p className="text-warning-bright/80 text-sm mt-1">
                                    Your data is {sizeKB} KB (compressed), which exceeds the QR code limit.
                                    Please use the "Export Backup" button to save your data as a file instead.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* QR Code */}
                        <div ref={qrRef} className="flex justify-center p-3 sm:p-6 bg-white rounded-lg mb-4">
                            <QRCodeCanvas
                                value={compressed}
                                size={2048}
                                level="L"
                                style={{ maxWidth: '100%', height: 'auto' }}
                            />
                        </div>

                        {/* Data Size */}
                        <p className="text-content-muted text-sm text-center mb-2">
                            Data size: {sizeKB} KB (compressed)
                        </p>

                        {/* Instructions */}
                        <p className="text-content-default text-sm text-center mb-4">
                            Point another device's camera at this QR code to transfer your data.
                        </p>
                    </>
                )}

                {/* Buttons */}
                <div className="flex gap-3 justify-end">
                    {!exceedsLimit && (
                        <Button
                            onClick={handleDownload}
                            variant="secondary"
                        >
                            Download Image
                        </Button>
                    )}
                    <Button
                        onClick={onClose}
                        variant="positive"
                    >
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
}
