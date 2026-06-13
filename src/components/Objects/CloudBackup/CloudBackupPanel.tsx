import { useContext, useState, useRef, useEffect } from 'react';
import { CloudBackupContext } from './CloudBackupContext';
import { useFileManager } from '../Accounts/useFileManager';
import { AccountDispatchContext } from '../Accounts/AccountContext';
import { IncomeDispatchContext } from '../Income/IncomeContext';
import { ExpenseDispatchContext } from '../Expense/ExpenseContext';
import { TaxContext } from '../../Objects/Taxes/TaxContext';
import { AssumptionsContext, defaultAssumptions, createBuiltinMilestones } from '../Assumptions/AssumptionsContext';
import { SimulationContext } from '../Assumptions/SimulationContext';
import { BudgetContext } from '../Budget/BudgetContext';
import PassphraseModal from './PassphraseModal';
import QRGenerateModal from '../Accounts/QRTransfer/QRGenerateModal';
import { jsonDateReplacer } from '../../../utils/formatters';
import QRScanModal from '../Accounts/QRTransfer/QRScanModal';
import { Button } from "../../Layout/Primitives";

interface CloudBackupPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function CloudBackupPanel({ isOpen, onClose }: CloudBackupPanelProps) {
    const {
        enabled,
        isAuthenticated,
        userEmail,
        lastBackupTimestamp,
        backupInProgress,
        restoreInProgress,
        checkingAuth,
        lastError,
        signIn,
        signOut,
        backup,
        restore,
        deleteCloudData,
        checkBackupStatus,
        clearError,
    } = useContext(CloudBackupContext);

    const { getBackupData, handleGlobalExport, handleGlobalImport } = useFileManager();
    const { dispatch: accountDispatch } = useContext(AccountDispatchContext);
    const incomeDispatch = useContext(IncomeDispatchContext);
    const expenseDispatch = useContext(ExpenseDispatchContext);
    const { dispatch: taxDispatch } = useContext(TaxContext);
    const { dispatch: assumptionsDispatch } = useContext(AssumptionsContext);
    const { dispatch: simulationDispatch } = useContext(SimulationContext);
    const { dispatch: budgetDispatch } = useContext(BudgetContext);

