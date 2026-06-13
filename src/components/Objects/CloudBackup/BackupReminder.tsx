import { useContext, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloudBackupContext } from './CloudBackupContext';
import { useFileManager } from '../Accounts/useFileManager';
import PassphraseModal from './PassphraseModal';
import { jsonDateReplacer } from '../../../utils/formatters';

interface BackupReminderProps {
    collapsed?: boolean;
}

export default function BackupReminder({ collapsed = false }: BackupReminderProps) {
    const {
        isAuthenticated,
        lastBackupHash,
        currentDataHash,
        backup,
        backupInProgress,
    } = useContext(CloudBackupContext);
    const { getBackupData } = useFileManager();
    const [modalOpen, setModalOpen] = useState(false);

    const isDirty =
        isAuthenticated &&
        !!lastBackupHash &&
        !!currentDataHash &&
        currentDataHash !== lastBackupHash;

    if (!isDirty) return null;

    const handleSubmit = async (passphrase: string) => {
        try {
            const plaintext = JSON.stringify(getBackupData(), jsonDateReplacer);
            await backup(plaintext, passphrase);
            setModalOpen(false);
        } catch {
            // Error surfaced via context.lastError - keep modal open for retry
        }
    };

    const tooltip = 'Local changes since last cloud backup. Click to back up now.';

    return (
        <>
            <button
                type="button"
                onClick={() => setModalOpen(true)}
                title={tooltip}
                aria-label={tooltip}
                className={`group flex items-center gap-2 w-full mb-1 px-2 py-1.5 rounded text-xs transition-colors bg-warning-tint/30 hover:bg-warning-tint/50 border border-warning-strong/50 text-warning-bright ${collapsed ? 'justify-center' : ''}`}
            >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M5 19h14a2 2 0 001.84-2.75L13.74 4a2 2 0 00-3.48 0l-7.1 12.25A2 2 0 005 19z" />
                </svg>
                {!collapsed && (
                    <span className="overflow-hidden whitespace-nowrap text-left flex-1">
                        Unsaved changes
                    </span>
                )}
            </button>
            {/* Portal to document.body so the modal escapes the sidebar's transform
                containing block and renders centered over the whole viewport. */}
            {createPortal(
                <PassphraseModal
                    isOpen={modalOpen}
                    onClose={() => setModalOpen(false)}
                    onSubmit={handleSubmit}
                    mode="backup"
                    loading={backupInProgress}
                />,
                document.body
            )}
        </>
    );
}
