/**
 * OAuth PKCE authentication service for Cognito.
 * Uses Web Crypto API for PKCE challenge generation.
 * No external dependencies.
 */

import { CloudConfig } from './cloudConfig';

export interface AuthTokens {
    accessToken: string;
    idToken: string;
    refreshToken: string;
    expiresAt: number; // Unix timestamp in ms
}

export interface UserInfo {
    email: string;
    sub: string;
}

// --- PKCE helpers (Web Crypto API) ---

function generateRandomString(length: number): string {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(36).padStart(2, '0')).join('').slice(0, length);
}

async function sha256(plain: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    return crypto.subtle.digest('SHA-256', encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- Auth Service ---

const VERIFIER_KEY = 'stag_pkce_verifier';
const STATE_KEY = 'stag_auth_state';
const REFRESH_TOKEN_KEY = 'stag_refresh_token';

/**
 * Initiate OAuth login by redirecting to Cognito Hosted UI.
 * @param config Cloud configuration
 * @param provider 'google' or 'github' (maps to Cognito identity provider name)
 */
export async function initiateLogin(config: CloudConfig, provider: 'google' | 'github'): Promise<void> {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = base64UrlEncode(await sha256(codeVerifier));
    const state = generateRandomString(32);

    // Store PKCE verifier and state for callback verification
    sessionStorage.setItem(VERIFIER_KEY, codeVerifier);
    sessionStorage.setItem(STATE_KEY, state);

    const identityProvider = provider === 'google' ? 'Google' : 'GitHub';

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: 'openid email profile',
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        identity_provider: identityProvider,
    });

    window.location.href = `https://${config.cognitoDomain}/oauth2/authorize?${params.toString()}`;
}

/**
 * Handle the OAuth callback. Exchange authorization code for tokens.
 * Call this when the page loads with ?code= in the URL.
 * Returns tokens on success, null if no code present.
 */
export async function handleCallback(config: CloudConfig): Promise<AuthTokens | null> {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    const error = params.get('error');

    if (error) {
        throw new Error(`OAuth error: ${error} - ${params.get('error_description') || 'Unknown error'}`);
    }

    if (!code) return null;

    // Verify state
    const savedState = sessionStorage.getItem(STATE_KEY);
    if (state !== savedState) {
        throw new Error('OAuth state mismatch. Possible CSRF attack.');
    }

    const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);
    if (!codeVerifier) {
        throw new Error('PKCE verifier not found. Please try signing in again.');
    }

    // Exchange code for tokens
    const tokenResponse = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: config.clientId,
            code,
            redirect_uri: config.redirectUri,
            code_verifier: codeVerifier,
        }),
    });

    if (!tokenResponse.ok) {
        const errorBody = await tokenResponse.text();
        throw new Error(`Token exchange failed: ${errorBody}`);
    }

    const tokenData = await tokenResponse.json();

    // Clean up PKCE storage
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);

    // Clean up URL (remove ?code=... from address bar)
    const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
    window.history.replaceState({}, '', cleanUrl);

    const tokens: AuthTokens = {
        accessToken: tokenData.access_token,
        idToken: tokenData.id_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
    };

    // Persist refresh token (survives page reload, but not browser close with sessionStorage)
    if (tokens.refreshToken) {
        sessionStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    }

    return tokens;
}

/**
 * Refresh the access token using the stored refresh token.
 */
export async function refreshAccessToken(config: CloudConfig, refreshToken: string): Promise<AuthTokens> {
    const response = await fetch(`https://${config.cognitoDomain}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: config.clientId,
            refresh_token: refreshToken,
        }),
    });

    if (!response.ok) {
        // Refresh token expired or revoked
        clearStoredTokens();
        throw new Error('Session expired. Please sign in again.');
    }

    const data = await response.json();

    return {
        accessToken: data.access_token,
        idToken: data.id_token,
        refreshToken: refreshToken, // Cognito doesn't return a new refresh token
        expiresAt: Date.now() + data.expires_in * 1000,
    };
}

/**
 * Decode user info from the ID token (JWT).
 * No verification needed - Cognito already verified the token.
 */
export function decodeUserInfo(idToken: string): UserInfo {
    const payload = JSON.parse(atob(idToken.split('.')[1]));
    return {
        email: payload.email || payload.preferred_username || 'Unknown',
        sub: payload.sub,
    };
}

/**
 * Get the stored refresh token from sessionStorage.
 */
export function getStoredRefreshToken(): string | null {
    return sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

/**
 * Clear all stored auth data.
 */
export function clearStoredTokens(): void {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}

/**
 * Build the Cognito logout URL.
 */
export function getLogoutUrl(config: CloudConfig): string {
    const params = new URLSearchParams({
        client_id: config.clientId,
        logout_uri: config.logoutUri,
    });
    return `https://${config.cognitoDomain}/logout?${params.toString()}`;
}
