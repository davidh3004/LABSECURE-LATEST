/* DoorRoomPage.tsx — Per-room door simulation with live camera feed */

import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    Lock, Unlock, DoorOpen, ArrowLeft, CheckCircle2, XCircle,
    AlertTriangle, Timer, CalendarDays, ScanLine, UserX, Camera,
} from 'lucide-react';
import { doorsApi, camerasApi } from '../api/client';
import { toast } from '../components/ui/Toast';
import CameraFeed from '../components/CameraFeed';
import { DoorEntryLists } from '../components/door/DoorEntryLists';
import type { DoorStatus, KnockResponse, CameraConfig } from '../api/types';

export default function DoorRoomPage() {
    const { roomId } = useParams<{ roomId: string }>();
    const navigate = useNavigate();

    const [door, setDoor] = useState<DoorStatus | null>(null);
    const [camera, setCamera] = useState<CameraConfig | null>(null);
    const [loading, setLoading] = useState(true);

    const [knockResult, setKnockResult] = useState<KnockResponse | null>(null);
    const [scanMsg, setScanMsg] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [photoModal, setPhotoModal] = useState<{ name: string; photo: string } | null>(null);

    const resolveCamera = useCallback((cameras: CameraConfig[], rid: string): CameraConfig | null => {
        const roomCam = cameras.find(c => c.room_id === rid && c.enabled)
            ?? cameras.find(c => c.room_id === rid);
        if (roomCam) return roomCam;
        const fallback = cameras.find(c => c.enabled) ?? cameras[0];
        return fallback ?? null;
    }, []);

    const refresh = useCallback(async () => {
        if (!roomId) return;
        try {
            const [doorData, cameras] = await Promise.all([
                doorsApi.status(roomId),
                camerasApi.list(),
            ]);
            setDoor(doorData);
            setCamera(resolveCamera(cameras, roomId));
        } catch {
            toast.error('Failed to load room data');
        }
        setLoading(false);
    }, [roomId, resolveCamera]);

    useEffect(() => {
        refresh();
        const iv = setInterval(refresh, 5000);
        return () => clearInterval(iv);
    }, [refresh]);

    const handleKnock = async () => {
        if (!roomId) return;
        setActionLoading(true);
        setKnockResult(null);
        try {
            const res = await doorsApi.knock(roomId);
            setKnockResult(res);
            await refresh();
        } catch (err: any) {
            setKnockResult({
                granted: false,
                message: err?.response?.data?.detail || 'Error',
                reason: 'error',
            });
        }
        setActionLoading(false);
        setTimeout(() => setKnockResult(null), 8000);
    };

    const handleScan = async () => {
        if (!roomId) return;
        setActionLoading(true);
        setScanMsg(null);
        try {
            const res = await doorsApi.scan(roomId);
            setScanMsg(
                res.scanned === 0
                    ? 'No faces detected in camera view'
                    : `Scanned ${res.scanned} face${res.scanned !== 1 ? 's' : ''}`,
            );
            await refresh();
        } catch (err: any) {
            setScanMsg(err?.response?.data?.detail || 'Scan error');
        }
        setActionLoading(false);
        setTimeout(() => setScanMsg(null), 5000);
    };

    if (!roomId) {
        return (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                Invalid room. <Link to="/doors">Back to doors</Link>
            </div>
        );
    }

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                Loading room…
            </div>
        );
    }

    if (!door) {
        return (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                Room not found. <Link to="/doors">Back to doors</Link>
            </div>
        );
    }

    const roomCamera = camera;
    const usingFallbackCamera = roomCamera && roomCamera.room_id !== roomId;

    return (
        <div className="door-room-page">
            <button
                className="btn btn-ghost btn-sm"
                onClick={() => navigate('/doors')}
                style={{ marginBottom: 16, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
                <ArrowLeft size={16} /> Back to Door Simulation
            </button>

            {/* Room header */}
            <div style={{
                background: door.locked
                    ? 'linear-gradient(135deg, #1e293b, #0f172a)'
                    : 'linear-gradient(135deg, #064e3b, #022c22)',
                borderRadius: 14, padding: '20px 24px', marginBottom: 24,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: '1 1 auto' }}>
                    {door.locked
                        ? <Lock size={28} style={{ color: '#ef4444', flexShrink: 0 }} />
                        : <Unlock size={28} style={{ color: '#22c55e', flexShrink: 0 }} />
                    }
                    <div style={{ minWidth: 0 }}>
                        <h1 className="door-room-title" style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 }}>
                            {door.room_name}
                        </h1>
                        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 4 }}>
                            {door.locked ? 'Locked' : `Unlocked by ${door.unlocked_by_name}`}
                        </div>
                    </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                    {door.scanning && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                            <span style={{
                                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                background: '#22c55e', animation: 'pulse 1.5s infinite',
                            }} />
                            AUTO-SCAN
                        </div>
                    )}
                    {door.active_schedule && (
                        <div style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 6,
                            background: 'rgba(255,255,255,0.1)', color: '#cbd5e1',
                            display: 'flex', alignItems: 'center', gap: 4,
                        }}>
                            <CalendarDays size={11} />
                            {door.active_schedule.name} ({door.active_schedule.start_time}–{door.active_schedule.end_time})
                        </div>
                    )}
                </div>
            </div>

            <div className="door-room-grid">
                {/* Camera feed */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <Camera size={18} style={{ color: 'var(--color-primary)' }} />
                        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>
                            Room Camera
                        </h2>
                    </div>

                    {roomCamera ? (
                        <>
                            {usingFallbackCamera && (
                                <div style={{
                                    fontSize: 12, color: '#f59e0b', marginBottom: 10,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    padding: '8px 12px', borderRadius: 8,
                                    background: '#f59e0b15', border: '1px solid #f59e0b33',
                                }}>
                                    <AlertTriangle size={14} />
                                    No camera assigned to this room — showing {roomCamera.name}
                                </div>
                            )}
                            <CameraFeed camera={roomCamera} compact />
                        </>
                    ) : (
                        <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
                            <Camera size={40} style={{ color: 'var(--text-tertiary)', marginBottom: 12 }} />
                            <div style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                                No camera available
                            </div>
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, marginTop: 6 }}>
                                Assign a camera to this room in Camera Health
                            </div>
                        </div>
                    )}
                </div>

                {/* Controls + recognition */}
                <div className="door-room-control-panel" style={{
                    background: 'var(--bg-secondary)', borderRadius: 14,
                    border: '1px solid var(--border-color)', padding: '20px 24px',
                }}>
                    {!door.locked && door.auto_lock_at && (
                        <div style={{
                            fontSize: 12, color: '#f59e0b', marginBottom: 14,
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <Timer size={13} />
                            Auto-locks at {door.auto_lock_at}
                        </div>
                    )}

                    {!door.active_schedule && door.locked && (
                        <div style={{
                            fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 14,
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}>
                            <AlertTriangle size={13} />
                            No active schedule — set the simulation clock on the doors page
                        </div>
                    )}

                    <div className="door-action-row">
                        <button
                            className="btn btn-primary"
                            onClick={handleKnock}
                            disabled={actionLoading}
                            style={{ padding: '12px 16px', fontSize: 15 }}
                        >
                            {actionLoading
                                ? <>Checking…</>
                                : <><DoorOpen size={16} /> Turn Knob</>
                            }
                        </button>

                        {!door.locked && (
                            <button
                                className="btn btn-secondary"
                                onClick={handleScan}
                                disabled={actionLoading}
                                style={{
                                    padding: '12px 16px', fontSize: 15,
                                    borderColor: '#22c55e55', color: '#22c55e',
                                }}
                            >
                                {actionLoading
                                    ? <>Scanning…</>
                                    : <><ScanLine size={16} /> Push Door Open</>
                                }
                            </button>
                        )}
                    </div>

                    {knockResult && (
                        <div style={{
                            padding: '12px 16px', borderRadius: 10, marginBottom: 14, fontSize: 14,
                            background: knockResult.granted ? '#22c55e15' : '#ef444415',
                            color: knockResult.granted ? '#22c55e' : '#ef4444',
                            border: `1px solid ${knockResult.granted ? '#22c55e33' : '#ef444433'}`,
                            display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            {knockResult.granted ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                            {knockResult.message}
                        </div>
                    )}

                    {scanMsg && (
                        <div style={{
                            padding: '12px 16px', borderRadius: 10, marginBottom: 14, fontSize: 14,
                            background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
                            border: '1px solid var(--color-primary)33',
                        }}>
                            {scanMsg}
                        </div>
                    )}

                    <h3 style={{
                        fontSize: 14, fontWeight: 600, color: 'var(--text-main)',
                        margin: '20px 0 12px', display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        Recognized at this door
                    </h3>

                    <DoorEntryLists door={door} onViewPhoto={(name, photo) => setPhotoModal({ name, photo })} />
                </div>
            </div>

            {/* Photo modal */}
            {photoModal && (
                <div
                    onClick={() => setPhotoModal(null)}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        zIndex: 1000,
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: 'var(--bg-secondary)', borderRadius: 14, padding: 24,
                            maxWidth: 400, width: '90%', border: '1px solid var(--border-color)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <span style={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <UserX size={16} /> {photoModal.name}
                            </span>
                            <button
                                onClick={() => setPhotoModal(null)}
                                style={{
                                    border: 'none', background: 'none', cursor: 'pointer',
                                    color: 'var(--text-secondary)', fontSize: 20, lineHeight: 1,
                                }}
                            >×</button>
                        </div>
                        <img
                            src={`data:image/jpeg;base64,${photoModal.photo}`}
                            alt={photoModal.name}
                            style={{ width: '100%', borderRadius: 10, display: 'block', border: '2px solid #ef444433' }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
