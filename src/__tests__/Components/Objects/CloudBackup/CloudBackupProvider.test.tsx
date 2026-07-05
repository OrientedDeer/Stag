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

// Mock the transport so restore() can be driven without a network.
vi.mock('../../../../services/cloud/CloudBackupService', () => ({
    uploadBackup: vi.fn(),
    downloadBackup: vi.fn(async () => ({ plaintext: '{"raw":"blob"}', rev: 'rev-1' })),
    getBackupMetadata: vi.fn(),
    deleteBackup: vi.fn(),
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

describe('CloudBackupProvider — post-restore rebaseline', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        sessionStorage.clear();
        // Authenticated session so restore() can run.
        auth.loadStoredIdToken.mockReturnValue({ token: 'valid-jwt', expiresAt: Date.now() + 3_600_000 });
    });

    async function renderAuthed() {
        const { result } = renderHook(() => useContext(CloudBackupContext), { wrapper });
        await waitFor(() => expect(result.current.checkingAuth).toBe(false));
        expect(result.current.isAuthenticated).toBe(true);
        return result;
    }

    it('adopts the first post-restore live hash as the clean baseline', async () => {
        // The import pipeline reshapes restored data (migrations, reconstitute
        // defaults), so the live hash computed from getBackupData() after a
        // restore legitimately differs from the raw-plaintext hash — that must
        // NOT read as "unsaved changes".
        const result = await renderAuthed();

        await act(async () => { await result.current.restore('passphrase'); });
        const provisional = result.current.lastBackupHash;
        expect(provisional).toBeTruthy();

        // CloudBackupSync reports the post-import live hash ≈400ms later.
        act(() => { result.current.updateCurrentDataHash('post-import-shape-hash'); });

        expect(result.current.lastBackupHash).toBe('post-import-shape-hash');
        expect(result.current.currentDataHash).toBe('post-import-shape-hash');
        // Baseline persisted so a reload stays clean too.
        expect(JSON.parse(localStorage.getItem('cloud_backup_meta') || '{}').lastBackupHash)
            .toBe('post-import-shape-hash');
    });

    it('rebaselines only once — a later hash change is real dirt', async () => {
        const result = await renderAuthed();
        await act(async () => { await result.current.restore('passphrase'); });

        act(() => { result.current.updateCurrentDataHash('post-import-shape-hash'); });
        act(() => { result.current.updateCurrentDataHash('user-edited-hash'); });

        expect(result.current.lastBackupHash).toBe('post-import-shape-hash');
        expect(result.current.currentDataHash).toBe('user-edited-hash');
    });

    it('expires the rebaseline window: a hash arriving much later is NOT absorbed as clean', async () => {
        const result = await renderAuthed();
        await act(async () => { await result.current.restore('passphrase'); });
        const provisional = result.current.lastBackupHash;

        // Restored blob identical to local state → no immediate hash update.
        // The user edits something well after the window.
        const realNow = Date.now();
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
        try {
            act(() => { result.current.updateCurrentDataHash('later-real-edit-hash'); });
        } finally {
            nowSpy.mockRestore();
        }

        expect(result.current.lastBackupHash).toBe(provisional);
        expect(result.current.currentDataHash).toBe('later-real-edit-hash');
    });

    it('a plain hash update without a restore never touches the baseline', async () => {
        const result = await renderAuthed();
        act(() => { result.current.updateCurrentDataHash('h1'); });
        expect(result.current.lastBackupHash).toBeNull();
        expect(result.current.currentDataHash).toBe('h1');
    });
});
