/* authSession.ts — Client-side session persistence (1 hour) */

const TOKEN_KEY = 'admin_token';
const ROLE_KEY = 'admin_role';
const USERNAME_KEY = 'admin_username';
const EXPIRES_KEY = 'admin_session_expires_at';
const SESSION_MS = 60 * 60 * 1000; // 1 hour

export function establishSession(token: string, role: string, username?: string) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ROLE_KEY, role);
    if (username) localStorage.setItem(USERNAME_KEY, username);
    localStorage.setItem(EXPIRES_KEY, String(Date.now() + SESSION_MS));
}

export function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(EXPIRES_KEY);
}

export function isSessionValid(): boolean {
    const token = localStorage.getItem(TOKEN_KEY);
    const expiresAt = localStorage.getItem(EXPIRES_KEY);
    if (!token || !expiresAt) return false;
    return Date.now() < Number(expiresAt);
}

export function getStoredRole(): 'admin' | 'teacher' {
    return (localStorage.getItem(ROLE_KEY) as 'admin' | 'teacher') || 'admin';
}

export function getSessionRemainingMs(): number {
    const expiresAt = localStorage.getItem(EXPIRES_KEY);
    if (!expiresAt) return 0;
    return Math.max(0, Number(expiresAt) - Date.now());
}
