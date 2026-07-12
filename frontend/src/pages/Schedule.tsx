/* Schedule.tsx — Weekly Schedule Manager with Student Enrollment */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, X, Clock, Search, UserPlus, UserMinus, Users, DoorOpen, ClipboardList, CheckCircle, XCircle, Download, ScanLine, UserX, Eye, AlertTriangle, MoreVertical, ChevronDown } from 'lucide-react';
import { schedulesApi, usersApi, roomsApi, doorsApi, authApi } from '../api/client';
import { confirmDialog } from '../components/ui/ConfirmDialog';
import { toast } from '../components/ui/Toast';
import type { Schedule, ScheduleCreate, User, Room, AttendanceSession, AttendanceResponse, DoorStatus, UnknownVisitorEntry, VisitorEntry } from '../api/types';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => `${i.toString().padStart(2, '0')}:00`);

const dayColors: Record<string, string> = {
    student: 'rgba(16, 185, 129, 0.2)', teacher: 'rgba(59, 130, 246, 0.2)',
    employee: 'rgba(139, 92, 246, 0.2)', security: 'rgba(239, 68, 68, 0.2)',
    admin: 'rgba(245, 158, 11, 0.2)', janitor: 'rgba(6, 182, 212, 0.2)',
};

const emptyForm: ScheduleCreate = {
    name: '', days: [], start_time: '08:00', end_time: '18:00',
    day_times: {},
    roles: [], user_overrides: [], teacher_id: undefined, active: true,
};

/** Resolve hours for a specific day (per-day override or global fallback). */
function getDayWindow(schedule: Pick<Schedule, 'start_time' | 'end_time' | 'day_times'>, day: string) {
    const w = schedule.day_times?.[day];
    if (w?.start_time && w?.end_time) return w;
    return { start_time: schedule.start_time, end_time: schedule.end_time };
}

function formatScheduleHours(schedule: Schedule): string {
    if (!schedule.days.length) return `${schedule.start_time} — ${schedule.end_time}`;
    const windows = schedule.days.map(d => {
        const w = getDayWindow(schedule, d);
        return `${w.start_time}-${w.end_time}`;
    });
    const unique = [...new Set(windows)];
    if (unique.length === 1) return `${unique[0].replace('-', ' — ')}`;
    return schedule.days.map(d => {
        const w = getDayWindow(schedule, d);
        const label = d.charAt(0).toUpperCase() + d.slice(1, 3);
        return `${label} ${w.start_time}–${w.end_time}`;
    }).join(' · ');
}

/** Sync days + global start/end from day_times map. */
function syncFormFromDayTimes(form: ScheduleCreate): ScheduleCreate {
    const day_times = form.day_times || {};
    const days = DAYS.filter(d => d in day_times);
    const starts = days.map(d => day_times[d].start_time).sort();
    const ends = days.map(d => day_times[d].end_time).sort();
    return {
        ...form,
        days,
        start_time: starts[0] || form.start_time || '08:00',
        end_time: ends[ends.length - 1] || form.end_time || '18:00',
        day_times,
    };
}

