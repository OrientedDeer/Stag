import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CloudBackupContext } from './CloudBackupContext';
import { useFileManager } from '../Accounts/useFileManager';
import PassphraseModal from './PassphraseModal';

async function sha256Hex(text: string): Promise<string> {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const DISMISS_KEY = 'cloud_backup_sync_dismissed';

export default function CloudBackupSync() {
    const {
        enabled,
        isAuthenticated,
        checkingAuth,
        linkedEmail,
        lastBackupHash,
        currentDataHash,
        updateCurrentDataHash,
        signIn,
        clearLinkedEmail,
        justSignedIn,
        clearJustSignedIn,
        restore,
        restoreInProgress,
        checkBackupStatus,
    } = useContext(CloudBackupContext);

    const { getBackupData, handleGlobalImport } = useFileManager();
    const [restorePromptOpen, setRestorePromptOpen] = useState(false);
    const restorePromptHandledRef = useRef(false);

    const [dismissed, setDismissed] = useState<boolean>(() => {
        try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
    });

    // Serialize current backup payload. We only do this work when cloud backup is
    // active for this dataset, so the cost is paid only by users who opted in.
    const serialized = useMemo(() => {
        if (!enabled) return null;
        if (!isAuthenticated && !linkedEmail) return null;
        try {
            return JSON.stringify(getBackupData());
        } catch {
            return null;
        }
    }, [enabled, isAuthenticated, linkedEmail, getBackupData]);

    // Hash on data changes, debounced. Captures the rest state of an edit burst.
    useEffect(() => {
        if (!serialized) return;
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const hash = await sha256Hex(serialized);
                if (!cancelled) updateCurrentDataHash(hash);
            } catch { /* ignore */ }
        }, 400);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [serialized, updateCurrentDataHash]);

    // After OAuth callback completes, if a cloud backup exists, prompt to restore.
    // Ref guard ensures we only run this once per session — clearing justSignedIn
    // would otherwise re-trigger the effect's cleanup and abort the in-flight check.
    useEffect(() => {
        if (!justSignedIn || restorePromptHandledRef.current) return;
        restorePromptHandledRef.current = true;
        clearJustSignedIn();
        checkBackupStatus().then(meta => {
            if (meta.exists) setRestorePromptOpen(true);
        }).catch(() => {});
    }, [justSignedIn, clearJustSignedIn, checkBackupStatus]);

    const handleRestore = async (passphrase: string) => {
        try {
            const plaintext = await restore(passphrase);
            handleGlobalImport(plaintext);
            setRestorePromptOpen(false);
        } catch {
            // Error is surfaced via lastError in the modal; keep it open so they can retry.
        }
    };

    // Warn on tab close if signed in and local data differs from the last backup
    // (or no backup has been made yet).
    useEffect(() => {
        if (!isAuthenticated) return;
        const handler = (e: BeforeUnloadEvent) => {
            const dirty = !lastBackupHash || (currentDataHash !== null && currentDataHash !== lastBackupHash);
            if (dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [isAuthenticated, lastBackupHash, currentDataHash]);

    const handleDismiss = () => {
        try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* ignore */ }
        setDismissed(true);
    };

    const handleForget = () => {
        clearLinkedEmail();
    };

    const showPrompt = enabled && !checkingAuth && !isAuthenticated && !!linkedEmail && !dismissed;

    return (
        <>
            {showPrompt && (
                <div className="bg-blue-900/20 border-b border-blue-700/50 px-4 py-2 flex items-center gap-3">
                    <svg className="w-4 h-4 text-blue-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                    </svg>
                    <p className="text-blue-300 text-sm flex-1">
                        This data is linked to <span className="text-white font-medium">{linkedEmail}</span>. Sign in to restore the latest cloud backup.
                    </p>
                    <button
                        onClick={() => signIn('google')}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium transition-colors"
                    >
                        Sign in with Google
                    </button>
                    <button
                        onClick={() => signIn('github')}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-xs font-medium transition-colors"
                    >
                        GitHub
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="text-blue-300 hover:text-white text-xs px-2"
                        title="Hide until next visit"
                    >
                        Not now
                    </button>
                    <button
                        onClick={handleForget}
                        className="text-blue-300/70 hover:text-white text-xs px-2"
                        title="Stop reminding me about this dataset"
                    >
                        Forget
                    </button>
                </div>
            )}
            <PassphraseModal
                isOpen={restorePromptOpen}
                onClose={() => setRestorePromptOpen(false)}
                onSubmit={handleRestore}
                mode="restore"
                loading={restoreInProgress}
            />
        </>
    );
}
