/**
 * Google Identity Services (GIS) authentication.
 *
 * The browser receives a Google-signed ID token (a JWT) directly from Google —
 * no client secret, no authorization-code exchange, no redirect. The backend
 * verifies that token against Google's public keys to establish *who* the user
 * is and gate *their* blob. The encryption passphrase, which protects the
 * data itself, never leaves the browser. Three separated concerns:
 *   - Google proves identity      -> the ID token
 *   - the backend gates the blob  -> verifies the ID token's signature, reads `sub`
 *   - the passphrase protects data -> stays client-side, server never sees it
 */

export interface UserInfo {
    email: string;
    sub: string;
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

// --- Minimal typing for the GIS global (loaded from the script above) ---

interface GoogleCredentialResponse {
    credential?: string;
}

interface GoogleIdInitConfig {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
}

interface GoogleAccountsId {
    initialize(config: GoogleIdInitConfig): void;
    prompt(): void;
    renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
    disableAutoSelect(): void;
}

declare global {
    interface Window {
        google?: { accounts: { id: GoogleAccountsId } };
    }
}

// --- Script loading (idempotent) ---

let scriptPromise: Promise<void> | null = null;

function loadGisScript(): Promise<void> {
    if (window.google?.accounts?.id) return Promise.resolve();
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = GIS_SRC;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = () => {
            scriptPromise = null;
            reject(new Error('Failed to load Google Identity Services.'));
        };
        document.head.appendChild(script);
    });
    return scriptPromise;
}

// --- Public API ---

/**
 * Load and initialize GIS with the given client ID. `onCredential` fires with a
 * fresh ID token whenever Google signs the user in (interactively or via silent
 * auto-select). Safe to call once on mount.
 */
export async function initGoogleAuth(
    clientId: string,
    onCredential: (idToken: string) => void
): Promise<void> {
    await loadGisScript();
    window.google!.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
            if (response?.credential) onCredential(response.credential);
        },
        auto_select: true,            // silently re-issue a token for returning users
        cancel_on_tap_outside: false,
    });
}

/**
 * Trigger the Google sign-in flow (One Tap / auto-select). The resulting ID
 * token is delivered to the `onCredential` callback registered in initGoogleAuth.
 * No-op if GIS hasn't initialized yet.
 */
export function promptSignIn(): void {
    window.google?.accounts.id.prompt();
}

/**
 * Render the official "Sign in with Google" button into a container element.
 * An alternative to promptSignIn() for cases where One Tap may be suppressed.
 */
export function renderSignInButton(element: HTMLElement): void {
    window.google?.accounts.id.renderButton(element, {
        theme: 'filled_blue',
        size: 'medium',
        text: 'signin_with',
        shape: 'pill',
    });
}

/**
 * Stop auto-selecting the user on the next load (used on sign-out).
 */
export function disableAutoSelect(): void {
    window.google?.accounts.id.disableAutoSelect();
}

// --- Session-persisted ID token ---

// We persist a still-valid ID token so a page refresh doesn't force a fresh Google
// sign-in (GIS One Tap's silent re-issue is unreliable due to cooldown/FedCM gating).
// sessionStorage is chosen over localStorage deliberately: for a finance app holding
// a bearer credential, the token should not outlive the tab or be shared across
// tabs/windows. It survives refreshes within the tab and auto-clears on tab close.
const ID_TOKEN_KEY = 'stag.cloud.idToken';

export interface StoredIdToken {
    token: string;
    expiresAt: number; // ms since epoch
}

/** Read the persisted ID token, or null if absent/unreadable. Never throws. */
export function loadStoredIdToken(): StoredIdToken | null {
    try {
        const raw = sessionStorage.getItem(ID_TOKEN_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.token === 'string' && typeof parsed?.expiresAt === 'number') {
            return { token: parsed.token, expiresAt: parsed.expiresAt };
        }
    } catch { /* sessionStorage blocked (private mode) or malformed — treat as none */ }
    return null;
}

/** Persist the ID token. Best-effort: a storage failure just means no persistence. */
export function saveStoredIdToken(value: StoredIdToken): void {
    try {
        sessionStorage.setItem(ID_TOKEN_KEY, JSON.stringify(value));
    } catch { /* private mode / quota — non-fatal */ }
}

/** Remove the persisted ID token (used on sign-out / when expired). Never throws. */
export function clearStoredIdToken(): void {
    try {
        sessionStorage.removeItem(ID_TOKEN_KEY);
    } catch { /* ignore */ }
}

// --- JWT helpers (the backend verifies signatures; the browser only reads claims) ---

function decodeJwtPayload(jwt: string): Record<string, unknown> {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = part + '='.repeat((4 - (part.length % 4)) % 4);
    return JSON.parse(atob(padded));
}

/**
 * Read user info from an ID token. No verification here — the backend verifies
 * the signature before trusting the token.
 */
export function decodeUserInfo(idToken: string): UserInfo {
    const payload = decodeJwtPayload(idToken);
    return {
        email: (payload.email as string) || 'Unknown',
        sub: payload.sub as string,
    };
}

/**
 * Expiry of an ID token in ms since epoch (0 if unreadable). GIS ID tokens are
 * short-lived (~1 hour). While valid, a token is persisted to sessionStorage (see
 * loadStoredIdToken) and rehydrated across page reloads within the tab, so a refresh
 * doesn't force re-auth. Once expired the caller re-prompts — GIS issues a brand-new
 * token; there is no refresh-token flow.
 */
export function getIdTokenExpiry(idToken: string): number {
    try {
        const payload = decodeJwtPayload(idToken);
        return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
    } catch {
        return 0;
    }
}
