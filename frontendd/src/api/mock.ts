/* mock.ts — Frontend-only mock layer for LabSecure AI v2
 * =====================================================
 * Lets you browse every page with NO backend running.
 *
 * Activated when `import.meta.env.VITE_MOCK === 'true'` (see `.env.mock`
 * and the `dev:mock` npm script). When active it:
 *   1. Replaces the axios adapter with an in-memory router so every
 *      request in `client.ts` resolves with realistic fixture data.
 *   2. Seeds a fake auth token so the login screen is auto-bypassed.
 *   3. Provides a no-op fake WebSocket for the camera feed.
 *
 * The backend is never touched and never needs to be live.
 */

import type { AxiosInstance, AxiosRequestConfig } from 'axios';

export const MOCK_ENABLED = import.meta.env.VITE_MOCK === 'true';

// ── In-memory stores (mutations persist for the browser session) ──────────
const now = new Date('2026-06-24T10:00:00');
const iso = (offsetMin = 0) => new Date(now.getTime() + offsetMin * 60000).toISOString();

let _seq = 1000;
const newId = (prefix: string) => `${prefix}_${++_seq}`;

const rooms = [
    { id: 'room_lab_a', name: 'Telematics Lab A', description: 'Main networking lab', floor: '2', created_at: iso(-60 * 24 * 30) },
    { id: 'room_lab_b', name: 'Telematics Lab B', description: 'Secondary lab', floor: '2', created_at: iso(-60 * 24 * 25) },
    { id: 'room_server', name: 'Server Room', description: 'Core infrastructure', floor: '1', created_at: iso(-60 * 24 * 20) },
];

const users = [
    { id: 'u1', name: 'Alice Johnson', student_id: 'S1001', role: 'student', active: true, face_encoding_ref: 'ref_u1', created_at: iso(-60 * 24 * 18), updated_at: iso(-60 * 24 * 2) },
    { id: 'u2', name: 'Bob Smith', student_id: 'S1002', role: 'student', active: true, created_at: iso(-60 * 24 * 17) },
    { id: 'u3', name: 'Carol Lee', student_id: 'T2001', role: 'teacher', active: true, face_encoding_ref: 'ref_u3', created_at: iso(-60 * 24 * 30) },
    { id: 'u4', name: 'David Park', student_id: 'E3001', role: 'employee', active: true, created_at: iso(-60 * 24 * 12) },
    { id: 'u5', name: 'Erin Davis', student_id: 'SEC4001', role: 'security', active: true, face_encoding_ref: 'ref_u5', created_at: iso(-60 * 24 * 9) },
    { id: 'u6', name: 'Frank Moore', student_id: 'J5001', role: 'janitor', active: false, created_at: iso(-60 * 24 * 5) },
];

const schedules = [
    { id: 'sch1', name: 'Networking 101', days: ['monday', 'wednesday', 'friday'], start_time: '09:00', end_time: '11:00', roles: ['student', 'teacher'], user_overrides: [], room_id: 'room_lab_a', teacher_id: 'u3', active: true },
    { id: 'sch2', name: 'Security Lab', days: ['tuesday', 'thursday'], start_time: '13:00', end_time: '15:00', roles: ['student'], user_overrides: ['u4'], room_id: 'room_lab_b', teacher_id: 'u3', active: true },
    { id: 'sch3', name: 'Maintenance Window', days: ['saturday'], start_time: '08:00', end_time: '10:00', roles: ['janitor', 'employee'], user_overrides: [], room_id: 'room_server', active: false },
];

const permissions = [
    { id: 'p1', role: 'teacher', schedule_ids: [], can_unlock: true, can_access_outside_schedule: true, granted_by: 'admin', created_at: iso(-60 * 24 * 10) },
    { id: 'p2', user_id: 'u4', schedule_ids: ['sch2'], can_unlock: false, can_access_outside_schedule: false, granted_by: 'admin', created_at: iso(-60 * 24 * 6) },
    { id: 'p3', role: 'security', schedule_ids: [], can_unlock: true, can_access_outside_schedule: true, granted_by: 'admin', created_at: iso(-60 * 24 * 4) },
];

const guests = [
    { id: 'g1', name: 'Grace Visitor', purpose: 'Lab tour', sponsor_id: 'u3', face_encoding_ref: 'gref1', valid_from: iso(-120), valid_until: iso(240), revoked: false },
    { id: 'g2', name: 'Henry Contractor', purpose: 'AC maintenance', sponsor_id: 'u4', valid_from: iso(-60 * 24 * 3), valid_until: iso(-60 * 24 * 2), revoked: false },
];

