/**
 * Cloud backup configuration.
 * All values read from Vite environment variables.
 * When env vars are not set, cloud backup features are disabled.
 *
 * Auth uses Google Identity Services (the ID-token flow): the browser receives
 * a Google-signed ID token directly, so there is no client secret, no hosted
 * login domain, and no redirect URI to configure — just the Google client ID
 * and the backend endpoint that stores the encrypted blob.
 */

export interface CloudConfig {
    clientId: string;    // Google OAuth 2.0 Web client ID (no secret needed)
    apiEndpoint: string; // backend base URL implementing GET/POST/DELETE /backup
}

export function getCloudConfig(): CloudConfig | null {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    const apiEndpoint = import.meta.env.VITE_CLOUD_API_ENDPOINT;

    if (!clientId || !apiEndpoint) {
        return null;
    }

    return { clientId, apiEndpoint };
}

export function isCloudBackupEnabled(): boolean {
    return getCloudConfig() !== null;
}
