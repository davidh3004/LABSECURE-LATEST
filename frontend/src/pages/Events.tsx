/* Events.tsx — Event Log Center with filtering */

import { useState, useEffect, useRef } from 'react';
import {
    ScrollText, Filter, Download, RefreshCw,
    ShieldCheck, ShieldX, UserX, AlertTriangle, Radio, Lock,
    UserPlus, Clock, Camera, Shield, Calendar, Pencil, Trash2, User, DoorOpen
} from 'lucide-react';
import { eventsApi } from '../api/client';
import type { SystemEvent, EventStats } from '../api/types';

const eventIcons: Record<string, typeof ShieldCheck> = {
    access_granted: ShieldCheck, access_denied: ShieldX, unknown_face: UserX,
    anomaly_alert: AlertTriangle, camera_heartbeat: Radio,
    emergency_lock: Lock, emergency_unlock: Lock,
    guest_registered: UserPlus, guest_expired: Clock, guest_revoked: Trash2,
    role_change: Shield,
    user_created: UserPlus, user_updated: Pencil, user_deleted: UserX,
    camera_added: Camera, camera_deleted: Trash2,
    permission_granted: ShieldCheck, permission_updated: Pencil, permission_revoked: ShieldX,
    schedule_created: Calendar, schedule_updated: Pencil, schedule_deleted: Trash2,
    room_created: DoorOpen, room_updated: Pencil, room_deleted: Trash2,
    admin_created: UserPlus, admin_deleted: UserX,
};

const severityClass: Record<string, string> = {
    info: 'info', warning: 'warning', critical: 'critical',
};

