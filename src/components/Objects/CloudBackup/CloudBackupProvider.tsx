import { useCallback, useEffect, useRef, useState, ReactNode } from 'react';
import { getCloudConfig, isCloudBackupEnabled, CloudConfig } from '../../../services/cloud/cloudConfig';
import {
    AuthTokens,
    handleCallback,
    refreshAccessToken,
    decodeUserInfo,
    getStoredRefreshToken,
    clearStoredTokens,
    initiateLogin,
    getLogoutUrl,
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

export function CloudBackupProvider({ children }: { children: ReactNode }) {
    const configRef = useRef<CloudConfig | null>(null);
    const tokensRef = useRef<AuthTokens | null>(null);
    const callbackHandled = useRef(false);

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

    // Initialize config
    useEffect(() => {
        configRef.current = getCloudConfig();
        if (!configRef.current) {
            setState(s => ({ ...s, checkingAuth: false }));
        }
    }, []);

    // Handle OAuth callback on mount (check for ?code= in URL)
    useEffect(() => {
        const config = getCloudConfig();
        if (!config) return;
        // Guard against React Strict Mode double-invocation (auth codes are single-use)
        if (callbackHandled.current) return;
        callbackHandled.current = true;

        (async () => {
            try {
                // First, try to handle OAuth callback
                const tokens = await handleCallback(config);
                if (tokens) {
                    tokensRef.current = tokens;
                    const userInfo = decodeUserInfo(tokens.idToken);
                    writeMeta({ linkedEmail: userInfo.email });
                    setState(s => ({
                        ...s,
                        isAuthenticated: true,
                        userEmail: userInfo.email,
                        linkedEmail: userInfo.email,
                        checkingAuth: false,
                        justSignedIn: true,
                    }));
                    return;
                }

                // No callback code - try refreshing with stored refresh token
                const refreshToken = getStoredRefreshToken();
                if (refreshToken) {
                    try {
                        const tokens = await refreshAccessToken(config, refreshToken);
                        tokensRef.current = tokens;
                        const userInfo = decodeUserInfo(tokens.idToken);
                        writeMeta({ linkedEmail: userInfo.email });
                        setState(s => ({
                            ...s,
                            isAuthenticated: true,
                            userEmail: userInfo.email,
                            linkedEmail: userInfo.email,
                            checkingAuth: false,
                        }));
                        return;
                    } catch {
                        // Refresh token expired - clear and stay signed out
                        clearStoredTokens();
                    }
                }

                setState(s => ({ ...s, checkingAuth: false }));
            } catch (error) {
                setState(s => ({
                    ...s,
                    checkingAuth: false,
                    lastError: error instanceof Error ? error.message : 'Authentication failed',
                }));
            }
        })();
    }, [writeMeta]);

    // Ensure access token is fresh before API calls
    const getValidAccessToken = useCallback(async (): Promise<string> => {
        const tokens = tokensRef.current;
        const config = configRef.current;
        if (!tokens || !config) throw new Error('Not authenticated');

        // Refresh if expiring within 60 seconds
        if (Date.now() > tokens.expiresAt - 60_000) {
            const refreshed = await refreshAccessToken(config, tokens.refreshToken);
            tokensRef.current = refreshed;
            return refreshed.accessToken;
        }

        return tokens.accessToken;
    }, []);

    const signIn = useCallback(async (provider: 'google' | 'github') => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');
        await initiateLogin(config, provider);
    }, []);

    const signOut = useCallback(() => {
        const config = configRef.current;
        tokensRef.current = null;
        clearStoredTokens();
        // Keep linkedEmail and lastBackupHash so we can prompt the user to sign back in
        // and restore on next open. Backup timestamp is intentionally preserved.
        setState(s => ({
            ...s,
            isAuthenticated: false,
            userEmail: null,
            lastError: null,
        }));

        // Optionally redirect to Cognito logout to clear Cognito session
        if (config) {
            // Use a hidden iframe to logout from Cognito without navigating away
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = getLogoutUrl(config);
            document.body.appendChild(iframe);
            setTimeout(() => iframe.remove(), 3000);
        }
    }, []);

    const backup = useCallback(async (plaintext: string, passphrase: string) => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, backupInProgress: true, lastError: null }));
        try {
            const accessToken = await getValidAccessToken();
            const { timestamp } = await uploadBackup(config.apiEndpoint, accessToken, plaintext, passphrase);
            const hash = await sha256Hex(plaintext);
            writeMeta({ lastBackupTimestamp: timestamp, lastBackupHash: hash });
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
    }, [getValidAccessToken, writeMeta]);

    const restore = useCallback(async (passphrase: string): Promise<string> => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, restoreInProgress: true, lastError: null }));
        try {
            const accessToken = await getValidAccessToken();
            const plaintext = await downloadBackup(config.apiEndpoint, accessToken, passphrase);
            // After restore, local data matches the cloud payload - record its hash so
            // we don't immediately flag the data as dirty.
            const hash = await sha256Hex(plaintext);
            writeMeta({ lastBackupHash: hash });
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
    }, [getValidAccessToken, writeMeta]);

    const deleteCloudData = useCallback(async () => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, lastError: null }));
        try {
            const accessToken = await getValidAccessToken();
            await deleteBackup(config.apiEndpoint, accessToken);
            writeMeta({ lastBackupTimestamp: null, lastBackupHash: null, linkedEmail: null });
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
    }, [getValidAccessToken, writeMeta]);

    const checkBackupStatus = useCallback(async (): Promise<BackupMetadata> => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        try {
            const accessToken = await getValidAccessToken();
            const metadata = await getBackupMetadata(config.apiEndpoint, accessToken);
            if (metadata.exists && metadata.timestamp) {
                writeMeta({ lastBackupTimestamp: metadata.timestamp });
                setState(s => ({ ...s, lastBackupTimestamp: metadata.timestamp }));
            }
            return metadata;
        } catch {
            return { exists: false, timestamp: null, size: null };
        }
    }, [getValidAccessToken, writeMeta]);

    const clearError = useCallback(() => {
        setState(s => ({ ...s, lastError: null }));
    }, []);

    const updateCurrentDataHash = useCallback((hash: string) => {
        setState(s => (s.currentDataHash === hash ? s : { ...s, currentDataHash: hash }));
    }, []);

    const clearLinkedEmail = useCallback(() => {
        writeMeta({ linkedEmail: null, lastBackupHash: null });
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
