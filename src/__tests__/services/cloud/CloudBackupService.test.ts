import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock CryptoService so uploadBackup/downloadBackup don't run real PBKDF2/AES —
// we only care about the transport contracts here (409, 5 MB pre-check, rev in
// the POST body, 404 handling, and the ?meta=1 metadata path). encrypt returns a
// deterministic envelope whose JSON size we can control; decrypt is the identity
// on our fake ciphertext.
const encryptMock = vi.fn();
const decryptMock = vi.fn();
vi.mock('../../../services/encryption/CryptoService', () => ({
    encrypt: (...args: unknown[]) => encryptMock(...args),
    decrypt: (...args: unknown[]) => decryptMock(...args),
}));

import {
    uploadBackup,
    downloadBackup,
    getBackupMetadata,
    deleteBackup,
    BackupConflictError,
} from '../../../services/cloud/CloudBackupService';

const API = 'https://api.test';
const TOKEN = 'id-token-abc';

// A small, valid-looking envelope. JSON.stringify of this is well under 5 MB.
const smallEnvelope = {
    version: 1,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2',
    iterations: 1,
    salt: 'c2FsdA==',
    iv: 'aXY=',
    ciphertext: 'Y2lwaGVy',
    timestamp: '2026-07-06T00:00:00.000Z',
    checksum: 'deadbeef',
};

