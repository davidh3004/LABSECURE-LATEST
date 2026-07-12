/* DoorEntryLists.tsx — Shared attendance / visitor / unknown lists for door simulation */

import { CheckCircle2, Users, UserX, Eye } from 'lucide-react';
import type { DoorStatus, UnknownVisitorEntry, VisitorEntry, AttendanceEntry } from '../../api/types';

const thStyle: React.CSSProperties = {
    padding: '7px 10px', textAlign: 'left', color: 'var(--text-tertiary)', fontWeight: 600,
};
const tdStyle: React.CSSProperties = {
    padding: '7px 10px', color: 'var(--text-main)',
};

export function fmtTime(iso: string) {
    try {
        return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
        return iso;
    }
}

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

interface DoorEntryListsProps {
    door: DoorStatus;
    onViewPhoto: (name: string, photo: string) => void;
}

export function DoorEntryLists({ door, onViewPhoto }: DoorEntryListsProps) {
    const total = door.attendance_count + door.visitor_count + door.unknown_count;

    if (total === 0) {
        if (!door.locked) {
            return (
                <div style={{
                    textAlign: 'center', padding: '20px 0',
                    color: 'var(--text-tertiary)', fontSize: 13,
                }}>
                    Door is open — waiting for faces to appear in camera…
                </div>
            );
        }
        return null;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {door.attendance_count > 0 && (
                <EntrySection
                    icon={<CheckCircle2 size={14} />}
                    title="Attendance"
                    count={door.attendance_count}
                    accentColor="#22c55e"
                    rows={door.attendance.map((a: AttendanceEntry) => ({
                        name: a.name,
                        role: a.role,
                        badge: 'Present',
                        badgeColor: '#22c55e',
                        time: a.timestamp,
                    }))}
                />
            )}

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
                                                    onClick={() => onViewPhoto(`Unknown #${i + 1}`, u.photo_b64!)}
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
                                                    onClick={() => onViewPhoto(`Unknown #${i + 1}`, u.photo_b64!)}
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
    );
}
