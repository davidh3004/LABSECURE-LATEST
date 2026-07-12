/* LoginPage.tsx — Admin login screen */

import { useState } from 'react';
import { Lock, User, LogIn, Loader2 } from 'lucide-react';
import { authApi } from '../api/client';
import { establishSession } from '../api/authSession';

interface LoginPageProps {
    onLoginSuccess: (token: string, role: string) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            const res = await authApi.login(username, password);
            establishSession(res.access_token, res.role, username);
            onLoginSuccess(res.access_token, res.role);
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Invalid credentials');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg-main)',
            padding: 20
        }}>
            <div style={{
                background: 'var(--bg-card)',
                padding: '40px',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '400px',
                boxShadow: 'var(--shadow)',
                border: '1px solid var(--border)'
            }}>
                <div style={{ textAlign: 'center', marginBottom: 32 }}>
                    <div style={{
                        width: 64, height: 64, borderRadius: 16,
                        background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px'
                    }}>
                        <Lock size={32} />
                    </div>
                    <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px', color: 'var(--text-main)' }}>
                        LabSecure AI
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                        Sign in to access the admin dashboard
                    </p>
                </div>

                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {error && (
                        <div style={{
                            padding: '12px', background: 'var(--color-danger-bg)',
                            color: 'var(--color-danger)', borderRadius: '8px',
                            fontSize: '14px', textAlign: 'center', border: '1px solid var(--color-danger)'
                        }}>
                            {error}
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label">Username</label>
                        <div style={{ position: 'relative' }}>
                            <User size={18} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-tertiary)' }} />
                            <input
                                type="text"
                                className="form-input"
                                style={{ paddingLeft: 40 }}
                                placeholder="Enter username"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label">Password</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={18} style={{ position: 'absolute', left: 12, top: 11, color: 'var(--text-tertiary)' }} />
                            <input
                                type="password"
                                className="form-input"
                                style={{ paddingLeft: 40 }}
                                placeholder="Enter password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary"
                        style={{ width: '100%', marginTop: 8, height: 44 }}
                        disabled={loading}
                    >
                        {loading ? <Loader2 size={18} className="spin" /> : <LogIn size={18} />}
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    );
}
