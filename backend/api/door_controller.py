"""
LabSecure AI v2 — Door Controller (Simulation)

Realistic door simulation:
  - Door starts locked.
  - Turning the knob identifies the person via camera; authorized users unlock it.
  - Once unlocked the door stays open for the entire schedule + 30 min grace, then
    auto-locks (no manual closing required).
  - While unlocked a background scan thread continuously reads the camera every 2.5 s
    and sorts every detected face into one of three lists:
      • attendance      — enrolled in the active schedule   (present)
      • visitors        — registered user, not enrolled     (visitor)
      • unknown_visitors— face detected but not in database (unknown, with photo crop)
  - A manual /scan endpoint lets the admin trigger an immediate scan.
"""

import base64
import logging
import threading
import time as _time
from datetime import datetime
from typing import Optional

import cv2
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.utils.sim_clock import sim_clock
from backend.utils.schedule_utils import (
    get_active_schedule,
    get_schedule_in_grace_period,
    is_user_authorized_to_unlock,
    get_attendance_status,
    get_today_schedule_window,
)
from backend.db.repositories import RoomRepository, CameraRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/doors", tags=["Door Simulation"])


# ── Door State ────────────────────────────────────────

class DoorState:
    """In-memory state for one simulated door."""

    def __init__(self, room_id: str, room_name: str):
        self.room_id = room_id
        self.room_name = room_name
        self.locked = True

        # Who unlocked and which schedule
        self.unlocked_by: Optional[str] = None
        self.unlocked_by_name: Optional[str] = None
        self.unlocked_at: Optional[datetime] = None
        self.schedule_id: Optional[str] = None
        self.schedule_name: Optional[str] = None
        self.schedule_end_time: Optional[str] = None

        # Three separate entry lists (reset on each unlock)
        self.attendance: list[dict] = []          # enrolled → present
        self.visitors: list[dict] = []            # registered but not enrolled
        self.unknown_visitors: list[dict] = []    # unrecognised faces + photo

        # Continuous scan thread
        self._scan_stop = threading.Event()
        self._scan_thread: Optional[threading.Thread] = None

    # ── Lifecycle ─────────────────────────────────────

    def unlock(self, user_id: str, user_name: str, schedule):
        self.locked = False
        self.unlocked_by = user_id
        self.unlocked_by_name = user_name
        self.unlocked_at = sim_clock.now()
        self.schedule_id = schedule.id
        self.schedule_name = schedule.name
        _start, end_time = get_today_schedule_window(schedule)
        self.schedule_end_time = end_time

        # Fresh lists for the new session
        self.attendance = []
        self.visitors = []
        self.unknown_visitors = []

        # Start continuous background scan
        self._scan_stop.clear()
        self._scan_thread = threading.Thread(
            target=_continuous_scan,
            args=(self.room_id, self, self._scan_stop),
            daemon=True,
        )
        self._scan_thread.start()
        logger.info(f"Door UNLOCKED — room={self.room_name}, by={user_name}, schedule={schedule.name}")

    def lock(self):
        self.locked = True
        self._scan_stop.set()   # signal background scan to stop
        logger.info(
            f"Door LOCKED — room={self.room_name} "
            f"(present={len(self.attendance)}, visitors={len(self.visitors)}, "
            f"unknown={len(self.unknown_visitors)})"
        )
        self.unlocked_by = None
        self.unlocked_by_name = None
        self.unlocked_at = None
        self.schedule_id = None
        self.schedule_name = None
        self.schedule_end_time = None

    # ── Entry recording ───────────────────────────────

    def record_entry(
        self,
        user_id: Optional[str],
        name: str,
        role: Optional[str],
        status: str,
        photo_b64: Optional[str] = None,
    ) -> bool:
        """
        Route a detected face into the right list.
        Returns True if a new entry was recorded, False if deduplicated.
        """
        timestamp = sim_clock.now().isoformat()
        entry: dict = {
            "user_id": user_id,
            "name": name,
            "role": role or "unknown",
            "status": status,
            "timestamp": timestamp,
        }

        if status == "present":
            if user_id and any(e.get("user_id") == user_id for e in self.attendance):
                return False
            self.attendance.append(entry)

        elif status == "not_enrolled":
            if user_id and any(e.get("user_id") == user_id for e in self.visitors):
                return False
            self.visitors.append(entry)

        else:  # unknown
            # Deduplicate unknown faces: skip if the last unknown entry was < 30 s ago
            if self.unknown_visitors:
                try:
                    last_ts_str = self.unknown_visitors[-1].get("timestamp", "")
                    last_ts = datetime.fromisoformat(last_ts_str)
                    now = sim_clock.now()
                    # Normalise timezone awareness before subtraction
                    if last_ts.tzinfo and not now.tzinfo:
                        last_ts = last_ts.replace(tzinfo=None)
                    elif now.tzinfo and not last_ts.tzinfo:
                        now = now.replace(tzinfo=None)
                    if (now - last_ts).total_seconds() < 30:
                        return False
                except Exception:
                    pass
            entry["photo_b64"] = photo_b64
            self.unknown_visitors.append(entry)

        return True

    # ── Serialisation ─────────────────────────────────

    def to_dict(self) -> dict:
        auto_lock_at = None
        if not self.locked and self.schedule_end_time:
            end_h, end_m = map(int, self.schedule_end_time.split(":"))
            grace_h = end_h + (end_m + 30) // 60
            grace_m = (end_m + 30) % 60
            auto_lock_at = f"{grace_h:02d}:{grace_m:02d}"

        active_schedule = get_active_schedule(self.room_id)
        grace_schedule = get_schedule_in_grace_period(self.room_id) if not active_schedule else None

        active_payload = None
        if active_schedule:
            s0, s1 = get_today_schedule_window(active_schedule)
            active_payload = {
                "id": active_schedule.id,
                "name": active_schedule.name,
                "start_time": s0,
                "end_time": s1,
            }
        elif grace_schedule:
            s0, s1 = get_today_schedule_window(grace_schedule)
            active_payload = {
                "id": grace_schedule.id,
                "name": f"{grace_schedule.name} (grace period)",
                "start_time": s0,
                "end_time": s1,
            }

        return {
            "room_id": self.room_id,
            "room_name": self.room_name,
            "locked": self.locked,
            "scanning": not self.locked,
            "unlocked_by": self.unlocked_by,
            "unlocked_by_name": self.unlocked_by_name,
            "unlocked_at": self.unlocked_at.isoformat() if self.unlocked_at else None,
            "schedule_name": self.schedule_name,
            "schedule_end_time": self.schedule_end_time,
            "auto_lock_at": auto_lock_at,
            "active_schedule": active_payload,
            # Three distinct entry lists
            "attendance": self.attendance,
            "attendance_count": len(self.attendance),
            "visitors": self.visitors,
            "visitor_count": len(self.visitors),
            "unknown_visitors": self.unknown_visitors,
            "unknown_count": len(self.unknown_visitors),
        }