function jsonResponse(status: number, body: unknown): Response {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    encryptMock.mockReset();
    decryptMock.mockReset();
    encryptMock.mockResolvedValue(smallEnvelope);
    decryptMock.mockResolvedValue('{"plaintext":true}');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('uploadBackup', () => {
    it('sends the last-seen rev in the POST body (optimistic-lock contract)', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { rev: '2-new', timestamp: '2026-07-06T01:00:00.000Z' }));

        await uploadBackup(API, TOKEN, '{"data":1}', 'pw', '1-old');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${API}/backup`);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
        const sentBody = JSON.parse(init.body);
        expect(sentBody.rev).toBe('1-old');
        // The blob is the stringified envelope, not the plaintext.
        expect(sentBody.blob).toBe(JSON.stringify(smallEnvelope));
    });

    it('sends rev: null for a first-ever upload', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { rev: '1-first', timestamp: 't' }));

        await uploadBackup(API, TOKEN, '{"data":1}', 'pw', null);

        const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(sentBody.rev).toBeNull();
    });

    it('throws BackupConflictError on a 409 (anti-clobber contract with stag-feed)', async () => {
        fetchMock.mockResolvedValue(jsonResponse(409, { error: 'stale rev' }));

        await expect(uploadBackup(API, TOKEN, '{"data":1}', 'pw', '1-old')).rejects.toBeInstanceOf(
            BackupConflictError
        );
    });

    it('enforces the 5 MB pre-check BEFORE hitting the network', async () => {
        // Make encrypt yield an envelope whose JSON stringifies to > 5 MB.
        const huge = { ...smallEnvelope, ciphertext: 'A'.repeat(6 * 1024 * 1024) };
        encryptMock.mockResolvedValue(huge);

        await expect(uploadBackup(API, TOKEN, 'big', 'pw', null)).rejects.toThrow(/exceeds the 5 MB limit/);
        // The pre-check fires client-side; no POST is attempted.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces a non-409 error status as a thrown Error', async () => {
        fetchMock.mockResolvedValue(jsonResponse(500, 'boom'));

        await expect(uploadBackup(API, TOKEN, '{"data":1}', 'pw', null)).rejects.toThrow(/Upload failed: 500/);
    });

    it('falls back to the envelope timestamp when the server omits one', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { rev: '2-x' })); // no timestamp
        const result = await uploadBackup(API, TOKEN, '{"data":1}', 'pw', '1-old');
        expect(result.timestamp).toBe(smallEnvelope.timestamp);
        expect(result.rev).toBe('2-x');
    });
});

describe('downloadBackup', () => {
    it('decrypts the blob and returns the current rev', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { blob: JSON.stringify(smallEnvelope), rev: '3-cur' }));

        const result = await downloadBackup(API, TOKEN, 'pw');

        expect(decryptMock).toHaveBeenCalledWith(smallEnvelope, 'pw');
        expect(result.plaintext).toBe('{"plaintext":true}');
        expect(result.rev).toBe('3-cur');
        // GET, no query string, with the bearer token.
        expect(fetchMock.mock.calls[0][0]).toBe(`${API}/backup`);
    });

    it('throws "No cloud backup found." on a 404', async () => {
        fetchMock.mockResolvedValue(jsonResponse(404, { error: 'no backup' }));
        await expect(downloadBackup(API, TOKEN, 'pw')).rejects.toThrow(/No cloud backup found/);
    });

    it('throws "No cloud backup found." when a 200 carries no blob', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { rev: 'x' }));
        await expect(downloadBackup(API, TOKEN, 'pw')).rejects.toThrow(/No cloud backup found/);
    });
});

describe('getBackupMetadata', () => {
    it('requests the metadata-only endpoint (?meta=1) — not the full blob', async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(200, { rev: '4-meta', timestamp: '2026-07-06T02:00:00.000Z', size: 1234 })
        );

        const meta = await getBackupMetadata(API, TOKEN);

        expect(fetchMock.mock.calls[0][0]).toBe(`${API}/backup?meta=1`);
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        expect(meta).toEqual({
            exists: true,
            timestamp: '2026-07-06T02:00:00.000Z',
            size: 1234,
            rev: '4-meta',
        });
    });

    it('treats HTTP 200 as exists=true even though the meta response has NO blob', async () => {
        // The new backend omits the blob; existence must come from the status
        // code, not from a blob field (the old blob-presence check would have
        // wrongly reported exists=false here).
        fetchMock.mockResolvedValue(jsonResponse(200, { rev: '5-meta', timestamp: 't', size: 10 }));

        const meta = await getBackupMetadata(API, TOKEN);
        expect(meta.exists).toBe(true);
        expect(meta.rev).toBe('5-meta');
    });

    it('falls back gracefully to an OLDER backend that ignores ?meta=1 and returns the full blob', async () => {
        // A backend predating the flag serves the full document (blob included).
        // getBackupMetadata must still read rev/timestamp/size correctly.
        fetchMock.mockResolvedValue(
            jsonResponse(200, {
                blob: JSON.stringify(smallEnvelope),
                rev: '6-full',
                timestamp: 'ts',
                size: 42,
            })
        );

        const meta = await getBackupMetadata(API, TOKEN);
        expect(meta).toEqual({ exists: true, timestamp: 'ts', size: 42, rev: '6-full' });
    });

    it('returns exists=false on a 404', async () => {
        fetchMock.mockResolvedValue(jsonResponse(404, { error: 'no backup' }));

        const meta = await getBackupMetadata(API, TOKEN);
        expect(meta).toEqual({ exists: false, timestamp: null, size: null, rev: null });
    });

    it('throws on a non-404 error status', async () => {
        fetchMock.mockResolvedValue(jsonResponse(502, { error: 'store error' }));
        await expect(getBackupMetadata(API, TOKEN)).rejects.toThrow(/Failed to check backup: 502/);
    });
});

describe('deleteBackup', () => {
    it('DELETEs the backup and tolerates a 404', async () => {
        fetchMock.mockResolvedValue(jsonResponse(404, { error: 'no backup' }));
        await expect(deleteBackup(API, TOKEN)).resolves.toBeUndefined();
        expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });

    it('throws on a non-404 failure', async () => {
        fetchMock.mockResolvedValue(jsonResponse(500, 'nope'));
        await expect(deleteBackup(API, TOKEN)).rejects.toThrow(/Failed to delete backup: 500/);
    });
});
