"""
LabSecure AI v2 — Pydantic Schema Models
Data models for all Firestore entities with validation and serialization.
"""

from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator


# ── Enums ──────────────────────────────────────────────

class UserRole(str, Enum):
    STUDENT = "student"
    TEACHER = "teacher"
    EMPLOYEE = "employee"
    JANITOR = "janitor"
    SECURITY = "security"
    ADMIN = "admin"


class EventType(str, Enum):
    ACCESS_GRANTED = "access_granted"
    ACCESS_DENIED = "access_denied"
    UNKNOWN_FACE = "unknown_face"
    ROLE_CHANGE = "role_change"
    CAMERA_HEARTBEAT = "camera_heartbeat"
    EMERGENCY_LOCK = "emergency_lock"
    EMERGENCY_UNLOCK = "emergency_unlock"
    GUEST_REGISTERED = "guest_registered"
    GUEST_EXPIRED = "guest_expired"
    GUEST_REVOKED = "guest_revoked"
    ANOMALY_ALERT = "anomaly_alert"
    USER_CREATED = "user_created"
    USER_UPDATED = "user_updated"
    USER_DELETED = "user_deleted"
    CAMERA_ADDED = "camera_added"
    CAMERA_DELETED = "camera_deleted"
    PERMISSION_GRANTED = "permission_granted"
    PERMISSION_UPDATED = "permission_updated"
    PERMISSION_REVOKED = "permission_revoked"
    SCHEDULE_CREATED = "schedule_created"
    SCHEDULE_UPDATED = "schedule_updated"
    SCHEDULE_DELETED = "schedule_deleted"
    ROOM_CREATED = "room_created"
    ROOM_UPDATED = "room_updated"
    ROOM_DELETED = "room_deleted"
    ADMIN_CREATED = "admin_created"
    ADMIN_DELETED = "admin_deleted"


