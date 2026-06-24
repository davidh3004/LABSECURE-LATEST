/* API Client — LabSecure AI v2 */

import axios from 'axios';
import type {
    User, UserCreate, Schedule, ScheduleCreate,
    Permission, Guest, GuestCreate, SystemEvent,
    SystemState, HealthResponse, EventStats, CameraConfig,
    Room, RoomCreate,
    DoorStatus, KnockResponse, SimClockState,
    AttendanceSession, AttendanceResponse,
} from './types';
import { MOCK_ENABLED, installMock, createFakeFeedSocket } from './mock';

const API_BASE = import.meta.env.VITE_API_BASE || '';

const api = axios.create({
    baseURL: API_BASE,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
    },
});

// Mock mode: serve every request from in-memory fixtures (no backend needed).
if (MOCK_ENABLED) {
    installMock(api);
}

// Interceptor to attach the auth token to all requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('admin_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// ── Users ───────────────────────────────────────────────
export const usersApi = {
    list: (activeOnly = false) =>
        api.get<User[]>('/api/users/', { params: { active_only: activeOnly } }).then(r => r.data),
    get: (id: string) =>
        api.get<User>(`/api/users/${id}`).then(r => r.data),
    create: (data: UserCreate) =>
        api.post<User>('/api/users/', data).then(r => r.data),
    update: (id: string, data: Partial<UserCreate>) =>
        api.put<User>(`/api/users/${id}`, data).then(r => r.data),
    delete: (id: string) =>
        api.delete(`/api/users/${id}`).then(r => r.data),
    enrollFace: (id: string, photo: Blob) => {
        const form = new FormData();
        form.append('photo', photo, 'face.jpg');
        return api.post(`/api/users/${id}/enroll-face`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,  // InsightFace inference can take several seconds on CPU
        }).then(r => r.data);
    },
    descriptors: () =>
        api.get<{ user_id: string; name: string; descriptor: number[] }[]>('/api/users/descriptors').then(r => r.data),
};

// ── Schedules ───────────────────────────────────────────
export const schedulesApi = {
    list: (activeOnly = false) =>
        api.get<Schedule[]>('/api/schedules/', { params: { active_only: activeOnly } }).then(r => r.data),
    get: (id: string) =>
        api.get<Schedule>(`/api/schedules/${id}`).then(r => r.data),
    create: (data: ScheduleCreate) =>
        api.post<Schedule>('/api/schedules/', data).then(r => r.data),
    update: (id: string, data: Partial<ScheduleCreate>) =>
        api.put<Schedule>(`/api/schedules/${id}`, data).then(r => r.data),
    delete: (id: string) =>
        api.delete(`/api/schedules/${id}`).then(r => r.data),
    attendanceSessions: (id: string) =>
        api.get<AttendanceSession[]>(`/api/schedules/${id}/attendance/sessions`).then(r => r.data),
    attendance: (id: string, date?: string) =>
        api.get<AttendanceResponse>(`/api/schedules/${id}/attendance`, { params: date ? { date } : {} }).then(r => r.data),
};

// ── Permissions ─────────────────────────────────────────
export const permissionsApi = {
    list: () =>
        api.get<Permission[]>('/api/permissions/').then(r => r.data),
    create: (data: Omit<Permission, 'id' | 'created_at'>) =>
        api.post<Permission>('/api/permissions/', data).then(r => r.data),
    update: (id: string, data: Partial<Permission>) =>
        api.put<Permission>(`/api/permissions/${id}`, data).then(r => r.data),
    delete: (id: string) =>
        api.delete(`/api/permissions/${id}`).then(r => r.data),
};

// ── Events ──────────────────────────────────────────────
export const eventsApi = {
    list: (params?: Record<string, string | number>) =>
        api.get<SystemEvent[]>('/api/events/', { params }).then(r => r.data),
    types: () =>
        api.get<{ value: string; label: string }[]>('/api/events/types').then(r => r.data),
    stats: (params?: Record<string, string>) =>
        api.get<EventStats>('/api/events/stats', { params }).then(r => r.data),
};

// ── Guests ──────────────────────────────────────────────
export const guestsApi = {
    list: (includeExpired = false) =>
        api.get<Guest[]>('/api/guests/', { params: { include_expired: includeExpired } }).then(r => r.data),
    create: (data: GuestCreate) =>
        api.post<Guest>('/api/guests/', data).then(r => r.data),
    revoke: (id: string) =>
        api.delete(`/api/guests/${id}`).then(r => r.data),
    enrollFace: (id: string, photo: Blob) => {
        const form = new FormData();
        form.append('photo', photo, 'face.jpg');
        return api.post(`/api/guests/${id}/enroll-face`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
            timeout: 30000,
        }).then(r => r.data);
    },
};

