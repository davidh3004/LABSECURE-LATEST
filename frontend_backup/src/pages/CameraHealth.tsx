/* CameraHealth.tsx — Camera Management with Add/Delete + Health Monitoring */

import { useState, useEffect } from 'react';
import { Camera, Wifi, WifiOff, Activity, Server, RefreshCw, Plus, Trash2, X, DoorOpen, Pencil } from 'lucide-react';
import { camerasApi, roomsApi } from '../api/client';
import type { HealthResponse, CameraConfig, Room } from '../api/types';

export default function CameraHealthPage() {
    const [health, setHealth] = useState<HealthResponse | null>(null);
    const [cameras, setCameras] = useState<CameraConfig[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
    const [showAddModal, setShowAddModal] = useState(false);
    const [editCam, setEditCam] = useState<CameraConfig | null>(null);
    const [editForm, setEditForm] = useState({ name: '', ip: '', room_id: '' });
    const [newCam, setNewCam] = useState({ name: '', type: 'webcam' as 'ip' | 'webcam', ip: '', room_id: '' });

    const load = () => {
        camerasApi.health().then(h => { setHealth(h); setLastRefresh(new Date()); }).catch(() => { });
        camerasApi.list().then(setCameras).catch(() => { });
        roomsApi.list().then(setRooms).catch(() => { });
    };

    useEffect(() => {
        load();
        const interval = setInterval(load, 60000);
        return () => clearInterval(interval);
    }, []);

    const getCameraHealth = (camId: string) =>
        health?.cameras?.find(c => c.camera_id === camId);

    const getNetworkHealth = (camId: string) =>
        health?.network?.[camId];

    const switchHealth = health?.network?.['switch'];

    const handleAddCamera = async () => {
        try {
            await camerasApi.create({
                name: newCam.name,
                type: newCam.type,
                ip: newCam.type === 'ip' ? newCam.ip : undefined,
                room_id: newCam.room_id || undefined,
            });
            setShowAddModal(false);
            setNewCam({ name: '', type: 'webcam', ip: '', room_id: '' });
            load();
        } catch (err) {
            console.error('Failed to add camera:', err);
        }
    };

    const handleDeleteCamera = async (id: string) => {
        if (confirm('Delete this camera?')) {
            await camerasApi.delete(id);
            load();
        }
    };

    const openEditCamera = (cam: CameraConfig) => {
        setEditCam(cam);
        setEditForm({ name: cam.name, ip: cam.ip || '', room_id: cam.room_id || '' });
    };

    const handleEditCamera = async () => {
        if (!editCam) return;
        await camerasApi.update(editCam.id, {
            name: editForm.name,
            ip: editCam.type === 'ip' ? editForm.ip : undefined,
            room_id: editForm.room_id || undefined,
        } as any);
        setEditCam(null);
        load();
    };

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <Server size={20} style={{ color: 'var(--text-accent)' }} />
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                        Auto-refresh every 30s
                        {lastRefresh && <span> • Last: {lastRefresh.toLocaleTimeString()}</span>}
                    </span>
                </div>
                <div className="flex gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={load}>
                        <RefreshCw size={14} /> Refresh
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>
                        <Plus size={14} /> Add Camera
                    </button>
                </div>
            </div>

            {/* Switch Status */}
            <div className="card mb-6">
                <div className="card-header">
                    <div className="card-title">
                        <Server size={16} />
                        Cisco Catalyst Switch
                    </div>
                    {switchHealth && (
                        <span className={`badge ${switchHealth.reachable ? 'badge-success' : 'badge-danger'}`}>
                            <span className={`status-dot ${switchHealth.reachable ? 'online' : 'offline'}`} />
                            {switchHealth.reachable ? 'Online' : 'Unreachable'}
                        </span>
                    )}
                </div>
                <div className="card-body">
                    <div className="health-metrics">
                        <div className="health-metric">
                            <div className="health-metric-label">IP Address</div>
                            <div className="health-metric-value">{switchHealth?.ip || '—'}</div>
                        </div>
                        <div className="health-metric">
                            <div className="health-metric-label">Latency</div>
                            <div className="health-metric-value">
                                {switchHealth?.latency_ms != null ? `${switchHealth.latency_ms}ms` : '—'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* No cameras message */}
            {cameras.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
                    <Camera size={48} style={{ color: 'var(--text-tertiary)', margin: '0 auto 16px' }} />
                    <div style={{ color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600 }}>
                        No cameras configured
                    </div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 20 }}>
                        Add a webcam or IP camera to start monitoring
                    </div>
                    <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                        <Plus size={16} /> Add Camera
                    </button>
                </div>
            )}

            {/* Camera Cards */}
            <div className="health-grid">
                {cameras.map(cam => {
                    const camHealth = getCameraHealth(cam.id);
                    const netHealth = getNetworkHealth(cam.id);
                    const connected = camHealth?.connected || false;

                    return (
                        <div key={cam.id} className="health-card">
                            <div className="health-card-header">
                                <div className="flex items-center gap-3" style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 'var(--radius-md)',
                                        background: connected ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        flexShrink: 0,
                                    }}>
                                        {connected ? <Wifi size={20} style={{ color: 'var(--color-success)' }} /> :
                                            <WifiOff size={20} style={{ color: 'var(--color-danger)' }} />}
                                    </div>
                                    <div style={{ minWidth: 0, overflow: 'hidden' }}>
                                        <div className="health-device-name">{cam.name}</div>
                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {cam.type === 'webcam' ? 'Local Device' : cam.ip || 'IP Camera'}
                                            {cam.room_id && (() => {
                                                const room = rooms.find(r => r.id === cam.room_id);
                                                return room ? <span> · <DoorOpen size={10} style={{ verticalAlign: '-1px' }} /> {room.name}</span> : null;
                                            })()}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2" style={{ flexShrink: 0 }}>
                                    <span className={`badge ${connected ? 'badge-success' : 'badge-danger'}`}>
                                        {connected ? 'Online' : 'Offline'}
                                    </span>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => openEditCamera(cam)}
                                        title="Edit camera"
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={() => handleDeleteCamera(cam.id)}
                                        title="Delete camera"
                                        style={{ color: 'var(--color-danger)' }}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            <div className="health-metrics">
                                <div className="health-metric">
                                    <div className="health-metric-label">FPS</div>
                                    <div className="health-metric-value" style={{
                                        color: (camHealth?.fps || 0) > 15 ? 'var(--color-success)' :
                                            (camHealth?.fps || 0) > 5 ? 'var(--color-warning)' : 'var(--color-danger)',
                                    }}>
                                        {camHealth?.fps || 0}
                                    </div>
                                </div>
                                <div className="health-metric">
                                    <div className="health-metric-label">Network Latency</div>
                                    <div className="health-metric-value">
                                        {netHealth?.latency_ms != null ? `${netHealth.latency_ms}ms` : '—'}
                                    </div>
                                </div>
                                <div className="health-metric">
                                    <div className="health-metric-label">Type</div>
                                    <div className="health-metric-value" style={{ fontSize: 13 }}>
                                        {cam.type === 'webcam' ? 'Webcam' : 'IP Camera'}
                                    </div>
                                </div>
                                <div className="health-metric">
                                    <div className="health-metric-label">Network</div>
                                    <div className="health-metric-value">
                                        {netHealth ? (
                                            <span className={`badge ${netHealth.reachable ? 'badge-success' : 'badge-danger'}`}>
                                                {netHealth.reachable ? 'Reachable' : 'Down'}
                                            </span>
                                        ) : (
                                            <span className="badge badge-neutral">N/A</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Add Camera Modal */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">Add Camera</h2>
                            <button className="btn btn-ghost" onClick={() => setShowAddModal(false)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Camera Name</label>
                                <input className="form-input" value={newCam.name}
                                    onChange={e => setNewCam({ ...newCam, name: e.target.value })}
                                    placeholder="e.g. Lab Entrance Camera" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Type</label>
                                <select className="form-select" value={newCam.type}
                                    onChange={e => setNewCam({ ...newCam, type: e.target.value as 'ip' | 'webcam' })}>
                                    <option value="webcam">Webcam (Local Device)</option>
                                    <option value="ip">IP Camera (RTSP/Network)</option>
                                </select>
                            </div>
                            {newCam.type === 'ip' && (
                                <div className="form-group">
                                    <label className="form-label">RTSP URL</label>
                                    <input className="form-input" value={newCam.ip}
                                        onChange={e => setNewCam({ ...newCam, ip: e.target.value })}
                                        placeholder="rtsp://user:pass@192.168.1.101:554/stream1" />
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                        Full RTSP URL with credentials. A bare IP (e.g. 192.168.1.101) will use port 554/stream1.
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Room</label>
                                <select className="form-select" value={newCam.room_id}
                                    onChange={e => setNewCam({ ...newCam, room_id: e.target.value })}>
                                    <option value="">No room assigned</option>
                                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.floor ? ` (${r.floor})` : ''}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleAddCamera}
                                disabled={!newCam.name.trim()}>
                                <Plus size={16} /> Add Camera
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Edit Camera Modal */}
            {editCam && (
                <div className="modal-overlay" onClick={() => setEditCam(null)}>
                    <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                        <div className="modal-header">
                            <h2 className="modal-title">Edit Camera</h2>
                            <button className="btn btn-ghost" onClick={() => setEditCam(null)}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label className="form-label">Camera Name</label>
                                <input className="form-input" value={editForm.name}
                                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                    placeholder="e.g. Lab Entrance Camera" />
                            </div>
                            {editCam.type === 'ip' && (
                                <div className="form-group">
                                    <label className="form-label">RTSP URL</label>
                                    <input className="form-input" value={editForm.ip}
                                        onChange={e => setEditForm({ ...editForm, ip: e.target.value })}
                                        placeholder="rtsp://user:pass@192.168.1.101:554/stream1" />
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                        Full RTSP URL with credentials. A bare IP (e.g. 192.168.1.101) will use port 554/stream1.
                                    </div>
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Room</label>
                                <select className="form-select" value={editForm.room_id}
                                    onChange={e => setEditForm({ ...editForm, room_id: e.target.value })}>
                                    <option value="">No room assigned</option>
                                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.floor ? ` (${r.floor})` : ''}</option>)}
                                </select>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setEditCam(null)}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleEditCamera}
                                disabled={!editForm.name.trim()}>
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
