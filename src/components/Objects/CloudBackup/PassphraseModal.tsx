import { useState } from 'react';
import { useModalAccessibility } from '../../../hooks/useModalAccessibility';

interface PassphraseModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (passphrase: string) => void;
    mode: 'backup' | 'restore';
    loading?: boolean;
}

export default function PassphraseModal({ isOpen, onClose, onSubmit, mode, loading }: PassphraseModalProps) {
    const { modalRef, handleKeyDown } = useModalAccessibility(isOpen, onClose);
    const [passphrase, setPassphrase] = useState('');
    const [showPassphrase, setShowPassphrase] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const isBackup = mode === 'backup';
    const title = isBackup ? 'Encrypt & Back Up' : 'Decrypt & Restore';
    const description = isBackup
        ? 'Enter a passphrase to encrypt your data before uploading. You will need this passphrase to restore your backup.'
        : 'Enter the passphrase you used when creating this backup.';

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!passphrase) {
            setError('Passphrase is required.');
            return;
        }
        setError('');
        onSubmit(passphrase);
    };

    const handleClose = () => {
        setPassphrase('');
        setError('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div
                ref={modalRef}
                onKeyDown={handleKeyDown}
                className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 w-full max-w-md"
            >
                {/* Header */}
                <div className="flex justify-between items-center mb-4 border-b border-gray-700 pb-3">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        {title}
                    </h3>
                    <button
                        onClick={handleClose}
                        className="text-gray-400 hover:text-white transition-colors"
                        disabled={loading}
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Description */}
                <p className="text-gray-400 text-sm mb-4">{description}</p>

                {/* Trust message */}
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 mb-4">
                    <p className="text-blue-400 text-xs">
                        Your passphrase never leaves your device. It is used to derive an encryption key locally and then discarded.
                    </p>
                </div>

                {/* Passphrase input */}
                <form onSubmit={handleSubmit} className="space-y-3">
                    <div>
                        <label className="block text-sm text-gray-300 mb-1">Passphrase</label>
                        <div className="relative">
                            <input
                                type={showPassphrase ? 'text' : 'password'}
                                value={passphrase}
                                onChange={e => setPassphrase(e.target.value)}
                                placeholder="Enter a strong passphrase"
                                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 pr-10"
                                autoFocus
                                disabled={loading}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassphrase(!showPassphrase)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                tabIndex={-1}
                            >
                                {showPassphrase ? (
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-900/20 border border-red-800 rounded-lg p-2">
                            <p className="text-red-400 text-sm">{error}</p>
                        </div>
                    )}

                {/* Buttons */}
                <div className="flex gap-3 justify-end mt-5">
                    <button
                        type="button"
                        onClick={handleClose}
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
                        disabled={loading}
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={loading || !passphrase}
                        className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                    >
                        {loading && (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                        )}
                        {loading ? (isBackup ? 'Encrypting...' : 'Decrypting...') : (isBackup ? 'Encrypt & Upload' : 'Download & Decrypt')}
                    </button>
                </div>
                </form>
            </div>
        </div>
    );
}
