"""
LabSecure AI v2 — Data Access Repositories
Async-compatible Firestore CRUD operations for all entities.
Includes in-memory TTL caching to reduce Firestore read quota usage.
"""

import time
import queue
import logging
import threading
from datetime import datetime, timezone
from typing import Optional

from google.cloud.firestore_v1 import FieldFilter

from backend.db.firebase_client import get_firestore
from backend.db.cache import get_cache, CACHE_TTL
from backend.db.schemas import (
    UserModel, UserCreate, UserUpdate,
    ScheduleModel, ScheduleCreate, ScheduleUpdate,
    PermissionModel, PermissionCreate, PermissionUpdate,
    GuestModel, GuestCreate,
    EventModel, EventCreate,
    SystemState,
    CameraModel, CameraCreate,
    RoomModel, RoomCreate, RoomUpdate,
    AdminModel, AdminCreate,
)

logger = logging.getLogger(__name__)


from backend.utils.sim_clock import sim_clock

def _now() -> datetime:
    return sim_clock.now()


# ── User Repository ───────────────────────────────────

class UserRepository:
    COLLECTION = "users"
    _CACHE_PREFIX = "users"

    @staticmethod
    def get_all(active_only: bool = False) -> list[UserModel]:
        cache = get_cache()
        cache_key = f"{UserRepository._CACHE_PREFIX}:all:{active_only}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        ref = db.collection(UserRepository.COLLECTION)
        if active_only:
            ref = ref.where(filter=FieldFilter("active", "==", True))
        docs = ref.stream()
        result = [UserModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["users"])
        return result

    @staticmethod
    def get_by_id(user_id: str) -> Optional[UserModel]:
        cache = get_cache()
        cache_key = f"{UserRepository._CACHE_PREFIX}:id:{user_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(UserRepository.COLLECTION).document(user_id).get()
        if doc.exists:
            result = UserModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["users"])
            return result
        return None

    @staticmethod
    def create(data: UserCreate) -> UserModel:
        db = get_firestore()
        now = _now()
        user = UserModel(
            name=data.name,
            student_id=data.student_id,
            role=data.role,
            active=data.active,
            created_at=now,
            updated_at=now,
        )
        doc_ref = db.collection(UserRepository.COLLECTION).document()
        doc_ref.set(user.to_firestore())
        user.id = doc_ref.id
        get_cache().invalidate_prefix(UserRepository._CACHE_PREFIX)
        return user

    @staticmethod
    def update(user_id: str, data: UserUpdate) -> Optional[UserModel]:
        db = get_firestore()
        doc_ref = db.collection(UserRepository.COLLECTION).document(user_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        updates = data.model_dump(exclude_none=True)
        if "role" in updates:
            updates["role"] = updates["role"].value
        updates["updated_at"] = _now()
        doc_ref.update(updates)
        get_cache().invalidate_prefix(UserRepository._CACHE_PREFIX)
        return UserRepository.get_by_id(user_id)

    @staticmethod
    def delete(user_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(UserRepository.COLLECTION).document(user_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.delete()
        get_cache().invalidate_prefix(UserRepository._CACHE_PREFIX)
        return True

    @staticmethod
    def update_face_ref(user_id: str, ref_path: str):
        db = get_firestore()
        db.collection(UserRepository.COLLECTION).document(user_id).update({
            "face_encoding_ref": ref_path,
            "updated_at": _now(),
        })
        get_cache().invalidate_prefix(UserRepository._CACHE_PREFIX)

    @staticmethod
    def update_face_data(user_id: str, descriptor: list[float], photo_ref: str):
        db = get_firestore()
        db.collection(UserRepository.COLLECTION).document(user_id).update({
            "face_descriptor": descriptor,
            "face_encoding_ref": photo_ref,
            "updated_at": _now(),
        })
        get_cache().invalidate_prefix(UserRepository._CACHE_PREFIX)

    @staticmethod
    def get_all_descriptors() -> list[dict]:
        """Return user id, name, and face descriptor for all enrolled users."""
        cache = get_cache()
        cache_key = f"{UserRepository._CACHE_PREFIX}:descriptors"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(UserRepository.COLLECTION).stream()
        result = []
        for doc in docs:
            data = doc.to_dict()
            if data.get("face_descriptor"):
                result.append({
                    "user_id": doc.id,
                    "name": data.get("name", "Unknown"),
                    "role": data.get("role", ""),
                    "descriptor": data["face_descriptor"],
                })
        cache.set(cache_key, result, CACHE_TTL["users"])
        return result


# ── Schedule Repository ───────────────────────────────

class ScheduleRepository:
    COLLECTION = "schedules"
    _CACHE_PREFIX = "schedules"

    @staticmethod
    def get_all(active_only: bool = False) -> list[ScheduleModel]:
        cache = get_cache()
        cache_key = f"{ScheduleRepository._CACHE_PREFIX}:all:{active_only}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        ref = db.collection(ScheduleRepository.COLLECTION)
        if active_only:
            ref = ref.where(filter=FieldFilter("active", "==", True))
        docs = ref.stream()
        results = []
        for doc in docs:
            try:
                results.append(ScheduleModel(id=doc.id, **doc.to_dict()))
            except Exception:
                # Skip corrupted documents
                pass
        cache.set(cache_key, results, CACHE_TTL["schedules"])
        return results

    @staticmethod
    def get_by_id(schedule_id: str) -> Optional[ScheduleModel]:
        cache = get_cache()
        cache_key = f"{ScheduleRepository._CACHE_PREFIX}:id:{schedule_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(ScheduleRepository.COLLECTION).document(schedule_id).get()
        if doc.exists:
            result = ScheduleModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["schedules"])
            return result
        return None

    @staticmethod
    def create(data: ScheduleCreate) -> ScheduleModel:
        db = get_firestore()
        schedule = ScheduleModel(
            name=data.name,
            days=data.days,
            start_time=data.start_time,
            end_time=data.end_time,
            roles=[r.value if hasattr(r, "value") else r for r in data.roles],
            user_overrides=data.user_overrides,
            room_id=data.room_id,
            teacher_id=data.teacher_id,
            active=data.active,
        )
        doc_ref = db.collection(ScheduleRepository.COLLECTION).document()
        doc_ref.set(schedule.to_firestore())
        schedule.id = doc_ref.id
        get_cache().invalidate_prefix(ScheduleRepository._CACHE_PREFIX)
        return schedule

    @staticmethod
    def update(schedule_id: str, data: ScheduleUpdate) -> Optional[ScheduleModel]:
        db = get_firestore()
        doc_ref = db.collection(ScheduleRepository.COLLECTION).document(schedule_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        updates = data.model_dump(exclude_none=True)
        if "roles" in updates:
            updates["roles"] = [r.value if hasattr(r, "value") else r for r in updates["roles"]]
        doc_ref.update(updates)
        get_cache().invalidate_prefix(ScheduleRepository._CACHE_PREFIX)
        return ScheduleRepository.get_by_id(schedule_id)

    @staticmethod
    def delete(schedule_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(ScheduleRepository.COLLECTION).document(schedule_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.delete()
        get_cache().invalidate_prefix(ScheduleRepository._CACHE_PREFIX)
        return True


# ── Permission Repository ─────────────────────────────

class PermissionRepository:
    COLLECTION = "permissions"
    _CACHE_PREFIX = "permissions"

    @staticmethod
    def get_all() -> list[PermissionModel]:
        cache = get_cache()
        cache_key = f"{PermissionRepository._CACHE_PREFIX}:all"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(PermissionRepository.COLLECTION).stream()
        result = [PermissionModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["permissions"])
        return result

    @staticmethod
    def get_by_id(perm_id: str) -> Optional[PermissionModel]:
        cache = get_cache()
        cache_key = f"{PermissionRepository._CACHE_PREFIX}:id:{perm_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(PermissionRepository.COLLECTION).document(perm_id).get()
        if doc.exists:
            result = PermissionModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["permissions"])
            return result
        return None

    @staticmethod
    def get_for_user(user_id: str) -> list[PermissionModel]:
        cache = get_cache()
        cache_key = f"{PermissionRepository._CACHE_PREFIX}:user:{user_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(PermissionRepository.COLLECTION).where(
            filter=FieldFilter("user_id", "==", user_id)
        ).stream()
        result = [PermissionModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["permissions"])
        return result

    @staticmethod
    def get_for_role(role: str) -> list[PermissionModel]:
        cache = get_cache()
        cache_key = f"{PermissionRepository._CACHE_PREFIX}:role:{role}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(PermissionRepository.COLLECTION).where(
            filter=FieldFilter("role", "==", role)
        ).stream()
        result = [PermissionModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["permissions"])
        return result

    @staticmethod
    def create(data: PermissionCreate) -> PermissionModel:
        db = get_firestore()
        perm = PermissionModel(
            user_id=data.user_id,
            role=data.role.value if data.role else None,
            schedule_ids=data.schedule_ids,
            can_unlock=data.can_unlock,
            can_access_outside_schedule=data.can_access_outside_schedule,
            granted_by=data.granted_by,
            created_at=_now(),
        )
        doc_ref = db.collection(PermissionRepository.COLLECTION).document()
        doc_ref.set(perm.to_firestore())
        perm.id = doc_ref.id
        get_cache().invalidate_prefix(PermissionRepository._CACHE_PREFIX)
        return perm

    @staticmethod
    def find_for_user_and_schedule(user_id: str, schedule_id: str) -> Optional[PermissionModel]:
        """Return the first permission that matches a specific user AND covers a specific schedule."""
        for perm in PermissionRepository.get_all():
            if perm.user_id != user_id:
                continue
            if not perm.schedule_ids or schedule_id in perm.schedule_ids:
                return perm
        return None

    @staticmethod
    def update(perm_id: str, data: PermissionUpdate) -> Optional[PermissionModel]:
        db = get_firestore()
        doc_ref = db.collection(PermissionRepository.COLLECTION).document(perm_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        updates = data.model_dump(exclude_none=True)
        doc_ref.update(updates)
        get_cache().invalidate_prefix(PermissionRepository._CACHE_PREFIX)
        return PermissionRepository.get_by_id(perm_id)

    @staticmethod
    def delete(perm_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(PermissionRepository.COLLECTION).document(perm_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.delete()
        get_cache().invalidate_prefix(PermissionRepository._CACHE_PREFIX)
        return True


# ── Guest Repository ──────────────────────────────────

class GuestRepository:
    COLLECTION = "guests"
    _CACHE_PREFIX = "guests"

    @staticmethod
    def get_all(include_expired: bool = False) -> list[GuestModel]:
        cache = get_cache()
        cache_key = f"{GuestRepository._CACHE_PREFIX}:all:{include_expired}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        ref = db.collection(GuestRepository.COLLECTION)
        if not include_expired:
            ref = ref.where(filter=FieldFilter("revoked", "==", False))
        docs = ref.stream()
        guests = [GuestModel(id=doc.id, **doc.to_dict()) for doc in docs]
        if not include_expired:
            now = _now()
            guests = [g for g in guests if g.valid_until and g.valid_until > now]
        cache.set(cache_key, guests, CACHE_TTL["guests"])
        return guests

    @staticmethod
    def get_by_id(guest_id: str) -> Optional[GuestModel]:
        cache = get_cache()
        cache_key = f"{GuestRepository._CACHE_PREFIX}:id:{guest_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(GuestRepository.COLLECTION).document(guest_id).get()
        if doc.exists:
            result = GuestModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["guests"])
            return result
        return None

    @staticmethod
    def create(data: GuestCreate) -> GuestModel:
        db = get_firestore()
        guest = GuestModel(
            name=data.name,
            purpose=data.purpose,
            sponsor_id=data.sponsor_id,
            valid_from=data.valid_from,
            valid_until=data.valid_until,
            revoked=False,
        )
        doc_ref = db.collection(GuestRepository.COLLECTION).document()
        doc_ref.set(guest.to_firestore())
        guest.id = doc_ref.id
        get_cache().invalidate_prefix(GuestRepository._CACHE_PREFIX)
        return guest

    @staticmethod
    def revoke(guest_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(GuestRepository.COLLECTION).document(guest_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.update({"revoked": True})
        get_cache().invalidate_prefix(GuestRepository._CACHE_PREFIX)
        return True

    @staticmethod
    def update_face_ref(guest_id: str, ref_path: str):
        db = get_firestore()
        db.collection(GuestRepository.COLLECTION).document(guest_id).update({
            "face_encoding_ref": ref_path,
        })
        get_cache().invalidate_prefix(GuestRepository._CACHE_PREFIX)

    @staticmethod
    def update_face_data(guest_id: str, descriptor: list[float], ref_path: str):
        db = get_firestore()
        # Compress descriptor array to a comma-separated string to save Space/bandwidth
        desc_str = ",".join(f"{x:.4f}" for x in descriptor)
        db.collection(GuestRepository.COLLECTION).document(guest_id).update({
            "face_encoding_ref": ref_path,
            "face_descriptor": desc_str,
        })
        get_cache().invalidate_prefix(GuestRepository._CACHE_PREFIX)


# ── Event Repository ──────────────────────────────────

class _EventWriter:
    """
    Background event writer that batches Firestore writes.
    Events are queued in-memory and flushed every 5 seconds or
    when the queue reaches 20 events, whichever comes first.
    """

    def __init__(self):
        self._queue: queue.Queue[EventModel] = queue.Queue()
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._flush_loop, daemon=True)
        self._thread.start()
        logger.info("Event batch writer started")

    def stop(self):
        self._running = False
        self._flush()  # Final flush
        if self._thread:
            self._thread.join(timeout=5)

    def enqueue(self, event: EventModel):
        """Add an event to the write queue."""
        self._queue.put(event)
        # Flush immediately if queue is large enough
        if self._queue.qsize() >= 20:
            self._flush()

    def _flush_loop(self):
        while self._running:
            time.sleep(5)
            self._flush()

    def _flush(self):
        """Write all queued events to Firestore in a batch."""
        events: list[EventModel] = []
        while not self._queue.empty():
            try:
                events.append(self._queue.get_nowait())
            except queue.Empty:
                break

        if not events:
            return

        try:
            db = get_firestore()
            batch = db.batch()
            count = 0
            for event in events:
                doc_ref = db.collection(EventRepository.COLLECTION).document()
                batch.set(doc_ref, event.to_firestore())
                event.id = doc_ref.id
                count += 1
                # Firestore batch limit is 500
                if count % 450 == 0:
                    batch.commit()
                    batch = db.batch()
            if count % 450 != 0:
                batch.commit()

            # Invalidate event query cache after writes
            get_cache().invalidate_prefix("events")

            logger.debug(f"Flushed {count} events to Firestore")
        except Exception as e:
            logger.error(f"Failed to flush events: {e}")


# Singleton event writer
_event_writer = _EventWriter()


def start_event_writer():
    """Start the background event writer. Called from app startup."""
    _event_writer.start()


def stop_event_writer():
    """Stop the background event writer. Called from app shutdown."""
    _event_writer.stop()


def flush_events():
    """Force flush queued events to Firestore immediately."""
    _event_writer._flush()


class EventRepository:
    COLLECTION = "events"
    _CACHE_PREFIX = "events"

    @staticmethod
    def create(data: EventCreate) -> EventModel:
        event = EventModel(
            type=data.type.value,
            user_id=data.user_id,
            camera_id=data.camera_id,
            details=data.details,
            timestamp=_now(),
            severity=data.severity.value,
        )
        _event_writer.enqueue(event)
        return event

    @staticmethod
    def query(
        event_type: Optional[str] = None,
        severity: Optional[str] = None,
        camera_id: Optional[str] = None,
        user_id: Optional[str] = None,
        from_time: Optional[datetime] = None,
        to_time: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[EventModel]:
        # Build a cache key from query parameters
        cache = get_cache()
        cache_key = f"{EventRepository._CACHE_PREFIX}:query:{event_type}:{severity}:{camera_id}:{user_id}:{from_time}:{to_time}:{limit}:{offset}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        ref = db.collection(EventRepository.COLLECTION).order_by("timestamp", direction="DESCENDING").limit(2000)
        docs = ref.stream()

        results = []
        for doc in docs:
            data_dict = doc.to_dict()

            if event_type and data_dict.get("type") != event_type:
                continue

            if severity and data_dict.get("severity") != severity:
                continue

            if camera_id and data_dict.get("camera_id") != camera_id:
                continue

            if user_id and data_dict.get("user_id") != user_id:
                continue

            ts = data_dict.get("timestamp")
            if ts:
                if ts.tzinfo is None and (from_time or to_time):
                    ts = ts.replace(tzinfo=timezone.utc)
                if from_time:
                    f_time = from_time if from_time.tzinfo is not None else from_time.replace(tzinfo=ts.tzinfo)
                    if ts < f_time:
                        continue
                if to_time:
                    t_time = to_time if to_time.tzinfo is not None else to_time.replace(tzinfo=ts.tzinfo)
                    if ts > t_time:
                        continue

            results.append(EventModel(id=doc.id, **data_dict))

        paginated_result = results[offset : offset + limit]
        cache.set(cache_key, paginated_result, CACHE_TTL["events_query"])
        return paginated_result

    @staticmethod
    def batch_create(events: list[EventCreate]) -> int:
        """Write multiple events via the batched writer."""
        count = 0
        for data in events:
            event = EventModel(
                type=data.type.value,
                user_id=data.user_id,
                camera_id=data.camera_id,
                details=data.details,
                timestamp=_now(),
                severity=data.severity.value,
            )
            _event_writer.enqueue(event)
            count += 1
        return count


# ── System State Repository ───────────────────────────

class SystemStateRepository:
    COLLECTION = "system_state"
    DOC_ID = "config"
    _CACHE_PREFIX = "system_state"

    @staticmethod
    def get() -> SystemState:
        cache = get_cache()
        cache_key = f"{SystemStateRepository._CACHE_PREFIX}:config"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(SystemStateRepository.COLLECTION).document(SystemStateRepository.DOC_ID).get()
        if doc.exists:
            result = SystemState(**doc.to_dict())
        else:
            result = SystemState()
        cache.set(cache_key, result, CACHE_TTL["system_state"])
        return result

    @staticmethod
    def set_emergency(activated: bool, activated_by: str = ""):
        db = get_firestore()
        data = {
            "emergency_lock": activated,
            "emergency_activated_by": activated_by if activated else None,
            "emergency_activated_at": _now() if activated else None,
        }
        db.collection(SystemStateRepository.COLLECTION).document(
            SystemStateRepository.DOC_ID
        ).set(data, merge=True)
        get_cache().invalidate_prefix(SystemStateRepository._CACHE_PREFIX)


# ── Camera Repository ─────────────────────────────────

class CameraRepository:
    COLLECTION = "cameras"
    _CACHE_PREFIX = "cameras"

    @staticmethod
    def get_all() -> list[CameraModel]:
        cache = get_cache()
        cache_key = f"{CameraRepository._CACHE_PREFIX}:all"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(CameraRepository.COLLECTION).stream()
        result = [CameraModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["cameras"])
        return result

    @staticmethod
    def create(data: CameraCreate) -> CameraModel:
        db = get_firestore()
        cam = CameraModel(
            name=data.name,
            type=data.type,
            enabled=data.enabled,
            ip=data.ip,
            room_id=data.room_id,
            created_at=_now(),
        )
        doc_ref = db.collection(CameraRepository.COLLECTION).document()
        doc_ref.set(cam.model_dump(exclude={"id"}, exclude_none=True))
        cam.id = doc_ref.id
        get_cache().invalidate_prefix(CameraRepository._CACHE_PREFIX)
        return cam

    @staticmethod
    def get_by_id(camera_id: str) -> Optional[CameraModel]:
        cache = get_cache()
        cache_key = f"{CameraRepository._CACHE_PREFIX}:id:{camera_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(CameraRepository.COLLECTION).document(camera_id).get()
        if doc.exists:
            result = CameraModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["cameras"])
            return result
        return None

    @staticmethod
    def update(camera_id: str, data: dict) -> Optional[CameraModel]:
        db = get_firestore()
        doc_ref = db.collection(CameraRepository.COLLECTION).document(camera_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        update_data = {k: v for k, v in data.items() if k not in ('id', 'created_at') and v is not None}
        if update_data:
            doc_ref.update(update_data)
        updated = doc_ref.get()
        get_cache().invalidate_prefix(CameraRepository._CACHE_PREFIX)
        return CameraModel(id=updated.id, **updated.to_dict())

    @staticmethod
    def delete(camera_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(CameraRepository.COLLECTION).document(camera_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.delete()
        get_cache().invalidate_prefix(CameraRepository._CACHE_PREFIX)
        return True


# ── Room Repository ───────────────────────────────────

class RoomRepository:
    COLLECTION = "rooms"
    _CACHE_PREFIX = "rooms"

    @staticmethod
    def get_all() -> list[RoomModel]:
        cache = get_cache()
        cache_key = f"{RoomRepository._CACHE_PREFIX}:all"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(RoomRepository.COLLECTION).stream()
        result = [RoomModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["rooms"])
        return result

    @staticmethod
    def get_by_id(room_id: str) -> Optional[RoomModel]:
        cache = get_cache()
        cache_key = f"{RoomRepository._CACHE_PREFIX}:id:{room_id}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        doc = db.collection(RoomRepository.COLLECTION).document(room_id).get()
        if doc.exists:
            result = RoomModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["rooms"])
            return result
        return None

    @staticmethod
    def create(data: RoomCreate) -> RoomModel:
        db = get_firestore()
        room = RoomModel(
            name=data.name,
            description=data.description,
            floor=data.floor,
            created_at=_now(),
        )
        doc_ref = db.collection(RoomRepository.COLLECTION).document()
        doc_ref.set(room.to_firestore())
        room.id = doc_ref.id
        get_cache().invalidate_prefix(RoomRepository._CACHE_PREFIX)
        return room

    @staticmethod
    def update(room_id: str, data: RoomUpdate) -> Optional[RoomModel]:
        db = get_firestore()
        doc_ref = db.collection(RoomRepository.COLLECTION).document(room_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        updates = data.model_dump(exclude_none=True)
        doc_ref.update(updates)
        get_cache().invalidate_prefix(RoomRepository._CACHE_PREFIX)
        return RoomRepository.get_by_id(room_id)

    @staticmethod
    def delete(room_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(RoomRepository.COLLECTION).document(room_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.delete()
        get_cache().invalidate_prefix(RoomRepository._CACHE_PREFIX)
        return True


# ── Admin Repository ──────────────────────────────────

class AdminRepository:
    COLLECTION = "admins"
    _CACHE_PREFIX = "admins"

    @staticmethod
    def hash_password(password: str) -> str:
        import bcrypt
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
        return hashed.decode('utf-8')

    @staticmethod
    def verify_password(plain_password: str, hashed_password: str) -> bool:
        import bcrypt
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

    @staticmethod
    def get_by_username(username: str) -> Optional[AdminModel]:
        cache = get_cache()
        cache_key = f"{AdminRepository._CACHE_PREFIX}:username:{username}"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(AdminRepository.COLLECTION).where(filter=FieldFilter("username", "==", username)).limit(1).stream()
        for doc in docs:
            result = AdminModel(id=doc.id, **doc.to_dict())
            cache.set(cache_key, result, CACHE_TTL["admins"])
            return result
        return None

    @staticmethod
    def get_all() -> list[AdminModel]:
        cache = get_cache()
        cache_key = f"{AdminRepository._CACHE_PREFIX}:all"
        cached = cache.get(cache_key)
        if cached is not None:
            return cached

        db = get_firestore()
        docs = db.collection(AdminRepository.COLLECTION).stream()
        result = [AdminModel(id=doc.id, **doc.to_dict()) for doc in docs]
        cache.set(cache_key, result, CACHE_TTL["admins"])
        return result

    @staticmethod
    def create(data: AdminCreate) -> AdminModel:
        db = get_firestore()
        admin = AdminModel(
            username=data.username,
            password_hash=AdminRepository.hash_password(data.password),
            role=data.role,
            created_at=_now()
        )
        doc_ref = db.collection(AdminRepository.COLLECTION).document()
        doc_ref.set(admin.to_firestore())
        admin.id = doc_ref.id
        get_cache().invalidate_prefix(AdminRepository._CACHE_PREFIX)
        return admin

    @staticmethod
    def delete(admin_id: str) -> bool:
        db = get_firestore()
        doc_ref = db.collection(AdminRepository.COLLECTION).document(admin_id)
        doc = doc_ref.get()
        if not doc.exists:
            return False
        doc_ref.delete()
        get_cache().invalidate_prefix(AdminRepository._CACHE_PREFIX)
        return True
