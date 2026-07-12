/* InsightsDashboard.tsx — Security Analytics & Insights */

import { useState, useEffect } from 'react';
import {
    ShieldCheck, ShieldX, UserX, AlertTriangle,
    Activity, Camera, Clock, TrendingUp, Wifi, WifiOff,
} from 'lucide-react';
import { eventsApi, camerasApi } from '../api/client';
import type { SystemEvent, EventStats, CameraHealth, CameraConfig } from '../api/types';

// ── Bar Chart ──────────────────────────────────────────────────────────
function BarChart({ data }: { data: { label: string; value: number; color: string }[] }) {
    const max = Math.max(...data.map(d => d.value), 1);
    return (
        <div className="bar-chart-scroll">
            <div className="bar-chart-inner">
            {data.map(({ label, value, color }) => (
                <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 40 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600, minHeight: 16 }}>
                        {value > 0 ? value : ''}
                    </span>
                    <div style={{
                        width: '70%',
                        height: `${Math.max((value / max) * 90, value > 0 ? 6 : 2)}px`,
                        background: color,
                        borderRadius: '4px 4px 0 0',
                        transition: 'height 0.4s ease',
                        opacity: value === 0 ? 0.2 : 1,
                    }} />
                    <span style={{
                        fontSize: 10, color: 'var(--text-tertiary)', textAlign: 'center',
                        lineHeight: 1.3, paddingTop: 2, maxWidth: 56,
                    }}>
                        {label}
                    </span>
                </div>
            ))}
            </div>
        </div>
    );
}

