/* AdminsPage.tsx — Admin & Teacher Account Management */

import { useState, useEffect } from 'react';
import { Shield, Plus, Trash2, X, Loader2, GraduationCap } from 'lucide-react';
import { authApi, usersApi } from '../api/client';
import { confirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';
import type { User } from '../api/types';

export default function AdminsPage() {
    const [admins, setAdmins] = useState<any[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('admin');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        try {
            const [adminsData, usersData] = await Promise.all([
                authApi.listAdmins(),
                usersApi.list()
            ]);
            setAdmins(adminsData);
            setUsers(usersData);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        try {
            await authApi.createAdmin(username, password, role);
            setShowModal(false);
            setUsername('');
            setPassword('');
            setRole('admin');
            load();
            toast.success('Account created');
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Failed to create account');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        const ok = await confirmDialog({
            title: 'Delete account?',
            message: 'This account will be permanently deleted and lose all access.',
            confirmLabel: 'Delete',
        });
        if (!ok) return;
        try {
            await authApi.deleteAdmin(id);
            load();
            toast.success('Account deleted');
        } catch (err: any) {
            toast.error(err.response?.data?.detail || 'Failed to delete account');
        }
    };

    // Filter to registered teachers who don't already have a teacher login account (based on trimmed names)
    const registeredTeachers = users.filter(u => 
        u.role === 'teacher' && 
        !admins.some(admin => admin.role === 'teacher' && admin.username === u.name.trim())
    );

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <Loader2 className="spin" size={32} style={{ color: 'var(--color-primary)' }} />
            </div>
        );
    }

    return (
        <div className="page-container fade-in">
            <div className="page-header">
                <div>
                    <h1 className="page-title">Admin & Teacher Accounts</h1>
                    <p className="page-subtitle">Manage system administrators and teacher accounts</p>
                </div>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    <Plus size={18} /> Add Account
                </button>
            </div>

            <div className="card">
                <div className="table-container">
                <table className="table">
                    <thead>
                        <tr>
                            <th>Username</th>
                            <th>Role</th>
                            <th>Created</th>
                            <th style={{ textAlign: 'right' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {admins.map(admin => (
                            <tr key={admin.id}>
                                <td>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{
                                            width: 32, height: 32, borderRadius: 8,
                                            background: admin.role === 'teacher' ? 'rgba(245, 158, 11, 0.15)' : 'var(--color-primary-bg)',
                                            color: admin.role === 'teacher' ? '#f59e0b' : 'var(--color-primary)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            {admin.role === 'teacher' ? <GraduationCap size={16} /> : <Shield size={16} />}
                                        </div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontWeight: 500, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{admin.username}</div>
                                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>ID: {admin.id}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <span className={`badge ${admin.role === 'teacher' ? 'badge-warning' : 'badge-info'}`}>
                                        {admin.role === 'teacher' ? '👩‍🏫 Teacher' : '🔑 Admin'}
                                    </span>
                                </td>
                                <td>
                                    <span style={{ color: 'var(--text-secondary)' }}>
                                        {admin.created_at ? new Date(admin.created_at).toLocaleString() : 'System Default'}
                                    </span>
                                </td>
                                <td>
                                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                        <button className="btn btn-ghost" style={{ color: 'var(--color-danger)' }} onClick={() => handleDelete(admin.id)}>
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
                {admins.length === 0 && (
                    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>
                        No accounts found.
                    </div>
                )}
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Add Account</h2>
                            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
                                <X size={18} />
                            </button>
                        </div>
                        <form onSubmit={handleCreate}>
                            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                {error && (
                                    <div style={{ padding: 12, background: 'var(--color-danger-bg)', color: 'var(--color-danger)', borderRadius: 8, fontSize: 14 }}>
                                        {error}
                                    </div>
                                )}
                                <div className="form-group">
                                    <label className="form-label">Account Type</label>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            type="button"
                                            className={`btn ${role === 'admin' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => { setRole('admin'); setUsername(''); }}
                                            style={{ flex: 1 }}
                                        >
                                            <Shield size={16} /> Admin
                                        </button>
                                        <button
                                            type="button"
                                            className={`btn ${role === 'teacher' ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => { setRole('teacher'); setUsername(''); }}
                                            style={{ flex: 1 }}
                                        >
                                            <GraduationCap size={16} /> Teacher
                                        </button>
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 6 }}>
                                        {role === 'admin'
                                            ? 'Full access to all system features.'
                                            : 'Can only manage schedules, rooms, and enrolled students.'}
                                    </div>
                                </div>
                                {role === 'teacher' ? (
                                    <div className="form-group">
                                        <label className="form-label">Select Teacher</label>
                                        <select
                                            className="form-select"
                                            value={username}
                                            onChange={e => setUsername(e.target.value)}
                                            required
                                        >
                                            <option value="">-- Select a Teacher --</option>
                                            {registeredTeachers.map(t => (
                                                <option key={t.id} value={t.name.trim()}>
                                                    {t.name.trim()} ({t.student_id || 'No ID'})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <label className="form-label">Username</label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            placeholder="username"
                                            value={username}
                                            onChange={e => setUsername(e.target.value)}
                                            required
                                            minLength={3}
                                        />
                                    </div>
                                )}
                                <div className="form-group">
                                    <label className="form-label">Password</label>
                                    <input
                                        type="password"
                                        className="form-input"
                                        placeholder="Secure password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        required
                                        minLength={5}
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? <Loader2 size={16} className="spin" /> : `Create ${role === 'teacher' ? 'Teacher' : 'Admin'}`}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
