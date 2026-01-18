import { useMemo, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { compressData, exceedsQRLimit, createCompactBackup } from './qrUtils';

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
        const svg = qrRef.current?.querySelector('svg');
        if (!svg) return;

        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();

        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx?.drawImage(img, 0, 0);
            const pngUrl = canvas.toDataURL('image/png');
            const downloadLink = document.createElement('a');
            downloadLink.href = pngUrl;
            downloadLink.download = `stag_qr_backup_${new Date().toISOString().split('T')[0]}.png`;
            downloadLink.click();
        };

        img.src = 'data:image/svg+xml;base64,' + btoa(svgData);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
                {/* Header */}
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                    <h3 className="text-xl font-bold text-white">Share via QR Code</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {exceedsLimit ? (
                    <div className="bg-yellow-900/30 border border-yellow-700/50 rounded-lg p-4 mb-4">
                        <div className="flex items-start gap-3">
                            <svg className="w-6 h-6 text-yellow-300 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                                <h4 className="text-yellow-300 font-semibold">Data Too Large for QR Code</h4>
                                <p className="text-yellow-300/80 text-sm mt-1">
                                    Your data is {sizeKB} KB (compressed), which exceeds the QR code limit.
                                    Please use the "Export Backup" button to save your data as a file instead.
                                </p>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* QR Code */}
                        <div ref={qrRef} className="flex justify-center p-4 bg-white rounded-lg mb-4">
                            <QRCodeSVG
                                value={compressed}
                                size={256}
                                level="M"
                                includeMargin={true}
                            />
                        </div>

                        {/* Data Size */}
                        <p className="text-gray-400 text-sm text-center mb-2">
                            Data size: {sizeKB} KB (compressed)
                        </p>

                        {/* Instructions */}
                        <p className="text-gray-300 text-sm text-center mb-4">
                            Point another device's camera at this QR code to transfer your data.
                        </p>
                    </>
                )}

                {/* Buttons */}
                <div className="flex gap-3 justify-end">
                    {!exceedsLimit && (
                        <button
                            onClick={handleDownload}
                            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                        >
                            Download Image
                        </button>
                    )}
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
