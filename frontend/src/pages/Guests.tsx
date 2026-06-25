/* Guests.tsx — Temporary Guest Access Management */

import { useState, useEffect } from 'react';
import { UserPlus, X, Clock, Ban, Camera, Loader2 } from 'lucide-react';
import FaceCapture from '../components/FaceCapture';
import { guestsApi, usersApi } from '../api/client';
import { confirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';
import type { Guest, GuestCreate, User } from '../api/types';

export default function GuestsPage() {
    const [guests, setGuests] = useState<Guest[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [showExpired, setShowExpired] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [enrollGuestId, setEnrollGuestId] = useState<string | null>(null);
    const [form, setForm] = useState<GuestCreate>({
        name: '', purpose: '', sponsor_id: '', valid_from: '', valid_until: '',
    });

    const load = () => {
        guestsApi.list(showExpired).then(setGuests).catch(() => { });
        usersApi.list(true).then(setUsers).catch(() => { });
    };
    useEffect(() => { load(); }, [showExpired]);

    const handleCreate = async () => {
        const newGuest = await guestsApi.create(form);
        setShowModal(false);
        setForm({ name: '', purpose: '', sponsor_id: '', valid_from: '', valid_until: '' });
        load();
        toast.success('Guest created');
        // Automatically open face enrollment for the newly created guest
        if (newGuest?.id) {
            setEnrollGuestId(newGuest.id);
        }
    };

    const handleRevoke = async (id: string) => {
        const ok = await confirmDialog({
            title: 'Revoke guest access?',
            message: 'This guest will immediately lose access to all areas.',
            confirmLabel: 'Revoke',
        });
        if (ok) {
            await guestsApi.revoke(id);
            load();
            toast.success('Guest access revoked');
        }
    };

    const formatDateTime = (ts?: string) => ts ? new Date(ts).toLocaleString() : '—';

    const isExpired = (g: Guest) => {
        if (g.revoked) return true;
        if (!g.valid_until) return false;
        return new Date(g.valid_until) < new Date();
    };

    // Default to 2h from now for new guests
    const setDefaultTimes = () => {
        const now = new Date();
        const later = new Date(now.getTime() + 2 * 60 * 60 * 1000);
        setForm({
            ...form,
            valid_from: now.toISOString().slice(0, 16),
            valid_until: later.toISOString().slice(0, 16),
        });
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <button className={`btn ${showExpired ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                        onClick={() => setShowExpired(!showExpired)}>
                        {showExpired ? 'Showing all' : 'Active only'}
                    </button>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {guests.length} guest{guests.length !== 1 ? 's' : ''}
                    </span>
                </div>
                <button className="btn btn-primary" onClick={() => { setShowModal(true); setDefaultTimes(); }}>
                    <UserPlus size={16} /> Register Guest
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                {guests.map(guest => (
                    <div key={guest.id} className="card">
                        <div className="card-header">
                            <div className="card-title">
                                <UserPlus size={16} style={{ flexShrink: 0 }} />
                                <span>{guest.name}</span>
                            </div>
                            <span className={`badge ${isExpired(guest) ? 'badge-danger' : 'badge-success'}`}>
                                {guest.revoked ? 'Revoked' : isExpired(guest) ? 'Expired' : 'Active'}
                            </span>
                        </div>
                        <div className="card-body">
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>
                                <div><strong>Purpose:</strong> {guest.purpose}</div>
                                <div><strong>Sponsor:</strong> {users.find(u => u.id === guest.sponsor_id)?.name || guest.sponsor_id}</div>
                            </div>
                            <div className="flex items-center gap-3" style={{ fontSize: 12 }}>
                                <div className="flex items-center gap-2">
                                    <Clock size={14} style={{ color: 'var(--text-accent)' }} />
                                    <div>
                                        <div style={{ color: 'var(--text-tertiary)' }}>From: {formatDateTime(guest.valid_from)}</div>
                                        <div style={{ color: 'var(--text-tertiary)' }}>Until: {formatDateTime(guest.valid_until)}</div>
                                    </div>
                                </div>
                            </div>
                            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                                {guest.face_encoding_ref ? (
                                    <span className="badge badge-success">Face enrolled</span>
                                ) : (
                                    <>
                                        <span className="badge badge-warning">No face data</span>
                                        {!isExpired(guest) && (
                                            <button className="btn btn-primary btn-sm" onClick={() => setEnrollGuestId(guest.id!)}>
                                                <Camera size={12} /> Enroll Face
                                            </button>
                                        )}
                                    </>
                                )}
                                {!isExpired(guest) && (
                                    <button className="btn btn-danger btn-sm" onClick={() => handleRevoke(guest.id!)}>
                                        <Ban size={12} /> Revoke
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
                {guests.length === 0 && (
                    <div className="card" style={{ gridColumn: '1 / -1' }}>
                        <div className="card-body text-center" style={{ padding: 60, color: 'var(--text-tertiary)' }}>
                            <UserPlus size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
                            <div>No guests registered</div>
                        </div>
                    </div>
                )}
            </div>

            {showModal && (
                <div className="modal-overlay" onClick={() => setShowModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Register Guest</h2>
                            <button className="btn btn-ghost" onClick={() => setShowModal(false)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Guest Name</label>
                                <input className="form-input" value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Purpose of Visit</label>
                                <input className="form-input" value={form.purpose}
                                    onChange={e => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Equipment demonstration" />
                            </div>


                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <div className="form-group">
                                    <label className="form-label">Valid From</label>
                                    <input className="form-input" type="datetime-local" value={form.valid_from}
                                        onChange={e => setForm({ ...form, valid_from: e.target.value })} />
                                </div>
                                <div className="form-group">
                                    <label className="form-label">Valid Until</label>
                                    <input className="form-input" type="datetime-local" value={form.valid_until}
                                        onChange={e => setForm({ ...form, valid_until: e.target.value })} />
                                </div>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleCreate}>Register Guest</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Face Enrollment Modal */}
            {enrollGuestId && (
                <div className="modal-overlay" onClick={() => setEnrollGuestId(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">Enroll Guest Face</h2>
                            <button className="btn btn-ghost" onClick={() => setEnrollGuestId(null)}>
                                <X size={18} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <FaceCapture
                                onCapture={async (photo, _descriptor) => {
                                    try {
                                        await guestsApi.enrollFace(enrollGuestId, photo);
                                        toast.success('Face enrolled');
                                    } catch (err) {
                                        console.error('Enrollment failed:', err);
                                        toast.error('Face enrollment failed');
                                    }
                                    setEnrollGuestId(null);
                                    load();
                                }}
                                onSkip={() => setEnrollGuestId(null)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