/* ── Enrollment Modal ─────────────────────────────────── */
function EnrollmentModal({
    schedule,
    allUsers,
    onClose,
    onUpdate,
}: {
    schedule: Schedule;
    allUsers: User[];
    onClose: () => void;
    onUpdate: () => void;
}) {
    const [search, setSearch] = useState('');
    const [enrolled, setEnrolled] = useState<string[]>(schedule.user_overrides || []);
    const [saving, setSaving] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { inputRef.current?.focus(); }, []);

    const enrolledUsers = allUsers.filter(u => enrolled.includes(u.id!));
    const searchResults = search.trim().length > 0
        ? allUsers.filter(u =>
            u.role === 'student' &&
            !enrolled.includes(u.id!) &&
            (u.name.toLowerCase().includes(search.toLowerCase()) ||
                (u.student_id || '').toLowerCase().includes(search.toLowerCase()))
        ).slice(0, 6)
        : [];

    const addUser = async (userId: string) => {
        const updated = [...enrolled, userId];
        setEnrolled(updated);
        setSaving(true);
        try {
            await schedulesApi.update(schedule.id!, { user_overrides: updated });
            onUpdate();
            toast.success('Student enrolled');
        } catch { /* roll back on error */
            setEnrolled(enrolled);
            toast.error('Failed to enroll student');
        }
        setSaving(false);
        setSearch('');
        inputRef.current?.focus();
    };

    const removeUser = async (userId: string) => {
        const updated = enrolled.filter(id => id !== userId);
        setEnrolled(updated);
        setSaving(true);
        try {
            await schedulesApi.update(schedule.id!, { user_overrides: updated });
            onUpdate();
            toast.success('Student removed');
        } catch {
            setEnrolled(enrolled);
            toast.error('Failed to remove student');
        }
        setSaving(false);
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
                <div className="modal-header">
                    <h2 className="modal-title">
                        <Users size={18} style={{ marginRight: 8, verticalAlign: '-3px' }} />
                        Enrolled Students — {schedule.name}
                    </h2>
                    <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="modal-body">
                    {/* Search Bar */}
                    <div className="form-group" style={{ position: 'relative' }}>
                        <label className="form-label">Search & Add Students</label>
                        <div style={{ position: 'relative' }}>
                            <Search size={16} style={{
                                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                                color: 'var(--text-tertiary)', pointerEvents: 'none',
                            }} />
                            <input
                                ref={inputRef}
                                className="form-input"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="Search by name or student ID..."
                                style={{ paddingLeft: 36 }}
                            />
                        </div>

                        {/* Search Results Dropdown */}
                        {searchResults.length > 0 && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                                background: 'var(--bg-card)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)', marginTop: 4,
                                boxShadow: '0 8px 32px rgba(0,0,0,0.3)', overflow: 'hidden',
                            }}>
                                {searchResults.map(user => (
                                    <button
                                        key={user.id}
                                        onClick={() => addUser(user.id!)}
                                        disabled={saving}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 12,
                                            width: '100%', padding: '10px 14px', border: 'none',
                                            background: 'transparent', color: 'var(--text-primary)',
                                            cursor: 'pointer', textAlign: 'left',
                                            borderBottom: '1px solid var(--border-subtle)',
                                            transition: 'background 0.15s',
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    >
                                        <div style={{
                                            width: 32, height: 32, borderRadius: '50%',
                                            background: 'var(--color-primary-bg)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 13, fontWeight: 600, color: 'var(--color-primary)',
                                            flexShrink: 0,
                                        }}>
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 500, fontSize: 13 }}>{user.name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {user.student_id || 'N/A'} · {user.role}
                                            </div>
                                        </div>
                                        <UserPlus size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                                    </button>
                                ))}
                            </div>
                        )}

                        {/* No results */}
                        {search.trim().length > 0 && searchResults.length === 0 && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
                                background: 'var(--bg-card)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-md)', marginTop: 4,
                                padding: '16px', textAlign: 'center',
                                color: 'var(--text-tertiary)', fontSize: 13,
                                boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                            }}>
                                No matching users found
                            </div>
                        )}
                    </div>

                    {/* Enrolled Students List */}
                    <div style={{ marginTop: 20 }}>
                        <div style={{
                            fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 10,
                        }}>
                            Enrolled ({enrolledUsers.length})
                        </div>

                        {enrolledUsers.length === 0 ? (
                            <div style={{
                                textAlign: 'center', padding: '24px 12px',
                                color: 'var(--text-tertiary)', fontSize: 13,
                                border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)',
                            }}>
                                No students enrolled yet. Search above to add students.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {enrolledUsers.map(user => (
                                    <div key={user.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                        background: 'var(--bg-tertiary)',
                                    }}>
                                        <div style={{
                                            width: 30, height: 30, borderRadius: '50%',
                                            background: 'var(--color-primary-bg)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: 12, fontWeight: 600, color: 'var(--color-primary)',
                                            flexShrink: 0,
                                        }}>
                                            {user.name.charAt(0).toUpperCase()}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 500, fontSize: 13 }}>{user.name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {user.student_id || 'N/A'} · {user.role}
                                            </div>
                                        </div>
                                        <button
                                            className="btn btn-ghost btn-sm"
                                            onClick={() => removeUser(user.id!)}
                                            disabled={saving}
                                            title="Remove student"
                                            style={{ color: 'var(--color-danger)', padding: 4 }}
                                        >
                                            <UserMinus size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>Done</button>
                </div>
            </div>
        </div>
    );
}