# ── Global door map ───────────────────────────────────

_doors: dict[str, DoorState] = {}
_doors_lock = threading.Lock()


def _get_or_create_door(room_id: str) -> DoorState:
    with _doors_lock:
        if room_id not in _doors:
            room = RoomRepository.get_by_id(room_id)
            if not room:
                raise HTTPException(status_code=404, detail=f"Room '{room_id}' not found")
            _doors[room_id] = DoorState(room_id, room.name)
        return _doors[room_id]


# ── Camera / face helpers ─────────────────────────────

def _get_cam_id_for_room(room_id: str) -> Optional[str]:
    """Resolve the pipeline camera ID for a given room."""
    from backend import dependencies
    pipeline = dependencies.vision_pipeline
    if pipeline is None:
        return None

    cameras = CameraRepository.get_all()
    room_cameras = [c for c in cameras if c.room_id == room_id]

    if not room_cameras:
        # Single-camera demo: use whatever is available
        if hasattr(pipeline, "_cameras") and len(pipeline._cameras) == 1:
            return pipeline._cameras[0].camera_id
        return None

    from backend.api.cameras import _rebuild_id_map, _id_map
    _rebuild_id_map()
    for cam in room_cameras:
        if cam.id in _id_map:
            pipeline_id = _id_map[cam.id]
            # Ensure the pipeline camera has actually pushed frames (is alive)
            if pipeline_id in pipeline._latest_frame_cache and pipeline._latest_frame_cache[pipeline_id] is not None:
                return pipeline_id

    # Fallback: if user's room camera is offline, fallback to active webcam
    if "cam_webcam" in pipeline._latest_frame_cache:
        return "cam_webcam"

    # Deep fallback to first pipeline camera
    if hasattr(pipeline, "_cameras") and pipeline._cameras:
        return pipeline._cameras[0].camera_id
    return None