    const [passphraseMode, setPassphraseMode] = useState<'backup' | 'restore' | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
    const [showQRGenerate, setShowQRGenerate] = useState(false);
    const [showQRScan, setShowQRScan] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Check backup status on open when authenticated
    useEffect(() => {
        if (isOpen && isAuthenticated) {
            checkBackupStatus().catch(() => {});
        }
    }, [isOpen, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleBackup = async (passphrase: string) => {
        try {
            const data = getBackupData();
            const plaintext = JSON.stringify(data, jsonDateReplacer);
            await backup(plaintext, passphrase);
            setPassphraseMode(null);
            setSuccessMessage('Backup encrypted and uploaded successfully.');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch {
            setPassphraseMode(null);
        }
    };

    const handleRestore = async (passphrase: string) => {
        try {
            const plaintext = await restore(passphrase);
            handleGlobalImport(plaintext);
            setPassphraseMode(null);
            setSuccessMessage('Backup restored successfully.');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch {
            setPassphraseMode(null);
        }
    };

    const handleDeleteCloudData = async () => {
        try {
            await deleteCloudData();
            setConfirmDelete(false);
            setSuccessMessage('Cloud backup deleted.');
            setTimeout(() => setSuccessMessage(null), 5000);
        } catch {
            setConfirmDelete(false);
        }
    };

    const handleDeleteAllData = () => {
        accountDispatch({ type: 'SET_BULK_DATA', payload: { accounts: [], amountHistory: {} } });
        incomeDispatch({ type: 'SET_BULK_DATA', payload: { incomes: [] } });
        expenseDispatch({ type: 'SET_BULK_DATA', payload: { expenses: [] } });
        taxDispatch({ type: 'SET_STATUS', payload: 'Single' });
        assumptionsDispatch({ type: 'SET_BULK_DATA', payload: {
            ...defaultAssumptions,
            milestones: createBuiltinMilestones(new Date().getFullYear() - 24),
        }});
        simulationDispatch({ type: 'SET_SIMULATION', payload: [] });
        budgetDispatch({ type: 'SET_BULK_DATA', payload: { months: [] } });
        setConfirmDeleteAll(false);
        setSuccessMessage('All data deleted.');
        setTimeout(() => setSuccessMessage(null), 5000);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const result = event.target?.result;
            if (typeof result === 'string') {
                handleGlobalImport(result);
                setSuccessMessage('Backup imported successfully.');
                setTimeout(() => setSuccessMessage(null), 5000);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    const formatTimestamp = (ts: string) => {
        try {
            return new Date(ts).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
            });
        } catch {
            return ts;
        }
    };

    if (!isOpen) return null;

    const sectionHeader = "text-xs font-semibold text-content-subtle uppercase tracking-wider mb-2";
    const actionButton = "w-full flex items-center gap-2 px-3 py-2 bg-surface-overlay hover:bg-surface-input border border-border-default rounded-lg text-sm text-white transition-colors";

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />

            {/* Panel */}
            <div
                ref={panelRef}
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-96 bg-surface-raised border border-border-default rounded-xl shadow-2xl overflow-hidden"
            >
                {/* Header */}
                <div className="flex justify-between items-center px-4 py-3 border-b border-border-default">
                    <h3 className="text-sm font-semibold text-white">Data Management</h3>
                    <button onClick={onClose} className="text-content-muted hover:text-white transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                    {/* Success message */}
                    {successMessage && (
                        <div className="bg-positive-tint/20 border border-positive-strong/50 rounded-lg p-2">
                            <p className="text-positive text-sm">{successMessage}</p>
                        </div>
                    )}

                    {/* Error message */}
                    {lastError && (
                        <div className="bg-negative-tint/20 border border-negative-strong rounded-lg p-2">
                            <div className="flex justify-between items-start">
                                <p className="text-negative text-sm flex-1">{lastError}</p>
                                <button onClick={clearError} className="text-negative hover:text-negative-bright ml-2 shrink-0">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* === Local File Section === */}
                    <div>
                        <p className={sectionHeader}>Local File</p>
                        <div className="space-y-2">
                            <button onClick={handleGlobalExport} className={actionButton}>
                                <svg className="w-4 h-4 text-content-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                Export Backup
                            </button>
                            <button onClick={() => fileInputRef.current?.click()} className={actionButton}>
                                <svg className="w-4 h-4 text-content-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                Import Backup
                            </button>
                            <input
                                type="file"
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                accept=".json"
                                className="hidden"
                            />
                            {!confirmDeleteAll ? (
                                <button
                                    onClick={() => setConfirmDeleteAll(true)}
                                    className="w-full text-left text-negative hover:text-negative-bright text-xs transition-colors px-1"
                                >
                                    Delete Local Data
                                </button>
                            ) : (
                                <div className="bg-negative-tint/20 border border-negative-strong rounded-lg p-3">
                                    <p className="text-negative text-sm mb-2">Permanently delete all local data?</p>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleDeleteAllData}
                                            className="px-3 py-1 bg-negative-solid hover:bg-negative-soft text-white rounded text-sm font-medium transition-colors"
                                        >
                                            Delete Everything
                                        </button>
                                        <button
                                            onClick={() => setConfirmDeleteAll(false)}
                                            className="px-3 py-1 bg-surface-input hover:bg-surface-hover text-white rounded text-sm transition-colors"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* === QR Code Section === */}
                    <div>
                        <p className={sectionHeader}>QR Code</p>
                        <div className="space-y-2">
                            <button onClick={() => setShowQRGenerate(true)} className={actionButton}>
                                <svg className="w-4 h-4 text-content-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
                                </svg>
                                Share QR
                            </button>
                            <button onClick={() => setShowQRScan(true)} className={actionButton}>
                                <svg className="w-4 h-4 text-content-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                Scan QR
                            </button>
                        </div>
                    </div>

                    {/* === Cloud Backup Section === */}
                    <div>
                        <p className={sectionHeader}>Cloud Backup</p>

                        {!enabled ? (
                            <div className="bg-surface-overlay rounded-lg p-3">
                                <p className="text-content-subtle text-xs">Cloud backup is not configured. Set environment variables to enable.</p>
                            </div>
                        ) : checkingAuth ? (
                            <div className="flex items-center gap-2 py-3">
                                <svg className="w-4 h-4 animate-spin text-content-muted" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                                <span className="text-content-muted text-sm">Checking authentication...</span>
                            </div>
                        ) : !isAuthenticated ? (
                            <div className="space-y-2">
                                <div className="bg-info-tint/20 border border-info-strong/50 rounded-lg p-2">
                                    <p className="text-info text-xs">Encrypted on your device before upload. The server never sees your data.</p>
                                </div>
                                <button
                                    onClick={() => signIn()}
                                    className={actionButton}
                                >
                                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                                    </svg>
                                    Sign in with Google
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {/* User info */}
                                <div className="flex items-center gap-2 bg-surface-overlay rounded-lg p-2">
                                    <div className="w-6 h-6 bg-positive-solid/20 rounded-full flex items-center justify-center shrink-0">
                                        <svg className="w-3 h-3 text-positive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p className="text-white text-xs truncate flex-1">{userEmail}</p>
                                    <button onClick={signOut} className="text-content-subtle hover:text-content-default text-xs shrink-0">
                                        Sign out
                                    </button>
                                </div>

                                {/* Last backup timestamp */}
                                {lastBackupTimestamp && (
                                    <p className="text-content-subtle text-xs px-1">Last backup: {formatTimestamp(lastBackupTimestamp)}</p>
                                )}

                                {/* Cloud actions */}
                                <Button
                                    onClick={() => setPassphraseMode('backup')}
                                    disabled={backupInProgress || restoreInProgress}
                                    variant="positive" size="none" className="w-full px-3 py-2 disabled:bg-surface-hover text-sm flex items-center justify-center gap-2"
                                >
                                    {backupInProgress ? (
                                        <>
                                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                            </svg>
                                            Backing up...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                            </svg>
                                            Back Up to Cloud
                                        </>
                                    )}
                                </Button>

                                {lastBackupTimestamp && (
                                    <button
                                        onClick={() => setPassphraseMode('restore')}
                                        disabled={backupInProgress || restoreInProgress}
                                        className={actionButton + " justify-center"}
                                    >
                                        {restoreInProgress ? (
                                            <>
                                                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                                </svg>
                                                Restoring...
                                            </>
                                        ) : (
                                            <>
                                                <svg className="w-4 h-4 text-content-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                                                </svg>
                                                Restore from Cloud
                                            </>
                                        )}
                                    </button>
                                )}

                                {/* Delete cloud data */}
                                {lastBackupTimestamp && !confirmDelete && (
                                    <button
                                        onClick={() => setConfirmDelete(true)}
                                        className="w-full text-left text-negative hover:text-negative-bright text-xs transition-colors px-1"
                                    >
                                        Delete Cloud Data
                                    </button>
                                )}
                                {confirmDelete && (
                                    <div className="bg-negative-tint/20 border border-negative-strong rounded-lg p-3">
                                        <p className="text-negative text-sm mb-2">Permanently delete your cloud backup?</p>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleDeleteCloudData}
                                                className="px-3 py-1 bg-negative-solid hover:bg-negative-soft text-white rounded text-sm font-medium transition-colors"
                                            >
                                                Delete
                                            </button>
                                            <button
                                                onClick={() => setConfirmDelete(false)}
                                                className="px-3 py-1 bg-surface-input hover:bg-surface-hover text-white rounded text-sm transition-colors"
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Passphrase Modal */}
            <PassphraseModal
                isOpen={passphraseMode !== null}
                onClose={() => setPassphraseMode(null)}
                onSubmit={passphraseMode === 'backup' ? handleBackup : handleRestore}
                mode={passphraseMode || 'backup'}
                loading={backupInProgress || restoreInProgress}
            />

            {/* QR Modals */}
            <QRGenerateModal
                isOpen={showQRGenerate}
                onClose={() => setShowQRGenerate(false)}
                backupData={getBackupData()}
            />
            <QRScanModal
                isOpen={showQRScan}
                onClose={() => setShowQRScan(false)}
                onImport={handleGlobalImport}
            />
        </>
    );
}
