/**
 * Cloud backup configuration.
 * All values read from Vite environment variables.
 * When env vars are not set, cloud backup features are disabled.
 */

export interface CloudConfig {
    cognitoDomain: string;
    clientId: string;
    apiEndpoint: string;
    redirectUri: string;
    logoutUri: string;
}

function getRedirectUri(): string {
    const base = window.location.origin + window.location.pathname;
    // Remove trailing hash, ensure trailing slash to match Cognito callback URL
    const cleaned = base.replace(/#.*$/, '');
    return cleaned.endsWith('/') ? cleaned : cleaned + '/';
}

export function getCloudConfig(): CloudConfig | null {
    const cognitoDomain = import.meta.env.VITE_COGNITO_DOMAIN;
    const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
    const apiEndpoint = import.meta.env.VITE_CLOUD_API_ENDPOINT;

    if (!cognitoDomain || !clientId || !apiEndpoint) {
        return null;
    }

    const redirectUri = getRedirectUri();

    return {
        cognitoDomain,
        clientId,
        apiEndpoint,
        redirectUri,
        logoutUri: redirectUri,
    };
}

export function isCloudBackupEnabled(): boolean {
    return getCloudConfig() !== null;
}