def _get_latest_identity(room_id: str) -> Optional[dict]:
    """Return the first recognised identity from the camera for this room."""
    from backend import dependencies
    pipeline = dependencies.vision_pipeline
    if pipeline is None:
        return None

    cam_id = _get_cam_id_for_room(room_id)
    if not cam_id:
        return None

    for ann in pipeline._latest_annotations.get(cam_id, []):
        identity = ann.get("identity")
        if identity:
            return identity

    return {"user_id": None, "name": "Unknown", "role": "unknown", "status": "unknown"}


def _get_all_current_faces(room_id: str) -> list[dict]:
    """Return all detected (non-pending) faces from the camera for this room."""
    from backend import dependencies
    pipeline = dependencies.vision_pipeline
    if pipeline is None:
        return []

    cam_id = _get_cam_id_for_room(room_id)
    if not cam_id:
        return []

    results = []
    for ann in pipeline._latest_annotations.get(cam_id, []):
        identity = ann.get("identity")
        if identity and identity.get("status") not in (None, "pending"):
            results.append({
                **identity,
                "bbox": ann.get("bbox"),
                "cam_id": cam_id,
            })
    return results


def _capture_face_crop_b64(cam_id: str, bbox) -> Optional[str]:
    """Crop the face region from the latest frame and encode as base64 JPEG."""
    from backend import dependencies
    pipeline = dependencies.vision_pipeline
    if pipeline is None or not bbox:
        return None
    try:
        cached = pipeline._latest_frame_cache.get(cam_id)
        if cached is None or cached.frame is None:
            return None
        frame = cached.frame
        x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])
        pad = 20
        h, w = frame.shape[:2]
        x1, y1 = max(0, x1 - pad), max(0, y1 - pad)
        x2, y2 = min(w, x2 + pad), min(h, y2 + pad)
        if x2 <= x1 or y2 <= y1:
            return None
        crop = frame[y1:y2, x1:x2]
        _, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 75])
        return base64.b64encode(buf.tobytes()).decode("utf-8")
    except Exception as e:
        logger.error(f"Face crop error: {e}")
        return None


# ── Continuous scan thread ────────────────────────────

def _continuous_scan(room_id: str, door: DoorState, stop_event: threading.Event):
    """
    Runs while the door is unlocked.
    Every 2.5 s it reads all detected faces from the camera and routes each into
    the correct entry list (attendance / visitors / unknown_visitors).
    Unknown faces also get a base64 JPEG face crop attached.
    Newly detected enrolled faces also fire an access_granted Firestore event
    so they appear in the schedule attendance report.
    """
    from backend.db.repositories import EventRepository, flush_events
    from backend.db.schemas import EventCreate, EventType, EventSeverity

    logger.info(f"[{room_id}] Continuous scan started")
    while not stop_event.is_set() and not door.locked:
        try:
            faces = _get_all_current_faces(room_id)
            schedule = get_active_schedule(room_id) or get_schedule_in_grace_period(room_id)

            if schedule:
                cam_id = _get_cam_id_for_room(room_id)
                for face in faces:
                    user_id = face.get("user_id")
                    name = face.get("name", "Unknown")
                    role = face.get("role")
                    status = get_attendance_status(user_id, role, schedule)

                    photo_b64: Optional[str] = None
                    if status == "unknown":
                        bbox = face.get("bbox")
                        face_cam = face.get("cam_id")
                        if face_cam and bbox is not None:
                            photo_b64 = _capture_face_crop_b64(face_cam, bbox)

                    with _doors_lock:
                        is_new = door.record_entry(user_id, name, role, status, photo_b64)

                    # Write an access_granted event for every newly recorded enrolled
                    # attendee so they appear in the schedule attendance report.
                    if is_new and status == "present" and user_id:
                        try:
                            EventRepository.create(EventCreate(
                                type=EventType.ACCESS_GRANTED,
                                camera_id=cam_id or "",
                                user_id=user_id,
                                severity=EventSeverity.INFO,
                                details={
                                    "name": name,
                                    "role": role or "unknown",
                                    "reason": "door_scan",
                                    "schedule_id": schedule.id,
                                    "schedule_name": schedule.name,
                                },
                            ))
                            flush_events()
                        except Exception as ev_err:
                            logger.error(f"[{room_id}] Failed to log entry event: {ev_err}")

        except Exception as e:
            logger.error(f"[{room_id}] Scan error: {e}")

        stop_event.wait(timeout=2.5)

    logger.info(f"[{room_id}] Continuous scan stopped")


