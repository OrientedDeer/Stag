import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useContext, ReactNode } from 'react';

// Cloud backup must look configured/enabled so the provider runs its auth path.
vi.mock('../../../../services/cloud/cloudConfig', () => ({
    getCloudConfig: () => ({ clientId: 'test-client-id', apiEndpoint: 'https://api.test' }),
    isCloudBackupEnabled: () => true,
}));

// Mock the whole auth surface so we can drive the stored-token state and observe
// whether the provider prompts for a fresh sign-in.
vi.mock('../../../../services/cloud/AuthService', () => ({
    initGoogleAuth: vi.fn(async () => {}),
    promptSignIn: vi.fn(),
    disableAutoSelect: vi.fn(),
    decodeUserInfo: vi.fn(() => ({ email: 'user@test.dev', sub: 'sub-1' })),
    getIdTokenExpiry: vi.fn(() => Date.now() + 3_600_000),
    loadStoredIdToken: vi.fn(() => null),
    saveStoredIdToken: vi.fn(),
    clearStoredIdToken: vi.fn(),
}));

import { CloudBackupProvider } from '../../../../components/Objects/CloudBackup/CloudBackupProvider';
import { CloudBackupContext } from '../../../../components/Objects/CloudBackup/CloudBackupContext';
import * as AuthService from '../../../../services/cloud/AuthService';

const auth = vi.mocked(AuthService);
const wrapper = ({ children }: { children: ReactNode }) => (
    <CloudBackupProvider>{children}</CloudBackupProvider>
);

describe('CloudBackupProvider — session rehydration on mount', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        auth.initGoogleAuth.mockResolvedValue(undefined);
        auth.decodeUserInfo.mockReturnValue({ email: 'user@test.dev', sub: 'sub-1' });
        auth.getIdTokenExpiry.mockReturnValue(Date.now() + 3_600_000);
        auth.loadStoredIdToken.mockReturnValue(null);
    });

    it('rehydrates a valid stored token: authenticated, no prompt, not a fresh sign-in', async () => {
        auth.loadStoredIdToken.mockReturnValue({ token: 'valid-jwt', expiresAt: Date.now() + 3_600_000 });

        const { result } = renderHook(() => useContext(CloudBackupContext), { wrapper });
        await waitFor(() => expect(result.current.checkingAuth).toBe(false));

        expect(result.current.isAuthenticated).toBe(true);
        expect(result.current.userEmail).toBe('user@test.dev');
        // Rehydration must NOT look like a fresh sign-in (would wrongly fire the restore prompt).
        expect(result.current.justSignedIn).toBe(false);
        // We already hold a valid token — don't nag for a new one.
        expect(auth.promptSignIn).not.toHaveBeenCalled();
        expect(auth.clearStoredIdToken).not.toHaveBeenCalled();
    });

    it('clears an expired stored token and falls back to the sign-in prompt', async () => {
        auth.loadStoredIdToken.mockReturnValue({ token: 'stale-jwt', expiresAt: Date.now() - 1_000 });

        const { result } = renderHook(() => useContext(CloudBackupContext), { wrapper });
        await waitFor(() => expect(result.current.checkingAuth).toBe(false));

        expect(result.current.isAuthenticated).toBe(false);
        expect(auth.clearStoredIdToken).toHaveBeenCalled();
        expect(auth.promptSignIn).toHaveBeenCalled();
    });

    it('prompts normally when there is no stored token', async () => {
        const { result } = renderHook(() => useContext(CloudBackupContext), { wrapper });
        await waitFor(() => expect(result.current.checkingAuth).toBe(false));

        expect(result.current.isAuthenticated).toBe(false);
        expect(auth.promptSignIn).toHaveBeenCalled();
        // Nothing stored, so nothing to clear.
        expect(auth.clearStoredIdToken).not.toHaveBeenCalled();
    });

    it('signOut clears the persisted token', async () => {
        const { result } = renderHook(() => useContext(CloudBackupContext), { wrapper });
        await waitFor(() => expect(result.current.checkingAuth).toBe(false));

        act(() => { result.current.signOut(); });

        expect(auth.clearStoredIdToken).toHaveBeenCalled();
        expect(result.current.isAuthenticated).toBe(false);
    });
});
