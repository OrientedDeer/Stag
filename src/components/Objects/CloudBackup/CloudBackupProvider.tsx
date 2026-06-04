import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { getCloudConfig, isCloudBackupEnabled, CloudConfig } from '../../../services/cloud/cloudConfig';
import {
    initGoogleAuth,
    promptSignIn,
    disableAutoSelect,
    decodeUserInfo,
    getIdTokenExpiry,
} from '../../../services/cloud/AuthService';
import {
    uploadBackup,
    downloadBackup,
    getBackupMetadata,
    deleteBackup,
    BackupMetadata,
} from '../../../services/cloud/CloudBackupService';
import {
    CloudBackupContext,
    CloudBackupContextValue,
    CloudBackupState,
    PersistedMeta,
    loadPersistedMeta,
    persistMeta,
    sha256Hex,
} from './CloudBackupContext';

interface PendingAuth {
    resolve: (idToken: string) => void;
    reject: (err: Error) => void;
}

export function CloudBackupProvider({ children }: { children: ReactNode }) {
    const configRef = useRef<CloudConfig | null>(null);
    // Cached Google ID token + its expiry (ms). Re-prompted when expired.
    const idTokenRef = useRef<{ token: string; expiresAt: number } | null>(null);
    // Last-seen blob rev, for optimistic-locking writes.
    const revRef = useRef<string | null>(null);
    // Resolver for an in-flight getValidIdToken() awaiting the GIS callback.
    const pendingAuthRef = useRef<PendingAuth | null>(null);

    const [state, setState] = useState<CloudBackupState>(() => {
        const meta = loadPersistedMeta();
        return {
            enabled: isCloudBackupEnabled(),
            isAuthenticated: false,
            userEmail: null,
            lastBackupTimestamp: meta.lastBackupTimestamp,
            backupInProgress: false,
            restoreInProgress: false,
            checkingAuth: true,
            lastError: null,
            linkedEmail: meta.linkedEmail,
            lastBackupHash: meta.lastBackupHash,
            currentDataHash: null,
            justSignedIn: false,
        };
    });

    const metaRef = useRef<PersistedMeta>(loadPersistedMeta());
    const writeMeta = useCallback((patch: Partial<PersistedMeta>) => {
        metaRef.current = { ...metaRef.current, ...patch };
        persistMeta(metaRef.current);
    }, []);

    // Seed the rev from persisted meta (best-effort; a GET will refresh it).
    useEffect(() => {
        revRef.current = metaRef.current.lastRev;
    }, []);

    // Fired by GIS whenever Google signs the user in (interactively or via
    // silent auto-select). Resolves any pending token wait; otherwise treats it
    // as a fresh interactive sign-in (which triggers the restore prompt).
    const onCredential = useCallback((idToken: string) => {
        idTokenRef.current = { token: idToken, expiresAt: getIdTokenExpiry(idToken) };
        const userInfo = decodeUserInfo(idToken);
        writeMeta({ linkedEmail: userInfo.email });

        const pending = pendingAuthRef.current;
        pendingAuthRef.current = null;

        setState(s => ({
            ...s,
            isAuthenticated: true,
            userEmail: userInfo.email,
            linkedEmail: userInfo.email,
            checkingAuth: false,
            // A pending wait is a silent token refresh, not a new sign-in.
            justSignedIn: pending ? s.justSignedIn : true,
        }));

        if (pending) pending.resolve(idToken);
    }, [writeMeta]);

    // Initialize config + GIS on mount.
    useEffect(() => {
        const config = getCloudConfig();
        configRef.current = config;
        if (!config) {
            setState(s => ({ ...s, checkingAuth: false }));
            return;
        }
        (async () => {
            try {
                await initGoogleAuth(config.clientId, onCredential);
                // Attempt silent auto-select for returning users. If it doesn't
                // sign them in, onCredential simply never fires and they stay
                // signed out — the UI offers a Sign in button.
                promptSignIn();
            } catch (error) {
                setState(s => ({
                    ...s,
                    lastError: error instanceof Error ? error.message : 'Authentication failed',
                }));
            } finally {
                setState(s => ({ ...s, checkingAuth: false }));
            }
        })();
    }, [onCredential]);

    // Return a valid ID token, re-prompting via GIS if the cached one is expired.
    const getValidIdToken = useCallback(async (): Promise<string> => {
        const cur = idTokenRef.current;
        if (cur && Date.now() < cur.expiresAt - 60_000) return cur.token;

        return new Promise<string>((resolve, reject) => {
            pendingAuthRef.current = { resolve, reject };
            promptSignIn();
            // Safety net: if GIS never delivers a credential (dismissed, blocked),
            // fail the operation rather than hang forever.
            setTimeout(() => {
                if (pendingAuthRef.current) {
                    pendingAuthRef.current = null;
                    reject(new Error('Sign-in required. Please sign in with Google and try again.'));
                }
            }, 60_000);
        });
    }, []);

    const signIn = useCallback(async () => {
        if (!configRef.current) throw new Error('Cloud backup not configured');
        promptSignIn();
    }, []);

    const signOut = useCallback(() => {
        idTokenRef.current = null;
        disableAutoSelect();
        // Keep linkedEmail, lastBackupHash, and rev so we can prompt to sign back
        // in and restore on next open. Backup timestamp is intentionally preserved.
        setState(s => ({
            ...s,
            isAuthenticated: false,
            userEmail: null,
            lastError: null,
        }));
    }, []);

    const backup = useCallback(async (plaintext: string, passphrase: string) => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, backupInProgress: true, lastError: null }));
        try {
            const idToken = await getValidIdToken();
            const { timestamp, rev } = await uploadBackup(
                config.apiEndpoint, idToken, plaintext, passphrase, revRef.current
            );
            revRef.current = rev;
            const hash = await sha256Hex(plaintext);
            writeMeta({ lastBackupTimestamp: timestamp, lastBackupHash: hash, lastRev: rev });
            setState(s => ({
                ...s,
                backupInProgress: false,
                lastBackupTimestamp: timestamp,
                lastBackupHash: hash,
                currentDataHash: hash,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Backup failed';
            setState(s => ({ ...s, backupInProgress: false, lastError: message }));
            throw error;
        }
    }, [getValidIdToken, writeMeta]);

    const restore = useCallback(async (passphrase: string): Promise<string> => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, restoreInProgress: true, lastError: null }));
        try {
            const idToken = await getValidIdToken();
            const { plaintext, rev } = await downloadBackup(config.apiEndpoint, idToken, passphrase);
            revRef.current = rev;
            // After restore, local data matches the cloud payload - record its hash
            // so we don't immediately flag the data as dirty.
            const hash = await sha256Hex(plaintext);
            writeMeta({ lastBackupHash: hash, lastRev: rev });
            setState(s => ({
                ...s,
                restoreInProgress: false,
                lastBackupHash: hash,
                currentDataHash: hash,
            }));
            return plaintext;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Restore failed';
            setState(s => ({ ...s, restoreInProgress: false, lastError: message }));
            throw error;
        }
    }, [getValidIdToken, writeMeta]);

    const deleteCloudData = useCallback(async () => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, lastError: null }));
        try {
            const idToken = await getValidIdToken();
            await deleteBackup(config.apiEndpoint, idToken);
            revRef.current = null;
            writeMeta({ lastBackupTimestamp: null, lastBackupHash: null, linkedEmail: null, lastRev: null });
            setState(s => ({
                ...s,
                lastBackupTimestamp: null,
                lastBackupHash: null,
                linkedEmail: null,
            }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Delete failed';
            setState(s => ({ ...s, lastError: message }));
            throw error;
        }
    }, [getValidIdToken, writeMeta]);

    const checkBackupStatus = useCallback(async (): Promise<BackupMetadata> => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        try {
            const idToken = await getValidIdToken();
            const metadata = await getBackupMetadata(config.apiEndpoint, idToken);
            if (metadata.rev) revRef.current = metadata.rev;
            if (metadata.exists && metadata.timestamp) {
                writeMeta({ lastBackupTimestamp: metadata.timestamp, lastRev: metadata.rev });
                setState(s => ({ ...s, lastBackupTimestamp: metadata.timestamp }));
            }
            return metadata;
        } catch {
            return { exists: false, timestamp: null, size: null, rev: null };
        }
    }, [getValidIdToken, writeMeta]);

    const clearError = useCallback(() => {
        setState(s => ({ ...s, lastError: null }));
    }, []);

    const updateCurrentDataHash = useCallback((hash: string) => {
        setState(s => (s.currentDataHash === hash ? s : { ...s, currentDataHash: hash }));
    }, []);

    const clearLinkedEmail = useCallback(() => {
        revRef.current = null;
        writeMeta({ linkedEmail: null, lastBackupHash: null, lastRev: null });
        setState(s => ({ ...s, linkedEmail: null, lastBackupHash: null }));
    }, [writeMeta]);

    const clearJustSignedIn = useCallback(() => {
        setState(s => (s.justSignedIn ? { ...s, justSignedIn: false } : s));
    }, []);

    const contextValue: CloudBackupContextValue = {
        ...state,
        signIn,
        signOut,
        backup,
        restore,
        deleteCloudData,
        checkBackupStatus,
        clearError,
        updateCurrentDataHash,
        clearLinkedEmail,
        clearJustSignedIn,
    };

    return (
        <CloudBackupContext.Provider value={contextValue}>
            {children}
        </CloudBackupContext.Provider>
    );
}