/** Build a human-readable description from event type + details */
function describeEvent(event: SystemEvent): string {
    const d = event.details || {};
    switch (event.type) {
        case 'user_created':
            return `User "${d.name || '?'}" created with role ${d.role || '?'}`;
        case 'user_updated':
            return `User "${d.name || '?'}" updated` +
                (d.active !== undefined ? ` (active: ${d.active})` : '');
        case 'user_deleted':
            return `User "${d.name || '?'}" deleted` + (d.role ? ` (role: ${d.role})` : '');
        case 'role_change':
            return `User "${d.name || '?'}" role changed to ${d.new_role || '?'}`;
        case 'camera_added':
            return `Camera "${d.name || '?'}" added (${d.type || '?'})`;
        case 'camera_deleted':
            return `Camera "${d.name || '?'}" removed`;
        case 'admin_created':
            return `Admin/Teacher account "${d.username || '?'}" created by ${d.created_by || '?'}`;
        case 'admin_deleted':
            return `Admin/Teacher account "${d.username || '?'}" deleted by ${d.deleted_by || '?'}`;
        case 'permission_granted':
            return `Permission granted` +
                (d.role ? ` for role "${d.role}"` : '') +
                (d.granted_by ? ` by ${d.granted_by}` : '');
        case 'permission_updated':
            return `Permission updated` +
                (d.can_access_outside_schedule !== undefined
                    ? ` (outside-schedule: ${d.can_access_outside_schedule})`
                    : '');
        case 'permission_revoked':
            return `Permission revoked`;
        case 'schedule_created':
            return `Schedule "${d.name || '?'}" created (${d.start_time || '?'} - ${d.end_time || '?'})`;
        case 'schedule_updated':
            return `Schedule "${d.name || '?'}" updated`;
        case 'schedule_deleted':
            return `Schedule "${d.name || '?'}" removed`;
        case 'room_created':
            return `Room "${d.name || '?'}" created` + (d.floor ? ` (${d.floor})` : '');
        case 'room_updated':
            return `Room "${d.name || '?'}" updated`;
        case 'room_deleted':
            return `Room "${d.name || '?'}" removed`;
        case 'guest_registered':
            return `Guest "${d.guest_name || '?'}" registered`;
        case 'guest_revoked':
            return `Guest access revoked`;
        case 'guest_expired':
            return `Guest access expired`;
        case 'emergency_lock':
            return `Emergency lockdown activated by ${d.activated_by || '?'}`;
        case 'emergency_unlock':
            return `Emergency lockdown deactivated by ${d.deactivated_by || '?'}`;
        case 'access_granted':
            return `Access granted` + (d.name ? ` to ${d.name}` : '') +
                (d.confidence ? ` (${((d.confidence as number) * 100).toFixed(0)}% confidence)` : '');
        case 'access_denied':
            return `Access denied` + (d.reason ? `: ${d.reason}` : '');
        case 'unknown_face':
            return `Unknown face detected` +
                (d.confidence ? ` (${((d.confidence as number) * 100).toFixed(0)}% match)` : '');
        case 'anomaly_alert':
            return `Anomaly detected` + (d.reason ? `: ${d.reason}` : '');
        default:
            return event.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
}

export default function EventsPage() {
    const [events, setEvents] = useState<SystemEvent[]>([]);
    const [stats, setStats] = useState<EventStats | null>(null);
    const [filters, setFilters] = useState({ type: '', severity: '', limit: 100 });
    const [autoRefresh, setAutoRefresh] = useState(true);
    const intervalRef = useRef<ReturnType<typeof setInterval>>();

    const load = () => {
        const params: Record<string, string | number> = { limit: filters.limit };
        if (filters.type) params.type = filters.type;
        if (filters.severity) params.severity = filters.severity;
        eventsApi.list(params).then(setEvents).catch(() => { });
        eventsApi.stats().then(setStats).catch(() => { });
    };

    useEffect(() => { load(); }, [filters]);

    useEffect(() => {
        if (autoRefresh) {
            intervalRef.current = setInterval(load, 15000);
        }
        return () => clearInterval(intervalRef.current);
    }, [autoRefresh, filters]);

    const exportCsv = () => {
        const headers = ['Timestamp', 'Type', 'Severity', 'Camera', 'User ID', 'Details'];
        const rows = events.map(e => [
            e.timestamp || '', e.type, e.severity, e.camera_id,
            e.user_id || '', JSON.stringify(e.details),
        ]);
        const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'events.csv'; a.click();
        URL.revokeObjectURL(url);
    };

    const formatTime = (ts?: string) => {
        if (!ts) return '—';
        const d = new Date(ts);
        return d.toLocaleString();
    };

    return (
        <div>
            {/* Stats */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-label">Total Events</div>
                    <div className="stat-value">{stats?.total || 0}</div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Access Granted</div>
                    <div className="stat-value" style={{ color: 'var(--color-success)' }}>
                        {stats?.by_type?.access_granted || 0}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Access Denied</div>
                    <div className="stat-value" style={{ color: 'var(--color-danger)' }}>
                        {stats?.by_type?.access_denied || 0}
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-label">Critical Alerts</div>
                    <div className="stat-value" style={{ color: 'var(--color-warning)' }}>
                        {stats?.by_severity?.critical || 0}
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="page-toolbar">
                <div className="filter-bar">
                    <select className="form-select" value={filters.type}
                        onChange={e => setFilters({ ...filters, type: e.target.value })}>
                        <option value="">All Types</option>
                        <optgroup label="Access">
                            <option value="access_granted">Access Granted</option>
                            <option value="access_denied">Access Denied</option>
                            <option value="unknown_face">Unknown Face</option>
                        </optgroup>
                        <optgroup label="Users">
                            <option value="user_created">User Created</option>
                            <option value="user_updated">User Updated</option>
                            <option value="user_deleted">User Deleted</option>
                            <option value="role_change">Role Change</option>
                        </optgroup>
                        <optgroup label="Cameras">
                            <option value="camera_added">Camera Added</option>
                            <option value="camera_deleted">Camera Deleted</option>
                        </optgroup>
                        <optgroup label="Permissions">
                            <option value="permission_granted">Permission Granted</option>
                            <option value="permission_updated">Permission Updated</option>
                            <option value="permission_revoked">Permission Revoked</option>
                        </optgroup>
                        <optgroup label="Schedules">
                            <option value="schedule_created">Schedule Created</option>
                            <option value="schedule_updated">Schedule Updated</option>
                            <option value="schedule_deleted">Schedule Deleted</option>
                        </optgroup>
                        <optgroup label="Rooms">
                            <option value="room_created">Room Created</option>
                            <option value="room_updated">Room Updated</option>
                            <option value="room_deleted">Room Deleted</option>
                        </optgroup>
                        <optgroup label="Guests">
                            <option value="guest_registered">Guest Registered</option>
                            <option value="guest_revoked">Guest Revoked</option>
                            <option value="guest_expired">Guest Expired</option>
                        </optgroup>
                        <optgroup label="System">
                            <option value="emergency_lock">Emergency Lock</option>
                            <option value="emergency_unlock">Emergency Unlock</option>
                            <option value="anomaly_alert">Anomaly Alert</option>
                            <option value="admin_created">Admin Created</option>
                            <option value="admin_deleted">Admin Deleted</option>
                        </optgroup>
                    </select>
                    <select className="form-select" value={filters.severity}
                        onChange={e => setFilters({ ...filters, severity: e.target.value })}>
                        <option value="">All Severities</option>
                        <option value="info">Info</option>
                        <option value="warning">Warning</option>
                        <option value="critical">Critical</option>
                    </select>
                </div>
                <div className="page-toolbar-actions">
                    <button className={`btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                        onClick={() => setAutoRefresh(!autoRefresh)}>
                        <RefreshCw size={14} className={autoRefresh ? 'spin' : ''} />
                        {autoRefresh ? 'Live' : 'Paused'}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={exportCsv}>
                        <Download size={14} /> CSV
                    </button>
                </div>
            </div>

            {/* Event List */}
            <div className="card">
                <div className="card-body" style={{ padding: '8px 20px' }}>
                    {events.map(event => {
                        const Icon = eventIcons[event.type] || ScrollText;
                        return (
                            <div key={event.id} className="event-row">
                                <div className={`event-icon ${severityClass[event.severity]}`}>
                                    <Icon size={16} />
                                </div>
                                <div className="event-content">
                                    <div className="event-type">
                                        {event.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                                        <span className={`badge badge-${event.severity === 'critical' ? 'danger' : event.severity === 'warning' ? 'warning' : 'info'}`}
                                            style={{ marginLeft: 8, fontSize: 10 }}>
                                            {event.severity}
                                        </span>
                                    </div>
                                    <div className="event-details">
                                        {describeEvent(event)}
                                        {event.camera_id && <span> • Camera: {event.camera_id}</span>}
                                    </div>
                                </div>
                                <div className="event-time">{formatTime(event.timestamp)}</div>
                            </div>
                        );
                    })}
                    {events.length === 0 && (
                        <div className="text-center" style={{ padding: 60, color: 'var(--text-tertiary)' }}>
                            <ScrollText size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
                            <div>No events recorded yet</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