# ── Auto-lock background thread ───────────────────────

_autolock_running = False
_autolock_thread: Optional[threading.Thread] = None


def _autolock_loop():
    global _autolock_running
    while _autolock_running:
        try:
            with _doors_lock:
                for door in _doors.values():
                    if door.locked:
                        continue
                    active = get_active_schedule(door.room_id)
                    grace = get_schedule_in_grace_period(door.room_id)
                    if not active and not grace:
                        door.lock()
        except Exception as e:
            logger.error(f"Auto-lock error: {e}")
        _time.sleep(15)


def start_autolock():
    global _autolock_running, _autolock_thread
    if _autolock_running:
        return
    _autolock_running = True
    _autolock_thread = threading.Thread(target=_autolock_loop, daemon=True)
    _autolock_thread.start()
    logger.info("Door auto-lock thread started")


def stop_autolock():
    global _autolock_running
    _autolock_running = False


# ── API Endpoints ─────────────────────────────────────

@router.get("/")
def list_doors():
    """Get status of all doors (creates states for all rooms on first call)."""
    rooms = RoomRepository.get_all()
    for room in rooms:
        _get_or_create_door(room.id)
    with _doors_lock:
        return [door.to_dict() for door in _doors.values()]


@router.get("/hardware/state")
def hardware_lock_state():
    """
    Lightweight lock state for Pico / servo hardware.
    Returns a single JSON payload so the Pico only needs one HTTP call.
    """
    emergency_lock = False
    try:
        from backend.db.repositories import SystemStateRepository
        emergency_lock = bool(SystemStateRepository.get().emergency_lock)
    except Exception as e:
        logger.warning(f"Hardware state: could not read emergency status ({e})")

    unlocked_rooms: list[str] = []
    with _doors_lock:
        for door in _doors.values():
            if not door.locked:
                unlocked_rooms.append(door.room_name or door.room_id)

    unlocked = (not emergency_lock) and len(unlocked_rooms) > 0
    return {
        "unlocked": unlocked,
        "emergency_lock": emergency_lock,
        "unlocked_rooms": unlocked_rooms,
    }


@router.get("/{room_id}/status")
def get_door_status(room_id: str):
    """Get full status of a specific door, including all entry lists."""
    door = _get_or_create_door(room_id)
    return door.to_dict()


class KnockResponse(BaseModel):
    granted: bool
    message: str
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    reason: str = ""


