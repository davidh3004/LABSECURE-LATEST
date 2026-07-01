/* Rooms.tsx — Room Management */

import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, DoorOpen, Camera, Calendar } from 'lucide-react';
import { roomsApi, camerasApi, schedulesApi } from '../api/client';
import type { Room, RoomCreate, CameraConfig, Schedule } from '../api/types';

export default function RoomsPage() {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [cameras, setCameras] = useState<CameraConfig[]>([]);
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [showForm, setShowForm] = useState(false);
    const [editingRoom, setEditingRoom] = useState<Room | null>(null);
    const [form, setForm] = useState<RoomCreate>({ name: '', description: '', floor: '' });

    const load = () => {
        roomsApi.list().then(setRooms).catch(() => { });
        camerasApi.list().then(setCameras).catch(() => { });
        schedulesApi.list().then(setSchedules).catch(() => { });
    };

    useEffect(() => { load(); }, []);

    const openCreate = () => {
        setEditingRoom(null);
        setForm({ name: '', description: '', floor: '' });
        setShowForm(true);
    };

    const openEdit = (room: Room) => {
        setEditingRoom(room);
        setForm({ name: room.name, description: room.description || '', floor: room.floor || '' });
        setShowForm(true);
    };

    const handleSubmit = async () => {
        if (!form.name.trim()) return;
        if (editingRoom?.id) {
            await roomsApi.update(editingRoom.id, form);
        } else {
            await roomsApi.create(form);
        }
        setShowForm(false);
        load();
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this room?')) return;
        await roomsApi.delete(id);
        load();
    };

    const getCamerasForRoom = (roomId?: string) =>
        cameras.filter(c => c.room_id === roomId);

    const getSchedulesForRoom = (roomId?: string) =>
        schedules.filter(s => s.room_id === roomId);

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
                    {rooms.length} room{rooms.length !== 1 ? 's' : ''} configured
                </div>
                <button className="btn btn-primary" onClick={openCreate}>
                    <Plus size={16} /> Add Room
                </button>
            </div>

            {/* Room Grid */}
            {rooms.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', padding: '80px 20px' }}>
                    <DoorOpen size={56} style={{ color: 'var(--text-tertiary)', margin: '0 auto 16px' }} />
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: 18, marginBottom: 8 }}>
                        No rooms configured yet
                    </div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>
                        Create rooms to organize your cameras and schedules
                    </div>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 }}>
                    {rooms.map(room => {
                        const roomCameras = getCamerasForRoom(room.id);
                        const roomSchedules = getSchedulesForRoom(room.id);
                        return (
                            <div key={room.id} className="card" style={{ overflow: 'hidden' }}>
                                <div className="card-body">
                                    {/* Room header */}
                                    <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
                                        <div className="flex items-center gap-3" style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{
                                                width: 42, height: 42, borderRadius: 10,
                                                background: 'var(--color-primary-bg)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                flexShrink: 0,
                                            }}>
                                                <DoorOpen size={20} style={{ color: 'var(--color-primary)' }} />
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 700, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{room.name}</div>
                                                {room.floor && (
                                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        Floor: {room.floor}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button className="btn btn-secondary btn-sm" onClick={() => openEdit(room)}
                                                style={{ padding: '4px 8px' }}>
                                                <Pencil size={14} />
                                            </button>
                                            <button className="btn btn-danger btn-sm" onClick={() => room.id && handleDelete(room.id)}
                                                style={{ padding: '4px 8px' }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Description */}
                                    {room.description && (
                                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                                            {room.description}
                                        </div>
                                    )}

                                    {/* Stats */}
                                    <div style={{ display: 'flex', gap: 16, padding: '12px 0', borderTop: '1px solid var(--border-color)' }}>
                                        <div className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                            <Camera size={14} style={{ color: 'var(--color-primary)' }} />
                                            <span><strong>{roomCameras.length}</strong> camera{roomCameras.length !== 1 ? 's' : ''}</span>
                                        </div>
                                        <div className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                                            <Calendar size={14} style={{ color: 'var(--color-primary)' }} />
                                            <span><strong>{roomSchedules.length}</strong> schedule{roomSchedules.length !== 1 ? 's' : ''}</span>
                                        </div>
                                    </div>

                                    {/* Camera list */}
                                    {roomCameras.length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>
                                                Cameras
                                            </div>
                                            {roomCameras.map(cam => (
                                                <div key={cam.id} className="flex items-center gap-2"
                                                    style={{ fontSize: 13, padding: '4px 0', color: 'var(--text-secondary)' }}>
                                                    <span className={`status-dot ${cam.enabled ? 'online' : 'offline'}`} style={{ flexShrink: 0 }} />
                                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cam.name}</span>
                                                    <span className="badge badge-info" style={{ fontSize: 10, flexShrink: 0 }}>{cam.type}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Schedule list */}
                                    {roomSchedules.length > 0 && (
                                        <div style={{ marginTop: 8 }}>
                                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>
                                                Schedules
                                            </div>
                                            {roomSchedules.map(sched => (
                                                <div key={sched.id} className="flex items-center gap-2"
                                                    style={{ fontSize: 13, padding: '4px 0', color: 'var(--text-secondary)' }}>
                                                    <Calendar size={12} style={{ flexShrink: 0 }} />
                                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sched.name}</span>
                                                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0 }}>
                                                        {sched.start_time}–{sched.end_time}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Create/Edit Modal */}
            {showForm && (
                <div className="modal-overlay" onClick={() => setShowForm(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">{editingRoom ? 'Edit Room' : 'Add Room'}</h2>
                            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(false)}>
                                <X size={16} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Room Name *</label>
                                <input className="form-input" placeholder="e.g. Telematics Lab"
                                    value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Description</label>
                                <input className="form-input" placeholder="e.g. Main research laboratory"
                                    value={form.description || ''} onChange={e => setForm({ ...form, description: e.target.value })} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Floor</label>
                                <input className="form-input" placeholder="e.g. 2nd Floor"
                                    value={form.floor || ''} onChange={e => setForm({ ...form, floor: e.target.value })} />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSubmit}
                                disabled={!form.name.trim()}>
                                {editingRoom ? 'Save Changes' : 'Create Room'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