const admins = [
    { id: 'a1', username: 'admin', role: 'admin', created_at: iso(-60 * 24 * 40) },
    { id: 'a2', username: 'carol', role: 'teacher', created_at: iso(-60 * 24 * 15) },
];

const eventTypes = [
    'access_granted', 'access_denied', 'unknown_face', 'emergency_lock',
    'guest_registered', 'anomaly_alert', 'user_created', 'camera_heartbeat',
] as const;

const events = Array.from({ length: 18 }).map((_, i) => {
    const type = eventTypes[i % eventTypes.length];
    const severity = type === 'access_denied' || type === 'unknown_face' ? 'warning'
        : type === 'emergency_lock' || type === 'anomaly_alert' ? 'critical' : 'info';
    return {
        id: `ev_${i}`,
        type,
        user_id: i % 3 === 0 ? users[i % users.length].id : undefined,
        camera_id: i % 2 === 0 ? 'cam_axis_01' : 'cam_webcam',
        details: { note: `Sample ${type} event #${i}` },
        timestamp: iso(-i * 17),
        severity,
    };
});

const cameras = [
    { id: 'cam_axis_01', name: 'Axis P1447-LE', type: 'ip', enabled: true, ip: '192.168.0.90', room_id: 'room_lab_a' },
    { id: 'cam_ip_01', name: 'Lab Entrance Camera', type: 'ip', enabled: false, ip: '192.168.1.101', room_id: 'room_lab_a' },
    { id: 'cam_webcam', name: 'Laptop Webcam', type: 'webcam', enabled: true, room_id: 'room_lab_b' },
];

const emergencyState = { emergency_lock: false, emergency_activated_by: undefined as string | undefined, emergency_activated_at: undefined as string | undefined };

const simClock = { current_time: '10:00', date: '2026-06-24', day: 'wednesday', hour: 10, minute: 0, is_simulated: false };

const doorLocks: Record<string, boolean> = { room_lab_a: false, room_lab_b: true, room_server: true };

function doorStatus(roomId: string) {
    const room = rooms.find(r => r.id === roomId) ?? rooms[0];
    const locked = doorLocks[roomId] ?? true;
    return {
        room_id: room.id,
        room_name: room.name,
        locked,
        scanning: false,
        unlocked_by: locked ? undefined : 'u3',
        unlocked_by_name: locked ? undefined : 'Carol Lee',
        unlocked_at: locked ? undefined : iso(-15),
        schedule_name: locked ? undefined : 'Networking 101',
        schedule_end_time: locked ? undefined : '11:00',
        auto_lock_at: locked ? undefined : iso(30),
        active_schedule: locked ? undefined : { id: 'sch1', name: 'Networking 101', start_time: '09:00', end_time: '11:00' },
        attendance: locked ? [] : [
            { user_id: 'u1', name: 'Alice Johnson', role: 'student', status: 'present', timestamp: iso(-12) },
            { user_id: 'u2', name: 'Bob Smith', role: 'student', status: 'present', timestamp: iso(-8) },
        ],
        attendance_count: locked ? 0 : 2,
        visitors: [],
        visitor_count: 0,
        unknown_visitors: [],
        unknown_count: 0,
    };
}

// ── Tiny route table ──────────────────────────────────────────────────────
type Handler = (m: RegExpMatchArray, cfg: AxiosRequestConfig) => unknown;
interface Route { method: string; pattern: RegExp; handler: Handler; }

const ok = (data: unknown) => data;
const body = (cfg: AxiosRequestConfig) => {
    try { return typeof cfg.data === 'string' ? JSON.parse(cfg.data) : (cfg.data ?? {}); }
    catch { return {}; }
};

