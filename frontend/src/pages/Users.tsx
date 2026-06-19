/* Users.tsx — User Management with CRUD + face enrollment via webcam */

import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, Search, Camera, X, Loader2 } from 'lucide-react';
import FaceCapture from '../components/FaceCapture';
import { usersApi } from '../api/client';
import type { User, UserCreate, UserRole } from '../api/types';

const ROLES: UserRole[] = ['student', 'teacher', 'employee', 'janitor', 'security', 'admin'];
const roleColors: Record<string, string> = {
    admin: 'role-admin', teacher: 'role-teacher', student: 'role-student',
    security: 'role-security', employee: 'role-employee', janitor: 'role-janitor',
};

/* ── Users Page ───────────────────────────────────────────── */
export default function UsersPage() {
    const [users, setUsers] = useState<User[]>([]);
    const [search, setSearch] = useState('');
    const [roleFilter, setRoleFilter] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editing, setEditing] = useState<User | null>(null);
    const [form, setForm] = useState<UserCreate>({ name: '', student_id: '', role: 'student', active: true });
    const [step, setStep] = useState<'details' | 'face'>('details');
    const [createdUserId, setCreatedUserId] = useState<string | null>(null);
    const [enrolling, setEnrolling] = useState(false);

    const load = () => usersApi.list().then(setUsers).catch(() => { });
    useEffect(() => { load(); }, []);

    const filtered = users.filter(u => {
        const matchesSearch = u.name.toLowerCase().includes(search.toLowerCase()) ||
            (u.student_id || '').includes(search);
        const matchesRole = !roleFilter || u.role === roleFilter;
        return matchesSearch && matchesRole;
    });

    const openCreate = () => {
        setEditing(null);
        setForm({ name: '', student_id: '', role: 'student', active: true });
        setStep('details');
        setCreatedUserId(null);
        setShowModal(true);
    };

    const openEdit = (user: User) => {
        setEditing(user);
        setForm({ name: user.name, student_id: user.student_id || '', role: user.role, active: user.active });
        setStep('details');
        setShowModal(true);
    };

    const handleSubmit = async () => {
        if (editing?.id) {
            await usersApi.update(editing.id, form);
            setShowModal(false);
            load();
        } else {
            // Create user, then move to face capture
            const newUser = await usersApi.create(form);
            setCreatedUserId(newUser.id!);
            setStep('face');
        }
    };

    const handleFaceCapture = async (photo: Blob, _descriptor: Float32Array) => {
        if (!createdUserId) return;
        setEnrolling(true);
        try {
            await usersApi.enrollFace(createdUserId, photo);
        } catch (err) {
            console.error('Face enrollment failed:', err);
        }
        setEnrolling(false);
        setShowModal(false);
        load();
    };

    const handleFaceSkip = () => {
        setShowModal(false);
        load();
    };

    /* ── Inline face enroll for existing users ── */
    const [enrollUserId, setEnrollUserId] = useState<string | null>(null);

    const handleDelete = async (id: string) => {
        if (confirm('Are you sure you want to delete this user?')) {
            await usersApi.delete(id);
            load();
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div className="flex gap-3">
                    <div className="search-box">
                        <Search />
                        <input className="form-input" placeholder="Search users..." value={search}
                            onChange={e => setSearch(e.target.value)} />
                    </div>
                    <select className="form-select" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                        <option value="">All Roles</option>
                        {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                </div>
                <button className="btn btn-primary" onClick={openCreate}>
                    <Plus size={16} /> Add User
                </button>
            </div>

            <div className="card">
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Student ID</th>
                                <th>Role</th>
                                <th>Status</th>
                                <th>Face Enrolled</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(user => (
                                <tr key={user.id}>
                                    <td style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{user.name}</td>
                                    <td style={{ fontFamily: 'monospace' }}>{user.student_id || '—'}</td>
                                    <td>
                                        <span className={`badge badge-info ${roleColors[user.role] || ''}`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`badge ${user.active ? 'badge-success' : 'badge-neutral'}`}>
                                            <span className={`status-dot ${user.active ? 'online' : 'offline'}`} />
                                            {user.active ? 'Active' : 'Inactive'}
                                        </span>
                                    </td>
                                    <td>
                                        {user.face_encoding_ref ? (
                                            <div className="flex gap-2" style={{ alignItems: 'center' }}>
                                                <span className="badge badge-success">Enrolled</span>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ color: 'var(--color-primary)', fontSize: 12 }}
                                                    onClick={() => setEnrollUserId(user.id!)}
                                                    title="Re-enroll face"
                                                >
                                                    <Camera size={14} /> Re-enroll
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                className="btn btn-ghost btn-sm"
                                                style={{ color: 'var(--color-warning)', fontSize: 12 }}
                                                onClick={() => setEnrollUserId(user.id!)}
                                                title="Enroll face"
                                            >
                                                <Camera size={14} /> Enroll
                                            </button>
                                        )}
                                    </td>
                                    <td>
                                        <div className="flex gap-2">
                                            <button className="btn btn-ghost btn-sm" onClick={() => openEdit(user)} title="Edit">
                                                <Pencil size={14} />
                                            </button>
                                            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(user.id!)} title="Delete">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr><td colSpan={6} className="text-center" style={{ padding: 40, color: 'var(--text-tertiary)' }}>
                                    No users found
                                </td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => { if (step === 'details') setShowModal(false); }}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: step === 'face' ? 560 : 480 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {editing ? 'Edit User' : step === 'details' ? 'Add New User — Details' : 'Add New User — Face Capture'}
                            </h2>
                            <button className="btn btn-ghost" onClick={() => { setShowModal(false); if (step === 'face') load(); }}>
                                <X size={18} />
                            </button>
                        </div>

                        {step === 'details' ? (
                            <>
                                <div className="modal-body">
                                    <div className="form-group">
                                        <label className="form-label">Full Name</label>
                                        <input className="form-input" value={form.name}
                                            onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Enter full name" />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Student ID</label>
                                        <input className="form-input" type="text" value={form.student_id}
                                            onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 8); setForm({ ...form, student_id: v }); }}
                                            placeholder="e.g. 12345678" maxLength={8} pattern="\d{8}" />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Role</label>
                                        <select className="form-select" value={form.role}
                                            onChange={e => setForm({ ...form, role: e.target.value as UserRole })}>
                                            {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                                        </select>
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <input type="checkbox" checked={form.active}
                                                onChange={e => setForm({ ...form, active: e.target.checked })} />
                                            Active
                                        </label>
                                    </div>
                                </div>
                                <div className="modal-footer">
                                    <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                                    <button className="btn btn-primary" onClick={handleSubmit}>
                                        {editing ? 'Save Changes' : 'Next: Face Capture →'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="modal-body">
                                {enrolling ? (
                                    <div style={{ textAlign: 'center', padding: 40 }}>
                                        <Loader2 size={32} className="spin" style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
                                        <div style={{ color: 'var(--text-secondary)' }}>Enrolling face...</div>
                                    </div>
                                ) : (
                                    <FaceCapture onCapture={handleFaceCapture} onSkip={handleFaceSkip} multiAngle />
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Inline face enrollment modal for existing users */}
            {enrollUserId && (
                <div className="modal-overlay" onClick={() => setEnrollUserId(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">Enroll Face</h2>
                            <button className="btn btn-ghost" onClick={() => setEnrollUserId(null)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <FaceCapture
                                multiAngle
                                onCapture={async (photo, _descriptor) => {
                                    try {
                                        await usersApi.enrollFace(enrollUserId, photo);
                                    } catch (err) {
                                        console.error('Enrollment failed:', err);
                                    }
                                    setEnrollUserId(null);
                                    load();
                                }}
                                onSkip={() => setEnrollUserId(null)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