// ── Donut Chart ────────────────────────────────────────────────────────
function DonutChart({ segments }: { segments: { label: string; value: number; color: string }[] }) {
    const total = segments.reduce((s, d) => s + d.value, 0);
    const r = 44;
    const stroke = 22;
    const circ = 2 * Math.PI * r;
    let offset = 0;
    const arcs = segments.map(seg => {
        const dash = total > 0 ? (seg.value / total) * circ : 0;
        const arc = { ...seg, dash, gap: circ - dash, offset };
        offset += dash;
        return arc;
    });

    return (
        <div className="insights-donut-wrap">
            <svg width={120} height={120} style={{ flexShrink: 0 }}>
                <g transform="rotate(-90 60 60)">
                    {total === 0
                        ? <circle cx={60} cy={60} r={r} fill="none" stroke="var(--border-primary)" strokeWidth={stroke} />
                        : arcs.map((arc, i) => (
                            <circle key={i} cx={60} cy={60} r={r} fill="none"
                                stroke={arc.color} strokeWidth={stroke}
                                strokeDasharray={`${arc.dash} ${arc.gap}`}
                                strokeDashoffset={-arc.offset}
                            />
                        ))}
                </g>
                <text x={60} y={56} textAnchor="middle"
                    style={{ fontSize: 20, fontWeight: 700, fill: 'var(--text-main)' }}>{total}</text>
                <text x={60} y={70} textAnchor="middle"
                    style={{ fontSize: 9, fill: 'var(--text-tertiary)', letterSpacing: 1 }}>TOTAL</text>
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {segments.map(seg => (
                    <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                            width: 10, height: 10, borderRadius: '50%',
                            background: seg.color, flexShrink: 0,
                        }} />
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>{seg.label}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>{seg.value}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 34, textAlign: 'right' }}>
                            {total > 0 ? `${((seg.value / total) * 100).toFixed(0)}%` : '0%'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ── Describe event for recent feed ─────────────────────────────────────
function describeEvent(event: SystemEvent): string {
    const d = event.details || {};
    switch (event.type) {
        case 'access_granted':
            return `Access granted${d.name ? ` to ${d.name}` : ''}${d.confidence ? ` (${((d.confidence as number) * 100).toFixed(0)}%)` : ''}`;
        case 'access_denied':
            return `Access denied${d.reason ? `: ${d.reason}` : ''}`;
        case 'unknown_face':
            return `Unknown face detected`;
        case 'anomaly_alert':
            return `Anomaly detected${d.reason ? `: ${d.reason}` : ''}`;
        case 'emergency_lock':
            return `Emergency lockdown activated by ${d.activated_by || '?'}`;
        case 'emergency_unlock':
            return `Emergency lockdown deactivated`;
        case 'guest_registered':
            return `Guest "${d.guest_name || '?'}" registered`;
        default:
            return event.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
}

const eventIcons: Record<string, typeof ShieldCheck> = {
    access_granted: ShieldCheck,
    access_denied: ShieldX,
    unknown_face: UserX,
    anomaly_alert: AlertTriangle,
};

const severityColors: Record<string, string> = {
    info: 'var(--color-info, #3b82f6)',
    warning: 'var(--color-warning)',
    critical: 'var(--color-danger)',
};

// ── Main Dashboard ─────────────────────────────────────────────────────
export default function InsightsDashboard() {
    const [stats, setStats] = useState<EventStats | null>(null);
    const [recent, setRecent] = useState<SystemEvent[]>([]);
    const [cameras, setCameras] = useState<CameraHealth[]>([]);

    const load = () => {
        eventsApi.stats().then(setStats).catch(() => {});
        eventsApi.list({ limit: 10 }).then(setRecent).catch(() => {});
        Promise.all([camerasApi.list(), camerasApi.health()])
            .then(([list, health]) => {
                const healthById = new Map(health.cameras.map(h => [h.camera_id, h]));
                const merged: CameraHealth[] = list.map((cam: CameraConfig) => {
                    const h = healthById.get(cam.id);
                    return {
                        camera_id: cam.id,
                        name: cam.name,
                        type: cam.type,
                        connected: h?.connected ?? false,
                        fps: h?.fps ?? 0,
                        last_frame_time: h?.last_frame_time,
                    };
                });
                for (const h of health.cameras) {
                    if (!merged.some(c => c.camera_id === h.camera_id)) {
                        merged.push(h);
                    }
                }
                setCameras(merged);
            })
            .catch(() => {});
    };

    useEffect(() => {
        load();
        const interval = setInterval(load, 15000);
        return () => clearInterval(interval);
    }, []);

    const bt = stats?.by_type || {};
    const bs = stats?.by_severity || {};

    const accessGranted = bt.access_granted || 0;
    const accessDenied = bt.access_denied || 0;
    const unknownFaces = bt.unknown_face || 0;
    const incidents = bs.critical || 0;

    const barData = [
        { label: 'Granted', value: accessGranted, color: 'var(--color-success)' },
        { label: 'Denied', value: accessDenied, color: 'var(--color-danger)' },
        { label: 'Unknown', value: unknownFaces, color: 'var(--color-warning)' },
        { label: 'Anomaly', value: bt.anomaly_alert || 0, color: '#8b5cf6' },
        { label: 'Emergency', value: (bt.emergency_lock || 0) + (bt.emergency_unlock || 0), color: '#ef4444' },
        { label: 'Guests', value: (bt.guest_registered || 0) + (bt.guest_revoked || 0), color: '#06b6d4' },
    ];

    const donutData = [
        { label: 'Granted', value: accessGranted, color: 'var(--color-success)' },
        { label: 'Denied', value: accessDenied, color: 'var(--color-danger)' },
        { label: 'Unknown', value: unknownFaces, color: 'var(--color-warning)' },
    ];

    const connectedCameras = cameras.filter(c => c.connected).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── Stat Cards ── */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div className="stat-label">Access Granted</div>
                            <div className="stat-value" style={{ color: 'var(--color-success)' }}>{accessGranted}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(34,197,94,0.1)' }}>
                            <ShieldCheck size={20} style={{ color: 'var(--color-success)' }} />
                        </div>
                    </div>
                </div>
                <div className="stat-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div className="stat-label">Access Denied</div>
                            <div className="stat-value" style={{ color: 'var(--color-danger)' }}>{accessDenied}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(239,68,68,0.1)' }}>
                            <ShieldX size={20} style={{ color: 'var(--color-danger)' }} />
                        </div>
                    </div>
                </div>
                <div className="stat-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div className="stat-label">Unknown Faces</div>
                            <div className="stat-value" style={{ color: 'var(--color-warning)' }}>{unknownFaces}</div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(245,158,11,0.1)' }}>
                            <UserX size={20} style={{ color: 'var(--color-warning)' }} />
                        </div>
                    </div>
                </div>
                <div className="stat-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <div className="stat-label">Critical Incidents</div>
                            <div className="stat-value" style={{ color: incidents > 0 ? 'var(--color-danger)' : 'var(--text-main)' }}>
                                {incidents}
                            </div>
                        </div>
                        <div style={{ padding: 10, borderRadius: 10, background: 'rgba(239,68,68,0.1)' }}>
                            <AlertTriangle size={20} style={{ color: 'var(--color-danger)' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Charts Row ── */}
            <div className="charts-grid-row">

                {/* Donut — Access Breakdown */}
                <div className="card">
                    <div className="card-body">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                            <TrendingUp size={16} style={{ color: 'var(--color-accent)' }} />
                            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
                                Access Breakdown
                            </span>
                        </div>
                        <DonutChart segments={donutData} />
                    </div>
                </div>

                {/* Bar — Events by Type */}
                <div className="card">
                    <div className="card-body">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <Activity size={16} style={{ color: 'var(--color-accent)' }} />
                            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
                                Events by Type
                            </span>
                        </div>
                        <BarChart data={barData} />
                    </div>
                </div>
            </div>

            {/* ── Bottom Row ── */}
            <div className="bottom-grid-row">

                {/* Recent Activity */}
                <div className="card">
                    <div className="card-body">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                            <Clock size={16} style={{ color: 'var(--color-accent)' }} />
                            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
                                Recent Activity
                            </span>
                        </div>
                        {recent.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
                                No events recorded yet
                            </div>
                        ) : (
                            recent.map(event => {
                                const Icon = eventIcons[event.type] || Activity;
                                const sev = event.severity;
                                return (
                                    <div key={event.id} className="event-row">
                                        <div className={`event-icon ${sev}`}>
                                            <Icon size={15} />
                                        </div>
                                        <div className="event-content">
                                            <div className="event-type">
                                                {event.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                                <span
                                                    className={`badge badge-${sev === 'critical' ? 'danger' : sev === 'warning' ? 'warning' : 'info'}`}
                                                    style={{ marginLeft: 8, fontSize: 10 }}>
                                                    {sev}
                                                </span>
                                            </div>
                                            <div className="event-details">{describeEvent(event)}</div>
                                        </div>
                                        <div className="event-time">
                                            {event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—'}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Camera Status */}
                <div className="card">
                    <div className="card-body">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Camera size={16} style={{ color: 'var(--color-accent)' }} />
                                <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-main)' }}>
                                    Camera Status
                                </span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                                {connectedCameras}/{cameras.length} online
                            </span>
                        </div>

                        {cameras.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-tertiary)', fontSize: 13 }}>
                                No cameras configured
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {cameras.map(cam => (
                                    <div key={cam.camera_id} style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '10px 12px',
                                        background: 'var(--bg-hover)',
                                        borderRadius: 8,
                                        border: '1px solid var(--border-primary)',
                                    }}>
                                        <div style={{ color: cam.connected ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                            {cam.connected ? <Wifi size={15} /> : <WifiOff size={15} />}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-main)',
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {cam.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                                {cam.type} • {cam.fps} fps
                                            </div>
                                        </div>
                                        <span className={`badge ${cam.connected ? 'badge-success' : 'badge-danger'}`}
                                            style={{ fontSize: 10 }}>
                                            {cam.connected ? 'LIVE' : 'OFFLINE'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