class EventSeverity(str, Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


# ── User ───────────────────────────────────────────────

class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    student_id: str = Field(..., pattern=r"^\d{8}$")
    role: UserRole
    active: bool = True


class UserModel(BaseModel):
    id: Optional[str] = None
    name: str
    student_id: Optional[str] = None
    role: UserRole
    active: bool = True
    face_encoding_ref: Optional[str] = None
    face_descriptor: Optional[list[float]] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @field_validator("role", mode="before")
    @classmethod
    def normalize_role(cls, v):
        if isinstance(v, str):
            return v.lower()
        return v

    model_config = {"extra": "ignore"}

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        data["role"] = self.role.value
        if self.created_at:
            data["created_at"] = self.created_at
        if self.updated_at:
            data["updated_at"] = self.updated_at
        return data


class UserUpdate(BaseModel):
    name: Optional[str] = None
    student_id: Optional[str] = None
    role: Optional[UserRole] = None
    active: Optional[bool] = None


# ── Schedule ───────────────────────────────────────────

VALID_DAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


class ScheduleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    days: list[str]
    start_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    end_time: str = Field(..., pattern=r"^\d{2}:\d{2}$")
    roles: list[UserRole] = []
    user_overrides: list[str] = []
    room_id: Optional[str] = None
    teacher_id: Optional[str] = None   # The specific teacher who can unlock this door
    active: bool = True

    @field_validator("days")
    @classmethod
    def validate_days(cls, v):
        for day in v:
            if day.lower() not in VALID_DAYS:
                raise ValueError(f"Invalid day: {day}. Must be one of {VALID_DAYS}")
        return [d.lower() for d in v]


class ScheduleModel(BaseModel):
    id: Optional[str] = None
    name: str
    days: list[str]
    start_time: str
    end_time: str
    roles: list[str] = []
    user_overrides: list[str] = []
    room_id: Optional[str] = None
    teacher_id: Optional[str] = None   # The specific teacher who can unlock this door
    active: bool = True

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        return data


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    days: Optional[list[str]] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    roles: Optional[list[str]] = None
    user_overrides: Optional[list[str]] = None
    room_id: Optional[str] = None
    teacher_id: Optional[str] = None
    active: Optional[bool] = None


# ── Permission ─────────────────────────────────────────

class PermissionCreate(BaseModel):
    user_id: Optional[str] = None
    role: Optional[UserRole] = None
    # Which schedules this permission applies to.
    # Empty list = applies to ALL schedules/rooms.
    schedule_ids: list[str] = []
    # Can this subject unlock the door (turn the knob) for the covered schedules?
    can_unlock: bool = True
    # Can this subject enter outside their normal schedule window?
    can_access_outside_schedule: bool = False
    granted_by: str = "admin"


class PermissionModel(BaseModel):
    id: Optional[str] = None
    user_id: Optional[str] = None
    role: Optional[str] = None
    schedule_ids: list[str] = []
    can_unlock: bool = True
    can_access_outside_schedule: bool = False
    granted_by: str = ""
    created_at: Optional[datetime] = None

    model_config = {"extra": "ignore"}

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        return data


class PermissionUpdate(BaseModel):
    schedule_ids: Optional[list[str]] = None
    can_unlock: Optional[bool] = None
    can_access_outside_schedule: Optional[bool] = None


# ── Guest ──────────────────────────────────────────────

class GuestCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    purpose: str = Field(..., min_length=1)
    sponsor_id: str
    valid_from: datetime
    valid_until: datetime
    
    @field_validator("valid_until")
    @classmethod
    def validate_expiry(cls, v, info):
        if "valid_from" in info.data and v <= info.data["valid_from"]:
            raise ValueError("valid_until must be after valid_from")
        return v


class GuestModel(BaseModel):
    id: Optional[str] = None
    name: str
    purpose: str
    sponsor_id: str
    face_encoding_ref: Optional[str] = None
    valid_from: Optional[datetime] = None
    valid_until: Optional[datetime] = None
    revoked: bool = False

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        return data


# ── Event ──────────────────────────────────────────────

class EventCreate(BaseModel):
    type: EventType
    user_id: Optional[str] = None
    camera_id: str = ""
    details: dict = {}
    severity: EventSeverity = EventSeverity.INFO


class EventModel(BaseModel):
    id: Optional[str] = None
    type: str
    user_id: Optional[str] = None
    camera_id: str = ""
    details: dict = {}
    timestamp: Optional[datetime] = None
    severity: str = "info"

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        return data


# ── System State ───────────────────────────────────────

class SystemState(BaseModel):
    emergency_lock: bool = False
    emergency_activated_by: Optional[str] = None
    emergency_activated_at: Optional[datetime] = None


class EmergencyAction(BaseModel):
    activated_by: str = Field(..., min_length=1)


# ── Camera Health ──────────────────────────────────────

class CameraHealth(BaseModel):
    camera_id: str
    name: str
    type: str
    connected: bool = False
    fps: float = 0.0
    last_frame_time: Optional[datetime] = None
    ip_address: Optional[str] = None
    ping_ms: Optional[float] = None
    switch_port: Optional[int] = None


# ── Access Decision ────────────────────────────────────

class AccessDecision(BaseModel):
    granted: bool
    reason: str
    event_type: EventType
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    role: Optional[str] = None
    liveness_score: float = 0.0
    confidence: float = 0.0


# ── Camera Config ──────────────────────────────────────

class CameraCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    type: str = Field(..., pattern=r"^(ip|webcam)$")
    enabled: bool = True
    ip: Optional[str] = None
    room_id: Optional[str] = None


class CameraModel(BaseModel):
    id: Optional[str] = None
    name: str
    type: str = "ip"
    enabled: bool = True
    ip: Optional[str] = None
    room_id: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"extra": "ignore"}


# ── Room ───────────────────────────────────────────────

class RoomCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    floor: Optional[str] = None


class RoomModel(BaseModel):
    id: Optional[str] = None
    name: str
    description: Optional[str] = None
    floor: Optional[str] = None
    created_at: Optional[datetime] = None

    model_config = {"extra": "ignore"}

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        return data


class RoomUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    floor: Optional[str] = None


# ── Admin ─────────────────────────────────────────────

class AdminCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=5, max_length=128)
    role: str = Field(default="admin")  # "admin" or "teacher"


class AdminModel(BaseModel):
    id: Optional[str] = None
    username: str
    password_hash: str
    role: str = "admin"  # "admin" or "teacher"
    created_at: Optional[datetime] = None

    model_config = {"extra": "ignore"}

    def to_firestore(self) -> dict:
        data = self.model_dump(exclude={"id"}, exclude_none=True)
        return data