// ── Emergency ───────────────────────────────────────────
export const emergencyApi = {
    status: () =>
        api.get<SystemState>('/api/emergency/status').then(r => r.data),
    activate: (activatedBy: string) =>
        api.post('/api/emergency/activate', { activated_by: activatedBy }).then(r => r.data),
    deactivate: (activatedBy: string) =>
        api.post('/api/emergency/deactivate', { activated_by: activatedBy }).then(r => r.data),
};

// ── Cameras ─────────────────────────────────────────────
export const camerasApi = {
    health: () =>
        api.get<HealthResponse>('/api/cameras/health').then(r => r.data),
    list: () =>
        api.get<CameraConfig[]>('/api/cameras/list').then(r => r.data),
    create: (data: { name: string; type: 'ip' | 'webcam'; enabled?: boolean; ip?: string; room_id?: string }) =>
        api.post<CameraConfig>('/api/cameras/', data).then(r => r.data),
    update: (id: string, data: Partial<CameraConfig>) =>
        api.put<CameraConfig>(`/api/cameras/${id}`, data).then(r => r.data),
    delete: (id: string) =>
        api.delete(`/api/cameras/${id}`).then(r => r.data),
};

// ── Rooms ─────────────────────────────────────────────
export const roomsApi = {
    list: () =>
        api.get<Room[]>('/api/rooms/').then(r => r.data),
    get: (id: string) =>
        api.get<Room>(`/api/rooms/${id}`).then(r => r.data),
    create: (data: RoomCreate) =>
        api.post<Room>('/api/rooms/', data).then(r => r.data),
    update: (id: string, data: Partial<RoomCreate>) =>
        api.put<Room>(`/api/rooms/${id}`, data).then(r => r.data),
    delete: (id: string) =>
        api.delete(`/api/rooms/${id}`).then(r => r.data),
};

// ── WebSocket Feed ──────────────────────────────────────
export function createFeedSocket(cameraId: string): WebSocket {
    if (MOCK_ENABLED) {
        return createFakeFeedSocket();
    }
    const wsBase = API_BASE
        ? API_BASE.replace(/^http/, 'ws')
        : `ws://${window.location.hostname}:8000`;
    return new WebSocket(`${wsBase}/ws/feed/${cameraId}`);
}

// ── Auth ────────────────────────────────────────────────
export const authApi = {
    login: (username: string, password: string) => {
        return api.post<{ access_token: string, token_type: string, role: string }>('/api/auth/login', { username, password }).then(r => r.data);
    },
    getMe: () =>
        api.get<any>('/api/auth/me').then(r => r.data),
    listAdmins: () =>
        api.get<any[]>('/api/auth/admins').then(r => r.data),
    createAdmin: (username: string, password: string, role: string = 'admin') =>
        api.post<any>('/api/auth/admins', { username, password, role }).then(r => r.data),
    deleteAdmin: (id: string) =>
        api.delete(`/api/auth/admins/${id}`).then(r => r.data),
};

// ── Door Simulation ─────────────────────────────────────
export const doorsApi = {
    listAll: () =>
        api.get<DoorStatus[]>('/api/doors/').then(r => r.data),
    status: (roomId: string) =>
        api.get<DoorStatus>(`/api/doors/${roomId}/status`).then(r => r.data),
    knock: (roomId: string) =>
        api.post<KnockResponse>(`/api/doors/${roomId}/knock`).then(r => r.data),
    scan: (roomId: string) =>
        api.post<{ scanned: number; entries: { name: string; status: string; recorded: boolean }[] }>(
            `/api/doors/${roomId}/scan`
        ).then(r => r.data),
    lock: (roomId: string) =>
        api.put(`/api/doors/${roomId}/lock`).then(r => r.data),
};

// ── Simulation Clock ────────────────────────────────────
export const simClockApi = {
    get: () =>
        api.get<SimClockState>('/api/sim-clock/').then(r => r.data),
    set: (date: string, hour: number, minute: number) =>
        api.post<SimClockState & { status: string }>('/api/sim-clock/set', { date, hour, minute }).then(r => r.data),
    reset: () =>
        api.post<SimClockState & { status: string }>('/api/sim-clock/reset').then(r => r.data),
};

export default api;
