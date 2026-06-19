/* DoorSimulation.tsx — Realistic door simulation with continuous auto-scanning */

import { useState, useEffect, useCallback } from 'react';
import {
    Lock, Unlock, DoorOpen, Clock, RotateCcw, Users,
    CheckCircle2, XCircle, AlertTriangle, Timer, CalendarDays,
    ScanLine, UserX, Eye,
} from 'lucide-react';
import { doorsApi, simClockApi } from '../api/client';
import type { DoorStatus, KnockResponse, SimClockState, UnknownVisitorEntry, VisitorEntry } from '../api/types';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

export default function DoorSimulation() {
    const [doors, setDoors] = useState<DoorStatus[]>([]);
    const [clock, setClock] = useState<SimClockState | null>(null);
    const [loading, setLoading] = useState(true);

    const [selDate, setSelDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [selHour, setSelHour] = useState(9);
    const [selMinute, setSelMinute] = useState(0);

    const [knockResult, setKnockResult] = useState<Record<string, KnockResponse | null>>({});
    const [scanMsg, setScanMsg] = useState<Record<string, string | null>>({});
    const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

    // Photo viewer modal
    const [photoModal, setPhotoModal] = useState<{ name: string; photo: string } | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [d, c] = await Promise.all([doorsApi.listAll(), simClockApi.get()]);
            setDoors(d);
            setClock(c);
        } catch { /* ignore */ }
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
        const iv = setInterval(refresh, 15000);  // Sync with general rate limit
        return () => clearInterval(iv);
    }, [refresh]);

    const handleSetClock = async () => {
        try {
            const res = await simClockApi.set(selDate, selHour, selMinute);
            setClock(res);
            await refresh();
        } catch { /* ignore */ }
    };

    const handleResetClock = async () => {
        try {
            const res = await simClockApi.reset();
            setClock(res);
            await refresh();
        } catch { /* ignore */ }
    };

    const handleKnock = async (roomId: string) => {
        setActionLoading(p => ({ ...p, [roomId]: true }));
        setKnockResult(p => ({ ...p, [roomId]: null }));
        try {
            const res = await doorsApi.knock(roomId);
            setKnockResult(p => ({ ...p, [roomId]: res }));
            await refresh();
        } catch (err: any) {
            setKnockResult(p => ({
                ...p,
                [roomId]: { granted: false, message: err?.response?.data?.detail || 'Error', reason: 'error' } as KnockResponse,
            }));
        }
        setActionLoading(p => ({ ...p, [roomId]: false }));
        setTimeout(() => setKnockResult(p => ({ ...p, [roomId]: null })), 6000);
    };

    const handleScan = async (roomId: string) => {
        setActionLoading(p => ({ ...p, [`scan_${roomId}`]: true }));
        setScanMsg(p => ({ ...p, [roomId]: null }));
        try {
            const res = await doorsApi.scan(roomId);
            setScanMsg(p => ({
                ...p,
                [roomId]: res.scanned === 0
                    ? 'No faces detected in camera view'
                    : `Scanned ${res.scanned} face${res.scanned !== 1 ? 's' : ''}`,
            }));
            await refresh();
        } catch (err: any) {
            setScanMsg(p => ({ ...p, [roomId]: err?.response?.data?.detail || 'Scan error' }));
        }
        setActionLoading(p => ({ ...p, [`scan_${roomId}`]: false }));
        setTimeout(() => setScanMsg(p => ({ ...p, [roomId]: null })), 4000);
    };

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60, color: 'var(--text-secondary)' }}>
                <Clock size={24} className="spin" style={{ marginRight: 8 }} /> Loading door states…
            </div>
        );
    }

    return (
        <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', marginBottom: 24 }}>
                Door Simulation
            </h1>

            {/* ── Simulation Clock ─────────────────────── */}
            <div style={{
                background: 'var(--bg-secondary)', borderRadius: 12, padding: '20px 24px',
                marginBottom: 28, border: '1px solid var(--border-color)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                    <Timer size={20} style={{ color: 'var(--color-primary)' }} />
                    <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
                        Simulation Clock
                    </h2>
                    {clock?.is_simulated && (
                        <span style={{
                            fontSize: 11, padding: '2px 10px', borderRadius: 12,
                            background: '#f59e0b22', color: '#f59e0b', fontWeight: 600,
                        }}>SIMULATED</span>
                    )}
                    {clock && !clock.is_simulated && (
                        <span style={{
                            fontSize: 11, padding: '2px 10px', borderRadius: 12,
                            background: 'var(--color-success-bg)', color: 'var(--color-success)', fontWeight: 600,
                        }}>REAL TIME</span>
                    )}
                </div>

                {clock && (
                    <div style={{
                        fontSize: 28, fontWeight: 700, fontFamily: 'monospace',
                        color: clock.is_simulated ? '#f59e0b' : 'var(--color-primary)',
                        marginBottom: 16,
                    }}>
                        {clock.date} ({clock.day.charAt(0).toUpperCase() + clock.day.slice(1)}){' '}
                        {String(clock.hour).padStart(2, '0')}:{String(clock.minute).padStart(2, '0')}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <div>
                        <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Date</label>
                        <input
                            type="date"
                            value={selDate}
                            onChange={e => setSelDate(e.target.value)}
                            style={{
                                padding: '8px 12px', borderRadius: 8, fontSize: 14,
                                background: 'var(--bg-tertiary)', color: 'var(--text-main)',
                                border: '1px solid var(--border-color)', cursor: 'pointer',
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Hour</label>
                        <input
                            type="number" min={0} max={23} value={selHour}
                            onChange={e => setSelHour(Math.max(0, Math.min(23, +e.target.value)))}
                            style={{
                                width: 64, padding: '8px 12px', borderRadius: 8, fontSize: 14,
                                background: 'var(--bg-tertiary)', color: 'var(--text-main)',
                                border: '1px solid var(--border-color)',
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ fontSize: 12, color: 'var(--text-tertiary)', display: 'block', marginBottom: 4 }}>Minute</label>
                        <input
                            type="number" min={0} max={59} value={selMinute}
                            onChange={e => setSelMinute(Math.max(0, Math.min(59, +e.target.value)))}
                            style={{
                                width: 64, padding: '8px 12px', borderRadius: 8, fontSize: 14,
                                background: 'var(--bg-tertiary)', color: 'var(--text-main)',
                                border: '1px solid var(--border-color)',
                            }}
                        />
                    </div>
                    <button className="btn btn-primary" onClick={handleSetClock} style={{ padding: '8px 20px' }}>
                        <Clock size={14} /> Set Time
                    </button>
                    <button className="btn btn-secondary" onClick={handleResetClock} style={{ padding: '8px 20px' }}>
                        <RotateCcw size={14} /> Reset to Real Time
                    </button>
                </div>
            </div>

            {/* ── Room Door Cards ─────────────────────── */}
            {doors.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                    No rooms found. Create rooms in the Rooms page first, then assign schedules.
                </div>
            )}

            <div style={{ display: 'grid', gap: 24, gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))' }}>
                {doors.map(door => {
                    const kr = knockResult[door.room_id];
                    const sm = scanMsg[door.room_id];
                    const total = door.attendance_count + door.visitor_count + door.unknown_count;

                    return (
                        <div key={door.room_id} style={{
                            background: 'var(--bg-secondary)', borderRadius: 14, overflow: 'hidden',
                            border: `2px solid ${door.locked ? 'var(--border-color)' : '#22c55e55'}`,
                            transition: 'border-color 0.3s',
                        }}>
                            {/* ── Card header ── */}
                            <div style={{
                                padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                background: door.locked
                                    ? 'linear-gradient(135deg, #1e293b, #0f172a)'
                                    : 'linear-gradient(135deg, #064e3b, #022c22)',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                                    {door.locked
                                        ? <Lock size={22} style={{ color: '#ef4444', flexShrink: 0 }} />
                                        : <Unlock size={22} style={{ color: '#22c55e', flexShrink: 0 }} />
                                    }
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {door.room_name}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {door.locked ? 'Locked' : `Unlocked by ${door.unlocked_by_name}`}
                                        </div>
                                    </div>
                                </div>

                                {/* Scanning pulse + schedule badge */}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                                    {door.scanning && (
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: 5,
                                            fontSize: 11, color: '#22c55e', fontWeight: 600,
                                        }}>
                                            <span style={{
                                                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                                                background: '#22c55e', animation: 'pulse 1.5s infinite',
                                            }} />
                                            AUTO-SCAN
                                        </div>
                                    )}
                                    {door.active_schedule && (
                                        <div style={{
                                            fontSize: 11, padding: '3px 8px', borderRadius: 6,
                                            background: 'rgba(255,255,255,0.1)', color: '#cbd5e1',
                                            display: 'flex', alignItems: 'center', gap: 4,
                                        }}>
                                            <CalendarDays size={11} />
                                            {door.active_schedule.name} ({door.active_schedule.start_time}–{door.active_schedule.end_time})
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Card body ── */}
                            <div style={{ padding: '16px 20px' }}>

                                {/* Auto-lock countdown */}
                                {!door.locked && door.auto_lock_at && (
                                    <div style={{
                                        fontSize: 12, color: '#f59e0b', marginBottom: 12,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                        <Timer size={13} />
                                        Auto-locks at {door.auto_lock_at} (30 min after class ends)
                                    </div>
                                )}

                                {/* No schedule warning */}
                                {!door.active_schedule && door.locked && (
                                    <div style={{
                                        fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                        <AlertTriangle size={13} />
                                        No active schedule — use the simulation clock to set the right time
                                    </div>
                                )}

                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
                                    <button
                                        className="btn btn-primary"
                                        onClick={() => handleKnock(door.room_id)}
                                        disabled={!!actionLoading[door.room_id]}
                                        style={{ flex: 1, padding: '10px 14px', fontSize: 14 }}
                                    >
                                        {actionLoading[door.room_id]
                                            ? <>Checking…</>
                                            : <><DoorOpen size={15} /> Turn Knob</>
                                        }
                                    </button>

                                    {!door.locked && (
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => handleScan(door.room_id)}
                                            disabled={!!actionLoading[`scan_${door.room_id}`]}
                                            title="Manually trigger an immediate scan of all faces in view"
                                            style={{
                                                flex: 1, padding: '10px 14px', fontSize: 14,
                                                borderColor: '#22c55e55', color: '#22c55e',
                                            }}
                                        >
                                            {actionLoading[`scan_${door.room_id}`]
                                                ? <>Scanning…</>
                                                : <><DoorOpen size={15} /> Push Door Open</>
                                            }
                                        </button>
                                    )}
                                </div>

                                {/* Knock feedback */}
                                {kr && (
                                    <div style={{
                                        padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13,
                                        background: kr.granted ? '#22c55e15' : '#ef444415',
                                        color: kr.granted ? '#22c55e' : '#ef4444',
                                        border: `1px solid ${kr.granted ? '#22c55e33' : '#ef444433'}`,
                                        display: 'flex', alignItems: 'center', gap: 8,
                                    }}>
                                        {kr.granted ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                                        {kr.message}
                                    </div>
                                )}

                                {/* Scan feedback */}
                                {sm && (
                                    <div style={{
                                        padding: '10px 14px', borderRadius: 10, marginBottom: 12, fontSize: 13,
                                        background: 'var(--color-primary-bg)', color: 'var(--color-primary)',
                                        border: '1px solid var(--color-primary)33',
                                    }}>
                                        {sm}
                                    </div>
                                )}

                                {/* ── Entry lists ── */}
                                {total > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                                        {/* Attendance — enrolled + present */}
                                        {door.attendance_count > 0 && (
                                            <EntrySection
                                                icon={<CheckCircle2 size={14} />}
                                                title="Attendance"
                                                count={door.attendance_count}
                                                accentColor="#22c55e"
                                                rows={door.attendance.map(a => ({
                                                    name: a.name,
                                                    role: a.role,
                                                    badge: 'Present',
                                                    badgeColor: '#22c55e',
                                                    time: a.timestamp,
                                                }))}
                                            />
                                        )}

                                        {/* Visitors — registered but not enrolled */}
                                        {door.visitor_count > 0 && (
                                            <EntrySection
                                                icon={<Users size={14} />}
                                                title="Visitors (not enrolled)"
                                                count={door.visitor_count}
                                                accentColor="#f59e0b"
                                                rows={(door.visitors as VisitorEntry[]).map(v => ({
                                                    name: v.name,
                                                    role: v.role,
                                                    badge: 'Visitor',
                                                    badgeColor: '#f59e0b',
                                                    time: v.timestamp,
                                                }))}
                                            />
                                        )}

                                        {/* Unknown — unregistered faces */}
                                        {door.unknown_count > 0 && (
                                            <div>
                                                <SectionHeader
                                                    icon={<UserX size={14} />}
                                                    title="Unknown Persons"
                                                    count={door.unknown_count}
                                                    accentColor="#ef4444"
                                                />
                                                <div style={{
                                                    borderRadius: 8, overflow: 'hidden',
                                                    border: '1px solid var(--border-color)',
                                                }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                        <thead>
                                                            <tr style={{ background: 'var(--bg-tertiary)' }}>
                                                                <th style={thStyle}>Photo</th>
                                                                <th style={thStyle}>Name</th>
                                                                <th style={thStyle}>Time</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {(door.unknown_visitors as UnknownVisitorEntry[]).map((u, i) => (
                                                                <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                                                                    <td style={{ ...tdStyle, width: 48 }}>
                                                                        {u.photo_b64 ? (
                                                                            <button
                                                                                onClick={() => setPhotoModal({ name: `Unknown #${i + 1}`, photo: u.photo_b64! })}
                                                                                style={{
                                                                                    border: 'none', background: 'none', padding: 0,
                                                                                    cursor: 'pointer', display: 'block',
                                                                                }}
                                                                                title="View photo"
                                                                            >
                                                                                <img
                                                                                    src={`data:image/jpeg;base64,${u.photo_b64}`}
                                                                                    alt="Unknown face"
                                                                                    style={{
                                                                                        width: 36, height: 36, objectFit: 'cover',
                                                                                        borderRadius: 6, display: 'block',
                                                                                        border: '1px solid #ef444433',
                                                                                    }}
                                                                                />
                                                                            </button>
                                                                        ) : (
                                                                            <div style={{
                                                                                width: 36, height: 36, borderRadius: 6,
                                                                                background: '#ef444415', display: 'flex',
                                                                                alignItems: 'center', justifyContent: 'center',
                                                                            }}>
                                                                                <UserX size={16} style={{ color: '#ef4444' }} />
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td style={tdStyle}>
                                                                        <span style={{ color: '#ef4444', fontWeight: 500 }}>
                                                                            Unknown #{i + 1}
                                                                        </span>
                                                                    </td>
                                                                    <td style={tdStyle}>
                                                                        {fmtTime(u.timestamp)}
                                                                        {u.photo_b64 && (
                                                                            <button
                                                                                onClick={() => setPhotoModal({ name: `Unknown #${i + 1}`, photo: u.photo_b64! })}
                                                                                style={{
                                                                                    marginLeft: 6, border: 'none', background: 'none',
                                                                                    cursor: 'pointer', color: '#ef4444', padding: 0,
                                                                                    display: 'inline-flex', alignItems: 'center',
                                                                                }}
                                                                                title="View photo"
                                                                            >
                                                                                <Eye size={12} />
                                                                            </button>
                                                                        )}
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Empty state when door is unlocked but nobody logged yet */}
                                {!door.locked && total === 0 && (
                                    <div style={{
                                        textAlign: 'center', padding: '20px 0',
                                        color: 'var(--text-tertiary)', fontSize: 13,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    }}>
                                        <ScanLine size={16} />
                                        Door is open — waiting for faces to appear in camera…
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* ── Photo modal ── */}
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
                        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                            This person is not registered in the system.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Sub-components ────────────────────────────────────

function SectionHeader({ icon, title, count, accentColor }: {
    icon: React.ReactNode; title: string; count: number; accentColor: string;
}) {
    return (
        <div style={{
            fontSize: 13, fontWeight: 600, color: accentColor,
            marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6,
        }}>
            {icon}
            {title}
            <span style={{
                marginLeft: 'auto', fontSize: 11, padding: '1px 8px', borderRadius: 10,
                background: `${accentColor}20`, color: accentColor, fontWeight: 700,
            }}>{count}</span>
        </div>
    );
}

function EntrySection({ icon, title, count, accentColor, rows }: {
    icon: React.ReactNode;
    title: string;
    count: number;
    accentColor: string;
    rows: { name: string; role?: string; badge: string; badgeColor: string; time: string }[];
}) {
    return (
        <div>
            <SectionHeader icon={icon} title={title} count={count} accentColor={accentColor} />
            <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                        <tr style={{ background: 'var(--bg-tertiary)' }}>
                            <th style={thStyle}>Name</th>
                            <th style={thStyle}>Role</th>
                            <th style={thStyle}>Status</th>
                            <th style={thStyle}>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((r, i) => (
                            <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                                <td style={tdStyle}>{r.name}</td>
                                <td style={tdStyle}>{r.role || '—'}</td>
                                <td style={tdStyle}>
                                    <span style={{
                                        display: 'inline-block', padding: '2px 8px', borderRadius: 10,
                                        fontSize: 11, fontWeight: 600,
                                        background: `${r.badgeColor}18`, color: r.badgeColor,
                                    }}>
                                        {r.badge}
                                    </span>
                                </td>
                                <td style={tdStyle}>{fmtTime(r.time)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ── Helpers ───────────────────────────────────────────

const thStyle: React.CSSProperties = {
    padding: '7px 10px', textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
    padding: '7px 10px', color: 'var(--text-main)',
};

function fmtTime(iso: string) {
    try {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return iso;
    }
}
