import { describe, it, expect, beforeEach } from 'vitest';
import { loadStoredIdToken, saveStoredIdToken, clearStoredIdToken, decodeUserInfo } from '../../../services/cloud/AuthService';

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

describe('AuthService decodeUserInfo', () => {
    // base64url helper that mimics how GIS encodes a JWT payload segment.
    const encodePayload = (obj: Record<string, unknown>): string =>
        btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    it('reads email and sub from a well-formed token payload', () => {
        const token = `header.${encodePayload({ email: 'user@example.com', sub: 'sub-123' })}.sig`;
        expect(decodeUserInfo(token)).toEqual({ email: 'user@example.com', sub: 'sub-123' });
    });

    it('returns the sentinel for a non-JWT string instead of throwing', () => {
        // A tampered/garbage token has no second '.' segment — the raw decode would
        // call .replace on undefined and throw a TypeError.
        expect(() => decodeUserInfo('abc')).not.toThrow();
        expect(decodeUserInfo('abc')).toEqual({ email: 'Unknown', sub: '' });
    });

    it('returns the sentinel when the payload segment is not valid base64/JSON', () => {
        expect(() => decodeUserInfo('header.{not-base64.sig')).not.toThrow();
        expect(decodeUserInfo('header.{not-base64.sig')).toEqual({ email: 'Unknown', sub: '' });
    });

    it('defaults missing email/sub claims rather than yielding undefined', () => {
        const token = `header.${encodePayload({})}.sig`;
        expect(decodeUserInfo(token)).toEqual({ email: 'Unknown', sub: '' });
    });
});
