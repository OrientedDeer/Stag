import { createContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';
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

export interface CloudBackupState {
    enabled: boolean;
    isAuthenticated: boolean;
    userEmail: string | null;
    lastBackupTimestamp: string | null;
    backupInProgress: boolean;
    restoreInProgress: boolean;
    checkingAuth: boolean;
    lastError: string | null;
}

interface CloudBackupContextValue extends CloudBackupState {
    signIn: (provider: 'google' | 'github') => Promise<void>;
    signOut: () => void;
    backup: (plaintext: string, passphrase: string) => Promise<void>;
    restore: (passphrase: string) => Promise<string>;
    deleteCloudData: () => Promise<void>;
    checkBackupStatus: () => Promise<BackupMetadata>;
    clearError: () => void;
}

const BACKUP_META_KEY = 'cloud_backup_meta';

function loadPersistedMeta(): { lastBackupTimestamp: string | null } {
    try {
        const raw = localStorage.getItem(BACKUP_META_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { lastBackupTimestamp: null };
}

function persistMeta(timestamp: string | null): void {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ lastBackupTimestamp: timestamp }));
}

const defaultContextValue: CloudBackupContextValue = {
    enabled: false,
    isAuthenticated: false,
    userEmail: null,
    lastBackupTimestamp: null,
    backupInProgress: false,
    restoreInProgress: false,
    checkingAuth: false,
    lastError: null,
    signIn: async () => {},
    signOut: () => {},
    backup: async () => {},
    restore: async () => '',
    deleteCloudData: async () => {},
    checkBackupStatus: async () => ({ exists: false, timestamp: null, size: null }),
    clearError: () => {},
};

export const CloudBackupContext = createContext<CloudBackupContextValue>(defaultContextValue);

export function CloudBackupProvider({ children }: { children: ReactNode }) {
    const configRef = useRef<CloudConfig | null>(null);
    const tokensRef = useRef<AuthTokens | null>(null);
    const callbackHandled = useRef(false);

    const [state, setState] = useState<CloudBackupState>(() => ({
        enabled: isCloudBackupEnabled(),
        isAuthenticated: false,
        userEmail: null,
        lastBackupTimestamp: loadPersistedMeta().lastBackupTimestamp,
        backupInProgress: false,
        restoreInProgress: false,
        checkingAuth: true,
        lastError: null,
    }));

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
                    setState(s => ({
                        ...s,
                        isAuthenticated: true,
                        userEmail: userInfo.email,
                        checkingAuth: false,
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
                        setState(s => ({
                            ...s,
                            isAuthenticated: true,
                            userEmail: userInfo.email,
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
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        persistMeta(null);
        setState(s => ({
            ...s,
            isAuthenticated: false,
            userEmail: null,
            lastBackupTimestamp: null,
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
            persistMeta(timestamp);
            setState(s => ({ ...s, backupInProgress: false, lastBackupTimestamp: timestamp }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Backup failed';
            setState(s => ({ ...s, backupInProgress: false, lastError: message }));
            throw error;
        }
    }, [getValidAccessToken]);

    const restore = useCallback(async (passphrase: string): Promise<string> => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, restoreInProgress: true, lastError: null }));
        try {
            const accessToken = await getValidAccessToken();
            const plaintext = await downloadBackup(config.apiEndpoint, accessToken, passphrase);
            setState(s => ({ ...s, restoreInProgress: false }));
            return plaintext;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Restore failed';
            setState(s => ({ ...s, restoreInProgress: false, lastError: message }));
            throw error;
        }
    }, [getValidAccessToken]);

    const deleteCloudData = useCallback(async () => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        setState(s => ({ ...s, lastError: null }));
        try {
            const accessToken = await getValidAccessToken();
            await deleteBackup(config.apiEndpoint, accessToken);
            persistMeta(null);
            setState(s => ({ ...s, lastBackupTimestamp: null }));
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Delete failed';
            setState(s => ({ ...s, lastError: message }));
            throw error;
        }
    }, [getValidAccessToken]);

    const checkBackupStatus = useCallback(async (): Promise<BackupMetadata> => {
        const config = configRef.current;
        if (!config) throw new Error('Cloud backup not configured');

        try {
            const accessToken = await getValidAccessToken();
            const metadata = await getBackupMetadata(config.apiEndpoint, accessToken);
            if (metadata.exists && metadata.timestamp) {
                persistMeta(metadata.timestamp);
                setState(s => ({ ...s, lastBackupTimestamp: metadata.timestamp }));
            }
            return metadata;
        } catch {
            return { exists: false, timestamp: null, size: null };
        }
    }, [getValidAccessToken]);

    const clearError = useCallback(() => {
        setState(s => ({ ...s, lastError: null }));
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
    };

    return (
        <CloudBackupContext.Provider value={contextValue}>
            {children}
        </CloudBackupContext.Provider>
    );
}
