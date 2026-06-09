import { describe, it, expect, beforeEach } from 'vitest';
import { loadStoredIdToken, saveStoredIdToken, clearStoredIdToken } from '../../../services/cloud/AuthService';

describe('AuthService stored ID token (sessionStorage)', () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    it('round-trips a saved token', () => {
        const token = { token: 'jwt-abc', expiresAt: 1_750_000_000_000 };
        saveStoredIdToken(token);
        expect(loadStoredIdToken()).toEqual(token);
    });

    it('returns null when nothing is stored', () => {
        expect(loadStoredIdToken()).toBeNull();
    });

    it('clears the stored token', () => {
        saveStoredIdToken({ token: 'jwt-abc', expiresAt: 1_750_000_000_000 });
        clearStoredIdToken();
        expect(loadStoredIdToken()).toBeNull();
    });

    it('returns null for a malformed entry instead of throwing', () => {
        sessionStorage.setItem('stag.cloud.idToken', '{not valid json');
        expect(() => loadStoredIdToken()).not.toThrow();
        expect(loadStoredIdToken()).toBeNull();
    });

    it('returns null when the stored shape is wrong', () => {
        sessionStorage.setItem('stag.cloud.idToken', JSON.stringify({ token: 123 }));
        expect(loadStoredIdToken()).toBeNull();
    });

    it('persists to sessionStorage, not localStorage (bearer-token exposure)', () => {
        saveStoredIdToken({ token: 'jwt-abc', expiresAt: 1_750_000_000_000 });
        expect(sessionStorage.getItem('stag.cloud.idToken')).not.toBeNull();
        expect(localStorage.getItem('stag.cloud.idToken')).toBeNull();
    });
});
