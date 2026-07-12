/* TypeScript Types — LabSecure AI v2 */

export type UserRole = 'student' | 'teacher' | 'employee' | 'janitor' | 'security' | 'admin';

export type EventType =
    | 'access_granted' | 'access_denied' | 'unknown_face'
    | 'role_change' | 'camera_heartbeat' | 'emergency_lock'
    | 'emergency_unlock' | 'guest_registered' | 'guest_expired'
    | 'guest_revoked' | 'anomaly_alert' | 'user_created'
    | 'user_updated' | 'user_deleted'
    | 'camera_added' | 'camera_deleted'
    | 'permission_granted' | 'permission_updated' | 'permission_revoked'
    | 'schedule_created' | 'schedule_updated' | 'schedule_deleted'
    | 'room_created' | 'room_updated' | 'room_deleted'
    | 'admin_created' | 'admin_deleted';

export type EventSeverity = 'info' | 'warning' | 'critical';

export interface User {
    id?: string;
    name: string;
    student_id: string;
    role: UserRole;
    active: boolean;
    biometric_consent?: boolean;
    consent_timestamp?: string;
    face_encoding_ref?: string;
    created_at?: string;
    updated_at?: string;
}

export interface UserCreate {
    name: string;
    student_id: string;
    role: UserRole;
    active: boolean;
    biometric_consent?: boolean;
    consent_timestamp?: string;
}

export interface DayTimeWindow {
    start_time: string;
    end_time: string;
}

export interface Schedule {
    id?: string;
    name: string;
    days: string[];
    start_time: string;
    end_time: string;
    /** Per-day hours. When set for a day, overrides global start/end for that day. */
    day_times?: Record<string, DayTimeWindow>;
    roles: string[];
    user_overrides: string[];
    room_id?: string;
    teacher_id?: string;   // specific teacher who can unlock the door
    active: boolean;
}

export interface ScheduleCreate {
    name: string;
    days: string[];
    start_time: string;
    end_time: string;
    day_times?: Record<string, DayTimeWindow>;
    roles: string[];
    user_overrides: string[];
    room_id?: string;
    teacher_id?: string;
    active: boolean;
}

export interface Permission {
    id?: string;
    user_id?: string;
    role?: string;
    /** Which schedule IDs this covers. Empty = all schedules. */
    schedule_ids: string[];
    /** Can this subject turn the knob / unlock the door? */
    can_unlock: boolean;
    /** Can this subject enter outside their normal schedule window? */
    can_access_outside_schedule: boolean;
    granted_by: string;
    created_at?: string;
}

export interface Guest {
    id?: string;
    name: string;
    purpose: string;
    sponsor_id: string;
    face_encoding_ref?: string;
    valid_from?: string;
    valid_until?: string;
    revoked: boolean;
}

export interface GuestCreate {
    name: string;
    purpose: string;
    sponsor_id: string;
    valid_from: string;
    valid_until: string;
}

export interface SystemEvent {
    id?: string;
    type: EventType;
    user_id?: string;
    camera_id: string;
    details: Record<string, unknown>;
    timestamp?: string;
    severity: EventSeverity;
}

export interface SystemState {
    emergency_lock: boolean;
    emergency_activated_by?: string;
    emergency_activated_at?: string;
}

export interface CameraConfig {
    id: string;
    name: string;
    type: 'ip' | 'webcam';
    enabled: boolean;
    ip?: string;
    room_id?: string;
}

export interface CameraHealth {
    camera_id: string;
    name: string;
    type: string;
    connected: boolean;
    fps: number;
    last_frame_time?: string;
}

export interface NetworkHealth {
    id: string;
    ip: string;
    reachable: boolean;
    latency_ms?: number;
    last_check: number;
}

export interface HealthResponse {
    cameras: CameraHealth[];
    network: Record<string, NetworkHealth>;
}

export interface EventStats {
    total: number;
    by_type: Record<string, number>;
    by_severity: Record<string, number>;
}

export interface Room {
    id?: string;
    name: string;
    description?: string;
    floor?: string;
    created_at?: string;
}

export interface RoomCreate {
    name: string;
    description?: string;
    floor?: string;
}

// ── Door Simulation ────────────────────────────────────

export interface AttendanceEntry {
    user_id?: string;
    name: string;
    role?: string;
    status: 'present' | 'not_enrolled' | 'unknown';
    timestamp: string;
}

export interface UnknownVisitorEntry {
    user_id: null;
    name: string;
    role: string;
    status: 'unknown';
    timestamp: string;
    photo_b64?: string;    // base64 JPEG face crop
}

export interface VisitorEntry {
    user_id: string;
    name: string;
    role: string;
    status: 'not_enrolled';
    timestamp: string;
}

export interface ActiveScheduleInfo {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
}

export interface DoorStatus {
    room_id: string;
    room_name: string;
    locked: boolean;
    scanning: boolean;
    unlocked_by?: string;
    unlocked_by_name?: string;
    unlocked_at?: string;
    schedule_name?: string;
    schedule_end_time?: string;
    auto_lock_at?: string;
    active_schedule?: ActiveScheduleInfo;
    // Enrolled students who entered
    attendance: AttendanceEntry[];
    attendance_count: number;
    // Registered users not enrolled in this schedule
    visitors: VisitorEntry[];
    visitor_count: number;
    // Unregistered / unrecognised faces
    unknown_visitors: UnknownVisitorEntry[];
    unknown_count: number;
}

export interface KnockResponse {
    granted: boolean;
    message: string;
    user_id?: string;
    user_name?: string;
    reason: string;
}

export interface ScanResponse {
    scanned: number;
    entries: { name: string; status: string; recorded: boolean }[];
}

export interface SimClockState {
    current_time: string;
    date: string;
    day: string;
    hour: number;
    minute: number;
    is_simulated: boolean;
}

// ── Schedule Attendance ────────────────────────────────

export interface AttendanceRecord {
    user_id: string;
    name: string;
    student_id?: string;
    role?: string;
    timestamp: string | null;
}

export interface AttendanceSession {
    date: string;   // YYYY-MM-DD
    day: string;    // e.g. "monday"
    count: number;
}

export interface AttendanceResponse {
    date: string;
    schedule_id: string;
    schedule_name: string;
    present: AttendanceRecord[];
    absent: AttendanceRecord[];
}
