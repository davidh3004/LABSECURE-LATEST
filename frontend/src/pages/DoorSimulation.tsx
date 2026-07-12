/* DoorSimulation.tsx — Door simulation overview with clickable room cards */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Lock, Unlock, Clock, RotateCcw, Timer, CalendarDays,
    AlertTriangle, ChevronRight, Users, UserX, CheckCircle2,
} from 'lucide-react';
import { doorsApi, simClockApi } from '../api/client';
import { toast } from '../components/ui/Toast';
import type { DoorStatus, SimClockState } from '../api/types';

export default function DoorSimulation() {
    const navigate = useNavigate();
    const [doors, setDoors] = useState<DoorStatus[]>([]);
    const [clock, setClock] = useState<SimClockState | null>(null);
    const [loading, setLoading] = useState(true);

    const [selDate, setSelDate] = useState(() => new Date().toISOString().split('T')[0]);
    const [selHour, setSelHour] = useState(9);
    const [selMinute, setSelMinute] = useState(0);

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
        const iv = setInterval(refresh, 15000);
        return () => clearInterval(iv);
    }, [refresh]);

    const handleSetClock = async () => {
        try {
            const res = await simClockApi.set(selDate, selHour, selMinute);
            setClock(res);
            await refresh();
            toast.success('Simulated time set');
        } catch { toast.error('Failed to set simulated time'); }
    };

    const handleResetClock = async () => {
        try {
            const res = await simClockApi.reset();
            setClock(res);
            await refresh();
            toast.success('Simulated time reset');
        } catch { toast.error('Failed to reset simulated time'); }
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
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-main)', marginBottom: 8 }}>
                Door Simulation
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 24 }}>
                Click a room to open its live camera, turn the knob, and see who was recognized.
            </p>

            {/* Simulation Clock */}
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

            {doors.length === 0 && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-secondary)' }}>
                    No rooms found. Create rooms in the Rooms page first, then assign schedules.
                </div>
            )}

            <div className="responsive-card-grid" style={{ gap: 20 }}>
                {doors.map(door => {
                    const total = door.attendance_count + door.visitor_count + door.unknown_count;

                    return (
                        <button
                            key={door.room_id}
                            type="button"
                            onClick={() => navigate(`/doors/${door.room_id}`)}
                            style={{
                                textAlign: 'left', cursor: 'pointer',
                                background: 'var(--bg-secondary)', borderRadius: 14, overflow: 'hidden',
                                border: `2px solid ${door.locked ? 'var(--border-color)' : '#22c55e55'}`,
                                transition: 'border-color 0.2s, transform 0.15s',
                                padding: 0,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; }}
                        >
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
                                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>
                                            {door.locked ? 'Locked' : `Unlocked by ${door.unlocked_by_name}`}
                                        </div>
                                    </div>
                                </div>
                                <ChevronRight size={20} style={{ color: 'rgba(255,255,255,0.5)', flexShrink: 0 }} />
                            </div>

                            <div style={{ padding: '14px 20px' }}>
                                {door.active_schedule ? (
                                    <div style={{
                                        fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                        <CalendarDays size={13} />
                                        {door.active_schedule.name} ({door.active_schedule.start_time}–{door.active_schedule.end_time})
                                    </div>
                                ) : door.locked && (
                                    <div style={{
                                        fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 10,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                        <AlertTriangle size={13} />
                                        No active schedule
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <CheckCircle2 size={13} style={{ color: '#22c55e' }} />
                                        {door.attendance_count} present
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Users size={13} style={{ color: '#f59e0b' }} />
                                        {door.visitor_count} visitors
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <UserX size={13} style={{ color: '#ef4444' }} />
                                        {door.unknown_count} unknown
                                    </span>
                                </div>

                                {total === 0 && !door.locked && (
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
                                        Waiting for faces in camera…
                                    </div>
                                )}

                                <div style={{
                                    marginTop: 12, fontSize: 12, fontWeight: 600,
                                    color: 'var(--color-primary)',
                                }}>
                                    Open room → Turn knob & view camera
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