const routes: Route[] = [
    // ── Auth ──
    { method: 'post', pattern: /\/api\/auth\/login$/, handler: (_m, c) => { const role = (body(c).username || '').toLowerCase().includes('teacher') ? 'teacher' : 'admin'; const teacher = users.find(u => u.role === 'teacher'); return { access_token: 'mock-token', token_type: 'bearer', role, user_id: role === 'teacher' ? (teacher?.id ?? null) : null }; } },
    { method: 'get', pattern: /\/api\/auth\/me$/, handler: () => { const role = localStorage.getItem('admin_role') || 'admin'; const teacher = users.find(u => u.role === 'teacher'); return { username: role === 'teacher' ? (teacher?.name ?? 'teacher') : 'admin', role, user_id: role === 'teacher' ? (teacher?.id ?? null) : null }; } },
    { method: 'get', pattern: /\/api\/auth\/admins$/, handler: () => ok(admins) },
    { method: 'post', pattern: /\/api\/auth\/admins$/, handler: (_m, c) => { const a = { id: newId('a'), username: body(c).username, role: body(c).role || 'admin', created_at: iso() }; admins.push(a); return a; } },
    { method: 'delete', pattern: /\/api\/auth\/admins\/([^/]+)$/, handler: (m) => { const i = admins.findIndex(a => a.id === m[1]); if (i >= 0) admins.splice(i, 1); return { status: 'deleted' }; } },

    // ── Users ──
    { method: 'get', pattern: /\/api\/users\/descriptors$/, handler: () => users.filter(u => u.face_encoding_ref).map(u => ({ user_id: u.id, name: u.name, descriptor: Array.from({ length: 8 }, () => Math.random()) })) },
    { method: 'get', pattern: /\/api\/users\/?(\?.*)?$/, handler: (_m, c) => (c.params?.active_only ? users.filter(u => u.active) : users) },
    { method: 'get', pattern: /\/api\/users\/([^/]+)$/, handler: (m) => users.find(u => u.id === m[1]) ?? users[0] },
    { method: 'post', pattern: /\/api\/users\/([^/]+)\/enroll-face$/, handler: (m) => { const u = users.find(x => x.id === m[1]); if (u) u.face_encoding_ref = 'ref_' + u.id; return { status: 'enrolled', user_id: m[1] }; } },
    { method: 'post', pattern: /\/api\/users\/?$/, handler: (_m, c) => { const u = { id: newId('u'), ...body(c), created_at: iso() }; users.push(u); return u; } },
    { method: 'put', pattern: /\/api\/users\/([^/]+)$/, handler: (m, c) => { const u = users.find(x => x.id === m[1]); if (u) Object.assign(u, body(c), { updated_at: iso() }); return u ?? body(c); } },
    { method: 'delete', pattern: /\/api\/users\/([^/]+)$/, handler: (m) => { const i = users.findIndex(u => u.id === m[1]); if (i >= 0) users.splice(i, 1); return { status: 'deleted' }; } },

    // ── Schedules ──
    { method: 'get', pattern: /\/api\/schedules\/([^/]+)\/attendance\/sessions$/, handler: () => [{ date: '2026-06-22', day: 'monday', count: 12 }, { date: '2026-06-19', day: 'friday', count: 10 }] },
    { method: 'get', pattern: /\/api\/schedules\/([^/]+)\/attendance(\?.*)?$/, handler: (m) => ({ date: '2026-06-22', schedule_id: m[1], schedule_name: schedules.find(s => s.id === m[1])?.name ?? 'Networking 101', present: [{ user_id: 'u1', name: 'Alice Johnson', student_id: 'S1001', role: 'student', timestamp: iso(-12) }, { user_id: 'u2', name: 'Bob Smith', student_id: 'S1002', role: 'student', timestamp: iso(-8) }], absent: [{ user_id: 'u4', name: 'David Park', student_id: 'E3001', role: 'employee', timestamp: null }] }) },
    { method: 'get', pattern: /\/api\/schedules\/?(\?.*)?$/, handler: (_m, c) => (c.params?.active_only ? schedules.filter(s => s.active) : schedules) },
    { method: 'get', pattern: /\/api\/schedules\/([^/]+)$/, handler: (m) => schedules.find(s => s.id === m[1]) ?? schedules[0] },
    { method: 'post', pattern: /\/api\/schedules\/?$/, handler: (_m, c) => { const s = { id: newId('sch'), ...body(c) }; schedules.push(s); return s; } },
    { method: 'put', pattern: /\/api\/schedules\/([^/]+)$/, handler: (m, c) => { const s = schedules.find(x => x.id === m[1]); if (s) Object.assign(s, body(c)); return s ?? body(c); } },
    { method: 'delete', pattern: /\/api\/schedules\/([^/]+)$/, handler: (m) => { const i = schedules.findIndex(s => s.id === m[1]); if (i >= 0) schedules.splice(i, 1); return { status: 'deleted' }; } },

    // ── Permissions ──
    { method: 'get', pattern: /\/api\/permissions\/?$/, handler: () => permissions },
    { method: 'post', pattern: /\/api\/permissions\/?$/, handler: (_m, c) => { const p = { id: newId('p'), created_at: iso(), ...body(c) }; permissions.push(p); return p; } },
    { method: 'put', pattern: /\/api\/permissions\/([^/]+)$/, handler: (m, c) => { const p = permissions.find(x => x.id === m[1]); if (p) Object.assign(p, body(c)); return p ?? body(c); } },
    { method: 'delete', pattern: /\/api\/permissions\/([^/]+)$/, handler: (m) => { const i = permissions.findIndex(p => p.id === m[1]); if (i >= 0) permissions.splice(i, 1); return { status: 'deleted' }; } },

    // ── Events ──
    { method: 'get', pattern: /\/api\/events\/types$/, handler: () => eventTypes.map(t => ({ value: t, label: t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) })) },
    { method: 'get', pattern: /\/api\/events\/stats(\?.*)?$/, handler: () => ({ total: events.length, by_type: events.reduce((a, e) => ({ ...a, [e.type]: (a[e.type] || 0) + 1 }), {} as Record<string, number>), by_severity: events.reduce((a, e) => ({ ...a, [e.severity]: (a[e.severity] || 0) + 1 }), {} as Record<string, number>) }) },
    { method: 'get', pattern: /\/api\/events\/?(\?.*)?$/, handler: () => events },

    // ── Guests ──
    { method: 'get', pattern: /\/api\/guests\/?(\?.*)?$/, handler: (_m, c) => (c.params?.include_expired ? guests : guests.filter(g => !g.revoked && new Date(g.valid_until!) > now)) },
    { method: 'post', pattern: /\/api\/guests\/([^/]+)\/enroll-face$/, handler: (m) => ({ status: 'enrolled', guest_id: m[1] }) },
    { method: 'post', pattern: /\/api\/guests\/?$/, handler: (_m, c) => { const g = { id: newId('g'), revoked: false, ...body(c) }; guests.push(g); return g; } },
    { method: 'delete', pattern: /\/api\/guests\/([^/]+)$/, handler: (m) => { const g = guests.find(x => x.id === m[1]); if (g) g.revoked = true; return { status: 'revoked' }; } },

    // ── Emergency ──
    { method: 'get', pattern: /\/api\/emergency\/status$/, handler: () => emergencyState },
    { method: 'post', pattern: /\/api\/emergency\/activate$/, handler: (_m, c) => { emergencyState.emergency_lock = true; emergencyState.emergency_activated_by = body(c).activated_by; emergencyState.emergency_activated_at = iso(); return emergencyState; } },
    { method: 'post', pattern: /\/api\/emergency\/deactivate$/, handler: () => { emergencyState.emergency_lock = false; emergencyState.emergency_activated_by = undefined; emergencyState.emergency_activated_at = undefined; return emergencyState; } },

    // ── Cameras ──
    { method: 'get', pattern: /\/api\/cameras\/health$/, handler: () => ({ cameras: cameras.map(c => ({ camera_id: c.id, name: c.name, type: c.type, connected: c.enabled, fps: c.enabled ? 24 + Math.floor(Math.random() * 3) : 0, last_frame_time: c.enabled ? iso() : undefined })), network: Object.fromEntries(cameras.filter(c => c.ip).map(c => [c.id, { id: c.id, ip: c.ip!, reachable: c.enabled, latency_ms: c.enabled ? 3 + Math.random() * 5 : undefined, last_check: now.getTime() }])) }) },
    { method: 'get', pattern: /\/api\/cameras\/list$/, handler: () => cameras },
    { method: 'post', pattern: /\/api\/cameras\/?$/, handler: (_m, c) => { const cam = { id: newId('cam'), enabled: true, ...body(c) }; cameras.push(cam); return cam; } },
    { method: 'put', pattern: /\/api\/cameras\/([^/]+)$/, handler: (m, c) => { const cam = cameras.find(x => x.id === m[1]); if (cam) Object.assign(cam, body(c)); return cam ?? body(c); } },
    { method: 'delete', pattern: /\/api\/cameras\/([^/]+)$/, handler: (m) => { const i = cameras.findIndex(c => c.id === m[1]); if (i >= 0) cameras.splice(i, 1); return { status: 'deleted' }; } },

    // ── Rooms ──
    { method: 'get', pattern: /\/api\/rooms\/?$/, handler: () => rooms },
    { method: 'get', pattern: /\/api\/rooms\/([^/]+)$/, handler: (m) => rooms.find(r => r.id === m[1]) ?? rooms[0] },
    { method: 'post', pattern: /\/api\/rooms\/?$/, handler: (_m, c) => { const r = { id: newId('room'), created_at: iso(), ...body(c) }; rooms.push(r); return r; } },
    { method: 'put', pattern: /\/api\/rooms\/([^/]+)$/, handler: (m, c) => { const r = rooms.find(x => x.id === m[1]); if (r) Object.assign(r, body(c)); return r ?? body(c); } },
    { method: 'delete', pattern: /\/api\/rooms\/([^/]+)$/, handler: (m) => { const i = rooms.findIndex(r => r.id === m[1]); if (i >= 0) rooms.splice(i, 1); return { status: 'deleted' }; } },

    // ── Doors ──
    { method: 'get', pattern: /\/api\/doors\/?$/, handler: () => rooms.map(r => doorStatus(r.id)) },
    { method: 'get', pattern: /\/api\/doors\/([^/]+)\/status$/, handler: (m) => doorStatus(m[1]) },
    { method: 'post', pattern: /\/api\/doors\/([^/]+)\/knock$/, handler: (m) => { doorLocks[m[1]] = false; return { granted: true, message: 'Access granted', user_id: 'u3', user_name: 'Carol Lee', reason: 'Within active schedule window' }; } },
    { method: 'post', pattern: /\/api\/doors\/([^/]+)\/scan$/, handler: () => ({ scanned: 2, entries: [{ name: 'Alice Johnson', status: 'present', recorded: true }, { name: 'Bob Smith', status: 'present', recorded: true }] }) },
    { method: 'put', pattern: /\/api\/doors\/([^/]+)\/lock$/, handler: (m) => { doorLocks[m[1]] = true; return doorStatus(m[1]); } },

    // ── Sim clock ──
    { method: 'get', pattern: /\/api\/sim-clock\/?$/, handler: () => simClock },
    { method: 'post', pattern: /\/api\/sim-clock\/set$/, handler: (_m, c) => { const b = body(c); Object.assign(simClock, { date: b.date, hour: b.hour, minute: b.minute, current_time: `${String(b.hour).padStart(2, '0')}:${String(b.minute).padStart(2, '0')}`, is_simulated: true }); return { status: 'set', ...simClock }; } },
    { method: 'post', pattern: /\/api\/sim-clock\/reset$/, handler: () => { Object.assign(simClock, { is_simulated: false, current_time: '10:00', hour: 10, minute: 0 }); return { status: 'reset', ...simClock }; } },
];