@router.post("/{room_id}/knock")
def knock_door(room_id: str):
    door = _get_or_create_door(room_id)

    if not door.locked:
        return KnockResponse(
            granted=True,
            message=f"Door already unlocked by {door.unlocked_by_name}. Auto-scan is active.",
            user_id=door.unlocked_by,
            user_name=door.unlocked_by_name,
            reason="already_unlocked",
        )

    from backend.db.repositories import EventRepository, flush_events
    from backend.db.schemas import EventCreate, EventType, EventSeverity
    cam_id = _get_cam_id_for_room(room_id)

    def _log_knock(type_: EventType, sev: EventSeverity, reason: str, uid=None, uname="Unknown", r="unknown", iden=None):
        iden = iden or {}
        try:
            EventRepository.create(EventCreate(
                type=type_,
                camera_id=cam_id or "",  # allow empty cam_id — don't silently skip event
                user_id=uid,
                severity=sev,
                details={
                    "name": uname,
                    "role": r,
                    "confidence": iden.get("confidence", 0),
                    "liveness": iden.get("liveness_score", 0),
                    "reason": reason,
                }
            ))
            flush_events()
        except:
            pass

    schedule = get_active_schedule(room_id)
    grace_schedule = get_schedule_in_grace_period(room_id) if not schedule else None
    active = schedule or grace_schedule

    if not active:
        _log_knock(EventType.ACCESS_DENIED, EventSeverity.WARNING, "No active schedule for this room")
        return KnockResponse(
            granted=False,
            message="No active schedule for this room right now. Door stays locked.",
            reason="no_schedule",
        )

    identity = _get_latest_identity(room_id)

    if not identity or identity.get("user_id") is None:
        _log_knock(EventType.UNKNOWN_FACE, EventSeverity.WARNING, "No recognised face at the door", iden=identity)
        return KnockResponse(
            granted=False,
            message="No recognised face at the door. Please face the camera and try again.",
            reason="no_face",
        )

    user_id = identity["user_id"]
    user_name = identity.get("name", "Unknown")
    user_role = identity.get("role", "unknown")

    if is_user_authorized_to_unlock(user_id, user_role, active):
        door.unlock(user_id, user_name, active)
        _log_knock(EventType.ACCESS_GRANTED, EventSeverity.INFO, "authorized_manual_knock", user_id, user_name, user_role, identity)
        
        return KnockResponse(
            granted=True,
            message=(
                f"Access granted! Welcome, {user_name}. "
                f"Door unlocked for '{active.name}'. "
                f"All entrants are now being logged automatically."
            ),
            user_id=user_id,
            user_name=user_name,
            reason="authorized",
        )
    else:
        _log_knock(EventType.ACCESS_DENIED, EventSeverity.WARNING, "not_authorized", user_id, user_name, user_role, identity)
        return KnockResponse(
            granted=False,
            message=f"{user_name} is not authorised to unlock this door.",
            user_id=user_id,
            user_name=user_name,
            reason="not_authorized",
        )

@router.post("/{room_id}/scan")
def manual_scan(room_id: str):
    """
    Trigger an immediate manual scan of all faces at the door.
    Only available while the door is unlocked (auto-scan also runs in the background).
    """
    door = _get_or_create_door(room_id)

    if door.locked:
        raise HTTPException(status_code=403, detail="Door is locked. Unlock it first.")

    schedule = get_active_schedule(room_id) or get_schedule_in_grace_period(room_id)
    if not schedule:
        raise HTTPException(status_code=400, detail="No active schedule.")

    faces = _get_all_current_faces(room_id)
    logged: list[dict] = []

    for face in faces:
        user_id = face.get("user_id")
        name = face.get("name", "Unknown")
        role = face.get("role")
        status = get_attendance_status(user_id, role, schedule)

        photo_b64: Optional[str] = None
        if status == "unknown":
            cam_id = face.get("cam_id")
            bbox = face.get("bbox")
            if cam_id and bbox is not None:
                photo_b64 = _capture_face_crop_b64(cam_id, bbox)

        with _doors_lock:
            new = door.record_entry(user_id, name, role, status, photo_b64)

        logged.append({"name": name, "status": status, "recorded": new})

    return {"scanned": len(logged), "entries": logged}


@router.put("/{room_id}/lock")
def lock_door(room_id: str):
    """Manually lock a door."""
    door = _get_or_create_door(room_id)
    with _doors_lock:
        door.lock()
    return {"status": "locked", "room_id": room_id}


@router.put("/{room_id}/unlock")
def unlock_door_manually(room_id: str):
    """Manually unlock a door (admin override — bypasses face check)."""
    door = _get_or_create_door(room_id)
    schedule = get_active_schedule(room_id) or get_schedule_in_grace_period(room_id)
    if not schedule:
        raise HTTPException(status_code=400, detail="No active schedule to unlock for.")
    with _doors_lock:
        door.unlock("admin", "Manual Override", schedule)
    return {"status": "unlocked", "room_id": room_id}


@router.put("/{room_id}/debug_unlock")
def debug_unlock_door(room_id: str, locked: bool):
    """Debug unlock a door bypassing all schedules."""
    door = _get_or_create_door(room_id)
    with _doors_lock:
        door.locked = locked
    return {"status": "ok", "locked": door.locked}