/* ── Attendance Modal ─────────────────────────────────── */
function AttendanceModal({
    schedule,
    onClose,
}: {
    schedule: Schedule;
    onClose: () => void;
}) {
    const [sessions, setSessions] = useState<AttendanceSession[]>([]);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [attendance, setAttendance] = useState<AttendanceResponse | null>(null);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const [loadingAttendance, setLoadingAttendance] = useState(false);
    const [loadError, setLoadError] = useState(false);
    const [retryKey, setRetryKey] = useState(0);
    const [sessionMenuOpen, setSessionMenuOpen] = useState(false);

    useEffect(() => {
        if (!sessionMenuOpen) return;
        const close = () => setSessionMenuOpen(false);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, [sessionMenuOpen]);

    useEffect(() => {
        let cancelled = false;
        setLoadingSessions(true);
        setLoadError(false);
        setAttendance(null);
        setSelectedDate(null);

        schedulesApi.attendanceSessions(schedule.id!)
            .then(data => {
                if (cancelled) return;
                setSessions(data);
                const first = data.find(s => s.count > 0) || data[0] || null;
                if (!first) return;
                setSelectedDate(first.date);
            })
            .catch(() => {
                if (!cancelled) setSessions([]);
            })
            .finally(() => {
                if (!cancelled) setLoadingSessions(false);
            });

        return () => { cancelled = true; };
    }, [schedule.id]);

    useEffect(() => {
        if (!selectedDate) {
            setAttendance(null);
            return;
        }

        let cancelled = false;
        setLoadingAttendance(true);
        setLoadError(false);

        const loadAttendance = (retriesLeft: number) => {
            schedulesApi.attendance(schedule.id!, selectedDate)
                .then(data => {
                    if (!cancelled) {
                        setAttendance(data);
                        setLoadError(false);
                    }
                })
                .catch(() => {
                    if (cancelled) return;
                    if (retriesLeft > 0) {
                        window.setTimeout(() => loadAttendance(retriesLeft - 1), 400);
                        return;
                    }
                    setAttendance(null);
                    setLoadError(true);
                })
                .finally(() => {
                    if (!cancelled) setLoadingAttendance(false);
                });
        };

        loadAttendance(2);
        return () => { cancelled = true; };
    }, [schedule.id, selectedDate, retryKey]);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr + 'T12:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    };

    const formatTime = (iso: string | null) => {
        if (!iso) return '—';
        return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const downloadCsv = () => {
        if (!attendance || !selectedDate) return;
        const header = ['Name', 'Student ID', 'Role', 'Status', 'Entry Time'];
        const present = attendance.present.map(r => [
            r.name,
            r.student_id || '',
            r.role || '',
            'Present',
            r.timestamp ? new Date(r.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '',
        ]);
        const absent = attendance.absent.map(r => [
            r.name,
            r.student_id || '',
            r.role || '',
            'Absent',
            '',
        ]);
        const rows = [header, ...present, ...absent];
        const csv = rows.map(row =>
            row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `attendance_${attendance.schedule_name.replace(/\s+/g, '_')}_${selectedDate}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const selectedSession = sessions.find(s => s.date === selectedDate) || null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-tall" onClick={e => e.stopPropagation()}>
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <h2 className="modal-title">
                        <ClipboardList size={18} style={{ marginRight: 8, verticalAlign: '-3px' }} />
                        Attendance — {schedule.name}
                    </h2>
                    <button className="btn btn-ghost" onClick={onClose}><X size={18} /></button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                    {/* Session selector — dropdown */}
                    <div style={{ padding: '16px 20px 4px', flexShrink: 0 }}>
                        <div style={{
                            fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                            letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 6,
                        }}>
                            Past Sessions
                        </div>
                        <div style={{ position: 'relative', maxWidth: 320 }}>
                            <button
                                type="button"
                                className="session-select"
                                onClick={(e) => { e.stopPropagation(); setSessionMenuOpen(o => !o); }}
                                disabled={loadingSessions || sessions.length === 0}
                                aria-haspopup="listbox"
                                aria-expanded={sessionMenuOpen}
                            >
                                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                                    {loadingSessions ? (
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Loading…</span>
                                    ) : sessions.length === 0 ? (
                                        <span style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>No sessions yet</span>
                                    ) : (
                                        <>
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>
                                                {selectedDate ? formatDate(selectedDate) : 'Select a session'}
                                            </span>
                                            {selectedSession && (
                                                <span style={{ fontSize: 11, marginTop: 1, color: selectedSession.count > 0 ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                                                    {selectedSession.count > 0 ? `${selectedSession.count} present` : 'No entries'}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </span>
                                <ChevronDown size={16} style={{ flexShrink: 0, transition: 'transform 0.15s', transform: sessionMenuOpen ? 'rotate(180deg)' : 'none' }} />
                            </button>
                            {sessionMenuOpen && (
                                <div className="session-menu" role="listbox" onClick={(e) => e.stopPropagation()}>
                                    {sessions.map(s => (
                                        <button
                                            key={s.date}
                                            type="button"
                                            role="option"
                                            aria-selected={selectedDate === s.date}
                                            className={`session-menu-item ${selectedDate === s.date ? 'active' : ''}`}
                                            onClick={() => { setSelectedDate(s.date); setSessionMenuOpen(false); }}
                                        >
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>
                                                {new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                            </span>
                                            <span style={{ fontSize: 11, color: s.count > 0 ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                                                {s.count > 0 ? `${s.count} present` : 'No entries'}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Attendance content — full width */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
                        {!selectedDate ? (
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
                                Select a session above
                            </div>
                        ) : loadingAttendance ? (
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>Loading…</div>
                        ) : attendance ? (
                            <>
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                                        {formatDate(selectedDate)}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                                        {(() => {
                                            const day = selectedDate
                                                ? new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
                                                : '';
                                            const w = day ? getDayWindow(schedule, day) : { start_time: schedule.start_time, end_time: schedule.end_time };
                                            return `${w.start_time} — ${w.end_time}`;
                                        })()}
                                    </div>
                                </div>

                                {/* Present */}
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{
                                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                                        letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8,
                                        display: 'flex', alignItems: 'center', gap: 6,
                                    }}>
                                        <CheckCircle size={13} style={{ color: 'var(--color-success)' }} />
                                        Present ({attendance.present.length})
                                    </div>
                                    {attendance.present.length === 0 ? (
                                        <div style={{ color: 'var(--text-tertiary)', fontSize: 13, fontStyle: 'italic' }}>
                                            No entries recorded
                                        </div>
                                    ) : (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {attendance.present.map(r => (
                                                <div key={r.user_id} style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                                    background: 'var(--color-success-bg)',
                                                    border: '1px solid rgba(16,185,129,0.15)',
                                                }}>
                                                    <div style={{
                                                        width: 32, height: 32, borderRadius: '50%',
                                                        background: 'var(--color-success)', opacity: 0.9,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
                                                    }}>
                                                        {r.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div className="attendance-name" style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                            {r.student_id || 'N/A'} · {r.role}
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: 12, color: 'var(--color-success)', fontWeight: 600, flexShrink: 0 }}>
                                                        {formatTime(r.timestamp)}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Absent — only shown when there are enrolled students */}
                                {attendance.absent.length > 0 && (
                                    <div>
                                        <div style={{
                                            fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                                            letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 8,
                                            display: 'flex', alignItems: 'center', gap: 6,
                                        }}>
                                            <XCircle size={13} style={{ color: 'var(--color-danger)' }} />
                                            Absent ({attendance.absent.length})
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                            {attendance.absent.map(r => (
                                                <div key={r.user_id} style={{
                                                    display: 'flex', alignItems: 'center', gap: 12,
                                                    padding: '8px 12px', borderRadius: 'var(--radius-md)',
                                                    background: 'var(--bg-tertiary)',
                                                    border: '1px solid var(--border-subtle)',
                                                    opacity: 0.7,
                                                }}>
                                                    <div style={{
                                                        width: 32, height: 32, borderRadius: '50%',
                                                        background: 'var(--bg-secondary)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', flexShrink: 0,
                                                    }}>
                                                        {r.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div className="attendance-name" style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                            {r.student_id || 'N/A'} · {r.role}
                                                        </div>
                                                    </div>
                                                    <span className="badge badge-danger" style={{ fontSize: 10, flexShrink: 0 }}>Absent</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : loadError ? (
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
                                Failed to load attendance
                                <div style={{ marginTop: 12 }}>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => setRetryKey(k => k + 1)}
                                    >
                                        Retry
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div style={{ color: 'var(--text-tertiary)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>
                                No attendance data for this session
                            </div>
                        )}
                    </div>
                </div>

                <div className="modal-footer" style={{ flexShrink: 0 }}>
                    <button className="btn btn-secondary" onClick={onClose}>Close</button>
                    <button
                        className="btn btn-primary"
                        onClick={downloadCsv}
                        disabled={!attendance || (attendance.present.length === 0 && attendance.absent.length === 0)}
                    >
                        <Download size={14} /> Download CSV
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ── Live Session Panel ────────────────────────────────── */
/**
 * Shown inside a schedule card when that schedule's room has an active (unlocked) door.
 * Displays the two "extra" lists produced by the continuous scan:
 *   • Visitors  — registered users not enrolled in this schedule
 *   • Unknown   — unrecognised faces, with photo thumbnail if available
 */
function LiveSessionPanel({ schedule }: { schedule: Schedule }) {
    const [door, setDoor] = useState<DoorStatus | null>(null);
    const [photo, setPhoto] = useState<{ label: string; src: string } | null>(null);

    useEffect(() => {
        if (!schedule.room_id) return;

        const load = () =>
            doorsApi.status(schedule.room_id!).then(d => setDoor(d)).catch(() => { });

        load();
        const iv = setInterval(load, 20000);
        return () => clearInterval(iv);
    }, [schedule.room_id, schedule.id]);

    // Only render when the door is unlocked and there's something to show
    if (!door || door.locked || (door.visitor_count === 0 && door.unknown_count === 0)) {
        if (door && !door.locked && door.visitor_count === 0 && door.unknown_count === 0) {
            return (
                <div style={{
                    marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)',
                    display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 12, color: 'var(--text-tertiary)',
                }}>
                    <ScanLine size={13} />
                    Door is open — auto-scanning for visitors and unknown faces…
                </div>
            );
        }
        return null;
    }

    return (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{
                fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 12,
                display: 'flex', alignItems: 'center', gap: 6,
            }}>
                <ScanLine size={12} />
                Live Session
                <span style={{
                    fontSize: 10, padding: '1px 8px', borderRadius: 10,
                    background: '#22c55e20', color: '#22c55e', fontWeight: 700, marginLeft: 2,
                }}>SCANNING</span>
            </div>

            {/* Visitors */}
            {door.visitor_count > 0 && (
                <div style={{ marginBottom: 12 }}>
                    <div style={{
                        fontSize: 12, fontWeight: 600, color: '#f59e0b',
                        display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6,
                    }}>
                        <AlertTriangle size={12} />
                        Visitors not enrolled in this class ({door.visitor_count})
                    </div>
                    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-tertiary)' }}>
                                    <th style={lsThStyle}>Name</th>
                                    <th style={lsThStyle}>Role</th>
                                    <th style={lsThStyle}>Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(door.visitors as VisitorEntry[]).map((v, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                                        <td style={lsTdStyle}>{v.name}</td>
                                        <td style={lsTdStyle}>{v.role}</td>
                                        <td style={lsTdStyle}>{lsFmtTime(v.timestamp)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Unknown faces */}
            {door.unknown_count > 0 && (
                <div>
                    <div style={{
                        fontSize: 12, fontWeight: 600, color: '#ef4444',
                        display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6,
                    }}>
                        <UserX size={12} />
                        Unknown persons not in system ({door.unknown_count})
                    </div>
                    <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                            <thead>
                                <tr style={{ background: 'var(--bg-tertiary)' }}>
                                    <th style={lsThStyle}>Photo</th>
                                    <th style={lsThStyle}>ID</th>
                                    <th style={lsThStyle}>Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(door.unknown_visitors as UnknownVisitorEntry[]).map((u, i) => (
                                    <tr key={i} style={{ borderTop: '1px solid var(--border-color)' }}>
                                        <td style={{ ...lsTdStyle, width: 44 }}>
                                            {u.photo_b64 ? (
                                                <button
                                                    onClick={() => setPhoto({ label: `Unknown #${i + 1}`, src: u.photo_b64! })}
                                                    style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
                                                    title="View photo"
                                                >
                                                    <img
                                                        src={`data:image/jpeg;base64,${u.photo_b64}`}
                                                        alt="Unknown"
                                                        style={{
                                                            width: 32, height: 32, objectFit: 'cover',
                                                            borderRadius: 6, display: 'block',
                                                            border: '1px solid #ef444433',
                                                        }}
                                                    />
                                                </button>
                                            ) : (
                                                <div style={{
                                                    width: 32, height: 32, borderRadius: 6,
                                                    background: '#ef444415', display: 'flex',
                                                    alignItems: 'center', justifyContent: 'center',
                                                }}>
                                                    <UserX size={14} style={{ color: '#ef4444' }} />
                                                </div>
                                            )}
                                        </td>
                                        <td style={lsTdStyle}>
                                            <span style={{ color: '#ef4444' }}>Unknown #{i + 1}</span>
                                        </td>
                                        <td style={lsTdStyle}>
                                            {lsFmtTime(u.timestamp)}
                                            {u.photo_b64 && (
                                                <button
                                                    onClick={() => setPhoto({ label: `Unknown #${i + 1}`, src: u.photo_b64! })}
                                                    style={{
                                                        marginLeft: 4, border: 'none', background: 'none',
                                                        cursor: 'pointer', color: '#ef4444', padding: 0,
                                                        display: 'inline-flex', alignItems: 'center',
                                                    }}
                                                >
                                                    <Eye size={11} />
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

            {/* Photo modal */}
            {photo && (
                <div
                    onClick={() => setPhoto(null)}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: 'var(--bg-secondary)', borderRadius: 14, padding: 24,
                            maxWidth: 380, width: '90%', border: '1px solid var(--border-color)',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                            <span style={{ fontWeight: 600, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <UserX size={15} /> {photo.label}
                            </span>
                            <button
                                onClick={() => setPhoto(null)}
                                style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 20 }}
                            >×</button>
                        </div>
                        <img
                            src={`data:image/jpeg;base64,${photo.src}`}
                            alt={photo.label}
                            style={{ width: '100%', borderRadius: 10, display: 'block', border: '2px solid #ef444433' }}
                        />
                        <p style={{ marginTop: 10, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
                            Not registered in the system.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

const lsThStyle: React.CSSProperties = { padding: '6px 8px', textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 600 };
const lsTdStyle: React.CSSProperties = { padding: '6px 8px', color: 'var(--text-main)' };
function lsFmtTime(iso: string) {
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return iso; }
}

/* ── Schedule Page ────────────────────────────────────── */
export default function SchedulePage({ role = 'admin' }: { role?: 'admin' | 'teacher' }) {
    const isTeacher = role === 'teacher';
    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [allUsers, setAllUsers] = useState<User[]>([]);
    const [rooms, setRooms] = useState<Room[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
    const [enrollSchedule, setEnrollSchedule] = useState<Schedule | null>(null);
    const [attendanceSchedule, setAttendanceSchedule] = useState<Schedule | null>(null);
    const [form, setForm] = useState<ScheduleCreate>({ ...emptyForm });
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [teacherUserId, setTeacherUserId] = useState<string | null>(null);

    // Close the card action menu on any outside click
    useEffect(() => {
        const close = () => setMenuOpenId(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, []);

    const [formError, setFormError] = useState<string | null>(null);

    // Resolve which teacher is logged in, to scope the schedule list
    useEffect(() => {
        if (!isTeacher) { setTeacherUserId(null); return; }

        Promise.all([authApi.getMe(), usersApi.list()])
            .then(([me, users]) => {
                const fromApi = me?.user_id ?? me?.teacher_id ?? null;
                if (fromApi) {
                    setTeacherUserId(fromApi);
                    return;
                }
                const teacher = users.find(u =>
                    u.role === 'teacher' &&
                    u.name.trim().toLowerCase() === (me?.username || '').trim().toLowerCase()
                );
                setTeacherUserId(teacher?.id ?? null);
            })
            .catch(() => setTeacherUserId(null));
    }, [isTeacher]);

    const load = () => {
        schedulesApi.list().then(setSchedules).catch(() => { });
        usersApi.list().then(setAllUsers).catch(() => { });
        roomsApi.list().then(setRooms).catch(() => { });
    };
    useEffect(() => { load(); }, []);

    const handleSubmit = async () => {
        const synced = syncFormFromDayTimes(form);
        setFormError(null);

        if (!synced.name.trim()) {
            const msg = 'Enter a schedule name';
            setFormError(msg);
            toast.error(msg);
            return;
        }
        if (!synced.days.length) {
            const msg = 'Select at least one day for this schedule';
            setFormError(msg);
            toast.error(msg);
            return;
        }
        for (const day of synced.days) {
            const w = synced.day_times![day];
            const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
            if (!w?.start_time || !w?.end_time) {
                const msg = `Set start and end time for ${dayLabel}`;
                setFormError(msg);
                toast.error(msg);
                return;
            }
            if (w.start_time >= w.end_time) {
                const msg = `${dayLabel}: start time must be before end time`;
                setFormError(msg);
                toast.error(msg);
                return;
            }
        }

        try {
            const editing = !!editingSchedule?.id;
            if (editing) {
                await schedulesApi.update(editingSchedule!.id!, synced);
            } else {
                await schedulesApi.create(synced);
            }
            setShowModal(false);
            setEditingSchedule(null);
            setForm({ ...emptyForm, day_times: {} });
            setFormError(null);
            load();
            toast.success(editing ? 'Schedule updated' : 'Schedule created');
        } catch (err: any) {
            const detail = err?.response?.data?.detail;
            const msg = typeof detail === 'string'
                ? detail
                : Array.isArray(detail)
                    ? detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ')
                    : (editingSchedule ? 'Failed to update schedule' : 'Failed to create schedule');
            setFormError(msg);
            toast.error(msg);
        }
    };

    const openEdit = (schedule: Schedule) => {
        setEditingSchedule(schedule);
        setFormError(null);
        const day_times: Record<string, { start_time: string; end_time: string }> = {};
        for (const day of schedule.days) {
            day_times[day] = getDayWindow(schedule, day);
        }
        setForm({
            name: schedule.name,
            days: [...schedule.days],
            start_time: schedule.start_time,
            end_time: schedule.end_time,
            day_times,
            roles: schedule.roles,
            user_overrides: schedule.user_overrides,
            room_id: schedule.room_id,
            teacher_id: schedule.teacher_id,
            active: schedule.active,
        });
        setShowModal(true);
    };

    const openCreate = () => {
        setEditingSchedule(null);
        setFormError(null);
        setForm({ ...emptyForm, day_times: {} });
        setShowModal(true);
    };

    const handleDelete = async (id: string) => {
        const ok = await confirmDialog({
            title: 'Delete schedule?',
            message: 'This schedule and its enrollments will be removed.',
            confirmLabel: 'Delete',
        });
        if (ok) {
            await schedulesApi.delete(id);
            load();
            toast.success('Schedule deleted');
        }
    };

    const toggleDay = (day: string) => {
        setForm(f => {
            const day_times = { ...(f.day_times || {}) };
            if (day in day_times) {
                delete day_times[day];
            } else {
                day_times[day] = {
                    start_time: f.start_time || '08:00',
                    end_time: f.end_time || '18:00',
                };
            }
            return syncFormFromDayTimes({ ...f, day_times });
        });
    };

    const setDayTime = (day: string, field: 'start_time' | 'end_time', value: string) => {
        setForm(f => {
            const day_times = { ...(f.day_times || {}) };
            const current = day_times[day] || {
                start_time: f.start_time || '08:00',
                end_time: f.end_time || '18:00',
            };
            day_times[day] = { ...current, [field]: value };
            return syncFormFromDayTimes({ ...f, day_times });
        });
    };

    const getEnrolledNames = (schedule: Schedule) => {
        const userIds = schedule.user_overrides || [];
        return allUsers.filter(u => userIds.includes(u.id!));
    };

    const getRoomName = (roomId?: string) => {
        if (!roomId) return null;
        const room = rooms.find(r => r.id === roomId);
        return room?.name || null;
    };

    const getTeacherName = (teacherId?: string) => {
        if (!teacherId) return null;
        const user = allUsers.find(u => u.id === teacherId);
        return user?.name || null;
    };

    const teachers = allUsers.filter(u => u.role === 'teacher' && u.active);

    const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);

    const toggleWeeklyView = (id: string) => {
        setExpandedScheduleId(prev => prev === id ? null : id);
    };

    // Teachers only see schedules they are attached to
    const visibleSchedules = isTeacher
        ? schedules.filter(s => !!s.teacher_id && s.teacher_id === teacherUserId)
        : schedules;

    return (
        <div>
            <div className="page-toolbar">
                <div className="flex items-center gap-3">
                    <Clock size={20} style={{ color: 'var(--text-accent)' }} />
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                        {visibleSchedules.length} schedule{visibleSchedules.length !== 1 ? 's' : ''} configured
                    </span>
                </div>
                {!isTeacher && (
                    <button className="btn btn-primary" onClick={openCreate}>
                        <Plus size={16} /> New Schedule
                    </button>
                )}
            </div>

            {/* Schedule Cards */}
            <div className="responsive-card-grid" style={{ marginBottom: 32 }}>
                {visibleSchedules.map(schedule => {
                    const enrolled = getEnrolledNames(schedule);
                    const isExpanded = expandedScheduleId === schedule.id;
                    return (
                        <div key={schedule.id} className={`card schedule-card${isExpanded ? ' schedule-card-expanded' : ''}`}>
                            <div className="card-header" style={{ gap: 8, minWidth: 0 }}>
                                <div className="card-title" style={{ flex: 1, minWidth: 0 }}>
                                    <span className={`status-dot ${schedule.active ? 'online' : 'offline'}`} style={{ flexShrink: 0 }} />
                                    <span className="schedule-card-name">
                                        {schedule.name}
                                    </span>
                                    {getRoomName(schedule.room_id) && (
                                        <span className="badge badge-neutral" style={{ flexShrink: 0, fontSize: 10 }}>
                                            <DoorOpen size={10} style={{ marginRight: 3 }} />
                                            {getRoomName(schedule.room_id)}
                                        </span>
                                    )}
                                </div>
                                <div style={{ position: 'relative', flexShrink: 0 }}>
                                    <button
                                        className="btn btn-ghost btn-sm"
                                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === schedule.id ? null : schedule.id!); }}
                                        title="Actions"
                                        aria-haspopup="menu"
                                        aria-expanded={menuOpenId === schedule.id}
                                    >
                                        <MoreVertical size={16} />
                                    </button>
                                    {menuOpenId === schedule.id && (
                                        <div className="card-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                                            <button className="card-menu-item" role="menuitem"
                                                onClick={() => { setMenuOpenId(null); toggleWeeklyView(schedule.id!); }}>
                                                <Clock size={14} /> {isExpanded ? 'Hide weekly view' : 'Weekly view'}
                                            </button>
                                            <button className="card-menu-item" role="menuitem"
                                                onClick={() => { setMenuOpenId(null); setAttendanceSchedule(schedule); }}>
                                                <ClipboardList size={14} /> View attendance
                                            </button>
                                            {!isTeacher && (
                                                <>
                                                    <button className="card-menu-item" role="menuitem"
                                                        onClick={() => { setMenuOpenId(null); openEdit(schedule); }}>
                                                        <Pencil size={14} /> Edit
                                                    </button>
                                                    <button className="card-menu-item danger" role="menuitem"
                                                        onClick={() => { setMenuOpenId(null); handleDelete(schedule.id!); }}>
                                                        <Trash2 size={14} /> Delete
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="card-body">
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                                    {schedule.days.map(d => {
                                        const w = getDayWindow(schedule, d);
                                        return (
                                            <span key={d} className="badge badge-info" style={{ whiteSpace: 'nowrap' }}>
                                                {d.charAt(0).toUpperCase() + d.slice(1, 3)} {w.start_time}–{w.end_time}
                                            </span>
                                        );
                                    })}
                                </div>
                                <div style={{
                                    fontSize: 16, fontWeight: 700, color: 'var(--text-primary)',
                                    overflow: 'hidden', wordBreak: 'break-word',
                                    lineHeight: 1.35,
                                }}>
                                    {formatScheduleHours(schedule)}
                                </div>
                                {/* Assigned teacher — who can unlock the door */}
                                {schedule.teacher_id && (
                                    <div style={{
                                        marginTop: 8, display: 'flex', alignItems: 'center', gap: 6,
                                        fontSize: 12, color: 'var(--text-secondary)',
                                    }}>
                                        <Users size={12} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                        <span>
                                            <span style={{ color: 'var(--text-tertiary)' }}>Teacher: </span>
                                            <span style={{ fontWeight: 600 }}>
                                                {getTeacherName(schedule.teacher_id) || schedule.teacher_id}
                                            </span>
                                        </span>
                                    </div>
                                )}
                                {schedule.roles.length > 0 && (
                                    <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                        {schedule.roles.map(r => (
                                            <span key={r} className="badge badge-neutral">{r}</span>
                                        ))}
                                    </div>
                                )}

                                {/* Enrolled Students Section */}
                                <div style={{
                                    marginTop: 16, paddingTop: 14,
                                    borderTop: '1px solid var(--border-subtle)',
                                }}>
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        gap: 8, marginBottom: 10,
                                    }}>
                                        <span style={{
                                            fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                                            letterSpacing: '0.05em', color: 'var(--text-tertiary)',
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                        }}>
                                            <Users size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                                            Students ({enrolled.length})
                                        </span>
                                        {!isTeacher && (
                                            <button
                                                className="btn btn-secondary btn-sm"
                                                onClick={() => setEnrollSchedule(schedule)}
                                                style={{ fontSize: 11, padding: '3px 8px', flexShrink: 0 }}
                                            >
                                                <UserPlus size={12} /> Manage
                                            </button>
                                        )}
                                    </div>

                                    {enrolled.length > 0 ? (
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            {enrolled.slice(0, 5).map(user => (
                                                <div key={user.id} style={{
                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                    padding: '3px 10px 3px 3px', borderRadius: 20,
                                                    background: 'var(--bg-tertiary)', fontSize: 12,
                                                    maxWidth: '100%', minWidth: 0, overflow: 'hidden',
                                                }}>
                                                    <div style={{
                                                        width: 22, height: 22, borderRadius: '50%',
                                                        background: 'var(--color-primary-bg)',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        fontSize: 10, fontWeight: 700, color: 'var(--color-primary)',
                                                        flexShrink: 0,
                                                    }}>
                                                        {user.name.charAt(0).toUpperCase()}
                                                    </div>
                                                    <span style={{
                                                        color: 'var(--text-secondary)',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>{user.name}</span>
                                                </div>
                                            ))}
                                            {enrolled.length > 5 && (
                                                <div style={{
                                                    padding: '3px 10px', borderRadius: 20,
                                                    background: 'var(--bg-tertiary)', fontSize: 12,
                                                    color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center',
                                                }}>
                                                    +{enrolled.length - 5} more
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>
                                            No students enrolled
                                        </div>
                                    )}
                                </div>

                                {/* Live session: visitors + unknown faces from door scan */}
                                {schedule.room_id && (
                                    <LiveSessionPanel schedule={schedule} />
                                )}

                                {/* Per-Schedule Weekly View (expandable) */}
                                {isExpanded && (
                                    <div style={{
                                        marginTop: 16, paddingTop: 16,
                                        borderTop: '1px solid var(--border-subtle)',
                                    }}>
                                        <div style={{
                                            fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
                                            letterSpacing: '0.05em', color: 'var(--text-tertiary)',
                                            marginBottom: 12,
                                        }}>
                                            <Clock size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                                            Weekly Overview — {schedule.name}
                                        </div>
                                        <div className="schedule-scroll schedule-weekly-scroll">
                                            <div className="schedule-grid schedule-weekly-grid">
                                                <div className="schedule-cell header" />
                                                {DAY_SHORT.map(d => <div key={d} className="schedule-cell header">{d}</div>)}
                                                {HOURS.filter((_, i) => i % 2 === 0).map(hour => {
                                                    const h = parseInt(hour, 10);
                                                    return (
                                                        <React.Fragment key={`t-${hour}`}>
                                                            <div className="schedule-cell time-label">{hour}</div>
                                                            {DAYS.map((day, di) => {
                                                                const w = getDayWindow(schedule, day);
                                                                const start = parseInt(w.start_time, 10);
                                                                const end = parseInt(w.end_time, 10);
                                                                const isActive = h >= start && h < end;
                                                                const dayActive = schedule.days.includes(day) && isActive && schedule.active;
                                                                return (
                                                                    <div
                                                                        key={`${hour}-${di}`}
                                                                        className="schedule-cell"
                                                                        style={dayActive ? {
                                                                            background: dayColors[schedule.roles?.[0] || 'student'],
                                                                            borderLeft: '3px solid var(--color-primary)',
                                                                        } : {}}
                                                                    >
                                                                        {dayActive && h === start && (
                                                                            <div className="schedule-block" style={{ fontWeight: 600 }}>
                                                                                {w.start_time}–{w.end_time}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Create Modal */}
            {showModal && (
                <div className="modal-overlay" onClick={() => { setShowModal(false); setEditingSchedule(null); }}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">{editingSchedule ? 'Edit Schedule' : 'New Schedule'}</h2>
                            <button className="btn btn-ghost" onClick={() => { setShowModal(false); setEditingSchedule(null); }}><X size={18} /></button>
                        </div>
                        <div className="modal-body">
                            {formError && (
                                <div className="form-error-banner" role="alert">
                                    {formError}
                                </div>
                            )}
                            <div className="form-group">
                                <label className="form-label">Schedule Name</label>
                                <input className="form-input" value={form.name}
                                    onChange={e => { setForm({ ...form, name: e.target.value }); setFormError(null); }}
                                    placeholder="e.g. Weekday Lab Hours" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Days & Hours</label>
                                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 10px' }}>
                                    Select days, then set different hours for each day if needed.
                                </p>
                                <div className="day-hours-list">
                                    {DAYS.map(day => {
                                        const selected = !!(form.day_times && day in form.day_times);
                                        const window = form.day_times?.[day];
                                        return (
                                            <div key={day} className={`day-hours-row${selected ? ' selected' : ''}`}>
                                                <button
                                                    type="button"
                                                    className={`btn ${selected ? 'btn-primary' : 'btn-secondary'} btn-sm day-hours-day-btn`}
                                                    onClick={() => { toggleDay(day); setFormError(null); }}
                                                >
                                                    {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                                                </button>
                                                {selected && window ? (
                                                    <div className="day-hours-times">
                                                        <input
                                                            className="form-input"
                                                            type="time"
                                                            value={window.start_time}
                                                            onChange={e => { setDayTime(day, 'start_time', e.target.value); setFormError(null); }}
                                                            aria-label={`${day} start`}
                                                        />
                                                        <span className="day-hours-sep">—</span>
                                                        <input
                                                            className="form-input"
                                                            type="time"
                                                            value={window.end_time}
                                                            onChange={e => { setDayTime(day, 'end_time', e.target.value); setFormError(null); }}
                                                            aria-label={`${day} end`}
                                                        />
                                                    </div>
                                                ) : (
                                                    <span className="day-hours-hint">Off</span>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Room</label>
                                <select className="form-select" value={form.room_id || ''}
                                    onChange={e => setForm({ ...form, room_id: e.target.value || undefined })}>
                                    <option value="">No room assigned</option>
                                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}{r.floor ? ` (${r.floor})` : ''}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">Assigned Teacher</label>
                                <select className="form-select" value={form.teacher_id || ''}
                                    onChange={e => setForm({ ...form, teacher_id: e.target.value || undefined })}>
                                    <option value="">No teacher assigned (any authorised role can unlock)</option>
                                    {teachers.map(t => (
                                        <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                </select>
                                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
                                    When set, only this teacher (plus admins &amp; security) can unlock the door during this schedule.
                                </p>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => { setShowModal(false); setEditingSchedule(null); }}>Cancel</button>
                            <button className="btn btn-primary" onClick={handleSubmit}>
                                {editingSchedule ? 'Save Changes' : 'Create Schedule'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Enrollment Modal */}
            {enrollSchedule && (
                <EnrollmentModal
                    schedule={enrollSchedule}
                    allUsers={allUsers}
                    onClose={() => setEnrollSchedule(null)}
                    onUpdate={() => {
                        load();
                        // Refresh the enrollment modal's schedule data
                        schedulesApi.get(enrollSchedule.id!).then(s => setEnrollSchedule(s)).catch(() => { });
                    }}
                />
            )}

            {/* Attendance Modal */}
            {attendanceSchedule && (
                <AttendanceModal
                    schedule={attendanceSchedule}
                    onClose={() => setAttendanceSchedule(null)}
                />
            )}
        </div>
    );
}