// ── Install the mock adapter onto an axios instance ───────────────────────
export function installMock(api: AxiosInstance) {
    // Auto-bypass login: seed a token + default role so the app starts signed in.
    if (!localStorage.getItem('admin_token')) localStorage.setItem('admin_token', 'mock-token');
    if (!localStorage.getItem('admin_role')) localStorage.setItem('admin_role', 'admin');

    api.defaults.adapter = async (config) => {
        const method = (config.method || 'get').toLowerCase();
        const url = (config.url || '').split('?')[0];
        const route = routes.find(r => r.method === method && r.pattern.test(url));

        // Simulate light network latency so loading states are visible.
        await new Promise(res => setTimeout(res, 120));

        if (!route) {
            console.warn(`[mock] no fixture for ${method.toUpperCase()} ${url} — returning []`);
            return mkResponse([], config);
        }
        const match = url.match(route.pattern) as RegExpMatchArray;
        const data = route.handler(match, config);
        return mkResponse(data, config);
    };

    console.info('%c[LabSecure] MOCK MODE — backend is not required', 'color:#22c55e;font-weight:bold');
}

function mkResponse(data: unknown, config: AxiosRequestConfig) {
    return {
        data,
        status: 200,
        statusText: 'OK',
        headers: {},
        config: config as never,
        request: {},
    };
}

// ── Fake WebSocket for the camera feed (no live video, UI still renders) ───
export function createFakeFeedSocket(): WebSocket {
    const listeners: Record<string, ((ev: unknown) => void)[]> = {};
    const sock = {
        binaryType: 'arraybuffer' as BinaryType,
        readyState: 1,
        onopen: null as ((ev: unknown) => void) | null,
        onmessage: null as ((ev: unknown) => void) | null,
        onerror: null as ((ev: unknown) => void) | null,
        onclose: null as ((ev: unknown) => void) | null,
        send() { /* no-op */ },
        close() { this.readyState = 3; this.onclose?.({ code: 1000 }); },
        addEventListener(type: string, cb: (ev: unknown) => void) { (listeners[type] ||= []).push(cb); },
        removeEventListener() { /* no-op */ },
        dispatchEvent() { return true; },
    };
    // Fire "open" on next tick so the page shows a connected (but frame-less) feed.
    setTimeout(() => { sock.onopen?.({}); listeners['open']?.forEach(cb => cb({})); }, 50);
    return sock as unknown as WebSocket;
}
