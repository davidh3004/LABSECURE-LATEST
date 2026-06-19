/* Permissions.tsx — Door unlock and access permissions */

import { useState, useEffect } from 'react';
import { Plus, Trash2, X, Shield, Key, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { permissionsApi, usersApi, schedulesApi } from '../api/client';
import type { Permission, User, UserRole, Schedule } from '../api/types';

const ROLES: UserRole[] = ['student', 'teacher', 'employee', 'janitor', 'security', 'admin'];

const emptyForm = {
    target: 'user' as 'user' | 'role',
    user_id: '',
    role: '' as string,
    schedule_ids: [] as string[],
    can_unlock: true,
    can_access_outside_schedule: false,
};

export default function PermissionsPage() {
    const [permissions, setPermissions] = useState<Permission[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [form, setForm] = useState({ ...emptyForm });
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = () => {
        permissionsApi.list().then(setPermissions).catch(() => { });
        usersApi.list().then(setUsers).catch(() => { });
        schedulesApi.list().then(setSchedules).catch(() => { });
    };
    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        if (form.target === 'user' && !form.user_id) return;
        if (form.target === 'role' && !form.role) return;
        await permissionsApi.create({
            user_id: form.target === 'user' ? form.user_id : undefined,
            role: form.target === 'role' ? form.role : undefined,
            schedule_ids: form.schedule_ids,
            can_unlock: form.can_unlock,
            can_access_outside_schedule: form.can_access_outside_schedule,
            granted_by: 'admin',
        } as any);
        setShowModal(false);
        setForm({ ...emptyForm });
        load();
    };

    const toggleUnlock = async (perm: Permission) => {
        await permissionsApi.update(perm.id!, { can_unlock: !perm.can_unlock });
        load();
    };

    const toggleOutside = async (perm: Permission) => {
        await permissionsApi.update(perm.id!, { can_access_outside_schedule: !perm.can_access_outside_schedule });
        load();
    };

    const handleDelete = async (id: string) => {
        await permissionsApi.delete(id);
        load();
    };

    const toggleSchedule = (id: string) => {
        setForm(f => ({
            ...f,
            schedule_ids: f.schedule_ids.includes(id)
                ? f.schedule_ids.filter(s => s !== id)
                : [...f.schedule_ids, id],
        }));
    };

    const getUserName = (id?: string) => {
        if (!id) return '—';
        return users.find(u => u.id === id)?.name || id;
    };

    const getScheduleNames = (ids: string[]) => {
        if (!ids || ids.length === 0) return null;
        return ids.map(id => schedules.find(s => s.id === id)?.name || id);
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Shield size={20} style={{ color: 'var(--text-accent)' }} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {permissions.length} permission rule{permissions.length !== 1 ? 's' : ''}
                    </span>
                </div>
                <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                    <Plus size={16} /> Add Permission
                </button>
            </div>

            {/* Legend */}
            <div style={{
                display: 'flex', gap: 20, marginBottom: 20, fontSize: 12,
                color: 'var(--text-tertiary)', flexWrap: 'wrap',
            }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Key size={13} style={{ color: '#22c55e' }} />
                    Can Unlock — allowed to turn the knob and open the door
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Clock size={13} style={{ color: '#f59e0b' }} />
                    Outside Schedule — can enter when no active schedule is running
                </span>
            </div>

            {/* Permissions Table */}
            <div className="card">
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Type</th>
                                <th>Who</th>
                                <th>Schedules / Rooms</th>
                                <th style={{ textAlign: 'center' }}>Can Unlock</th>
                                <th style={{ textAlign: 'center' }}>Outside Schedule</th>
                                <th>Granted By</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {permissions.map(perm => {
                                const scheduleNames = getScheduleNames(perm.schedule_ids);
                                const isExpanded = expandedId === perm.id;
                                return (
                                    <tr key={perm.id}>
                                        <td>
                                            <span className={`badge ${perm.user_id ? 'badge-info' : 'badge-warning'}`}>
                                                {perm.user_id ? 'User' : 'Role'}
                                            </span>
                                        </td>
                                        <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {perm.user_id ? getUserName(perm.user_id) : (
                                                <span style={{ textTransform: 'capitalize' }}>{perm.role}</span>
                                            )}
                                        </td>
                                        <td>
                                            {!scheduleNames ? (
                                                <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>All schedules</span>
                                            ) : (
                                                <div>
                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                        {(isExpanded ? scheduleNames : scheduleNames.slice(0, 2)).map((name, i) => (
                                                            <span key={i} className="badge badge-neutral" style={{ fontSize: 10 }}>{name}</span>
                                                        ))}
                                                        {!isExpanded && scheduleNames.length > 2 && (
                                                            <button
                                                                onClick={() => setExpandedId(perm.id!)}
                                                                style={{
                                                                    border: 'none', background: 'none', cursor: 'pointer',
                                                                    color: 'var(--color-primary)', fontSize: 11,
                                                                    display: 'flex', alignItems: 'center', gap: 2,
                                                                }}
                                                            >
                                                                +{scheduleNames.length - 2} more <ChevronDown size={11} />
                                                            </button>
                                                        )}
                                                        {isExpanded && (
                                                            <button
                                                                onClick={() => setExpandedId(null)}
                                                                style={{
                                                                    border: 'none', background: 'none', cursor: 'pointer',
                                                                    color: 'var(--text-tertiary)', fontSize: 11,
                                                                    display: 'flex', alignItems: 'center', gap: 2,
                                                                }}
                                                            >
                                                                <ChevronUp size={11} /> less
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <div
                                                className={`toggle-switch ${perm.can_unlock ? 'active' : ''}`}
                                                onClick={() => toggleUnlock(perm)}
                                                style={{ margin: '0 auto' }}
                                            />
                                        </td>
                                        <td style={{ textAlign: 'center' }}>
                                            <div
                                                className={`toggle-switch ${perm.can_access_outside_schedule ? 'active' : ''}`}
                                                onClick={() => toggleOutside(perm)}
                                                style={{ margin: '0 auto' }}
                                            />
                                        </td>
                                        <td style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>{perm.granted_by}</td>
                                        <td>
                                            <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(perm.id!)}>
                                                <Trash2 size={14} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                            {permissions.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center" style={{ padding: 40, color: 'var(--text-tertiary)' }}>
                                        No permissions configured.
                                        Assigned teachers are added automatically when saved on a schedule.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">Add Permission</h2>
                            <button className="btn btn-ghost" onClick={() => setShowModal(false)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">

                            {/* Who */}
                            <div className="form-group">
                                <label className="form-label">Apply to</label>
                                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                                    {(['user', 'role'] as const).map(t => (
                                        <button
                                            key={t}
                                            className={`btn btn-sm ${form.target === t ? 'btn-primary' : 'btn-secondary'}`}
                                            onClick={() => setForm(f => ({ ...f, target: t, user_id: '', role: '' }))}
                                        >
                                            {t === 'user' ? 'Specific person' : 'Entire role'}
                                        </button>
                                    ))}
                                </div>
                                {form.target === 'user' ? (
                                    <select className="form-select" value={form.user_id}
                                        onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
                                        <option value="">— Select person —</option>
                                        {users.map(u => (
                                            <option key={u.id} value={u.id}>
                                                {u.name} ({u.role})
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <select className="form-select" value={form.role}
                                        onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
                                        <option value="">— Select role —</option>
                                        {ROLES.map(r => (
                                            <option key={r} value={r}>
                                                {r.charAt(0).toUpperCase() + r.slice(1)}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* Scope */}
                            <div className="form-group">
                                <label className="form-label">
                                    Schedules / Rooms
                                    <span style={{ fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: 6, fontSize: 11 }}>
                                        (leave all unchecked = access to every schedule)
                                    </span>
                                </label>
                                <div style={{
                                    maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border-color)',
                                    borderRadius: 8, padding: '6px 0',
                                }}>
                                    {schedules.length === 0 && (
                                        <div style={{ padding: '10px 14px', color: 'var(--text-tertiary)', fontSize: 12 }}>
                                            No schedules found
                                        </div>
                                    )}
                                    {schedules.map(s => (
                                        <label key={s.id} style={{
                                            display: 'flex', alignItems: 'center', gap: 10,
                                            padding: '7px 14px', cursor: 'pointer',
                                            background: form.schedule_ids.includes(s.id!) ? 'var(--color-primary-bg)' : 'transparent',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={form.schedule_ids.includes(s.id!)}
                                                onChange={() => toggleSchedule(s.id!)}
                                            />
                                            <span style={{ flex: 1, fontSize: 13 }}>{s.name}</span>
                                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {s.start_time}–{s.end_time}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                                {form.schedule_ids.length > 0 && (
                                    <div style={{ fontSize: 11, color: 'var(--color-primary)', marginTop: 4 }}>
                                        {form.schedule_ids.length} schedule{form.schedule_ids.length !== 1 ? 's' : ''} selected
                                    </div>
                                )}
                            </div>

                            {/* What */}
                            <div className="form-group">
                                <label className="form-label">Permissions granted</label>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={form.can_unlock}
                                            onChange={e => setForm(f => ({ ...f, can_unlock: e.target.checked }))}
                                            style={{ marginTop: 2 }}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                                                <Key size={13} style={{ color: '#22c55e' }} /> Can unlock the door
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                                                Allows this person/role to turn the knob and unlock the door during the selected schedules.
                                            </div>
                                        </div>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                                        <input
                                            type="checkbox"
                                            checked={form.can_access_outside_schedule}
                                            onChange={e => setForm(f => ({ ...f, can_access_outside_schedule: e.target.checked }))}
                                            style={{ marginTop: 2 }}
                                        />
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                                                <Clock size={13} style={{ color: '#f59e0b' }} /> Can access outside scheduled hours
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                                                Allows entry even when there is no active schedule running for the room.
                                            </div>
                                        </div>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button
                                className="btn btn-primary"
                                onClick={handleCreate}
                                disabled={form.target === 'user' ? !form.user_id : !form.role}
                            >
                                Add Permission
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
