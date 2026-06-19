"""
LabSecure AI v2 — Schedule Management API
CRUD endpoints for weekly lab access schedules.
"""

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException

from backend.db.schemas import ScheduleModel, ScheduleCreate, ScheduleUpdate, EventCreate, EventType, EventSeverity, PermissionCreate
from backend.db.repositories import ScheduleRepository, EventRepository, UserRepository, PermissionRepository
from backend.utils.sim_clock import sim_clock

router = APIRouter(prefix="/api/schedules", tags=["Schedules"])


@router.get("/", response_model=list[ScheduleModel])
def list_schedules(active_only: bool = False):
    """List all schedules."""
    return ScheduleRepository.get_all(active_only=active_only)


@router.get("/{schedule_id}", response_model=ScheduleModel)
def get_schedule(schedule_id: str):
    """Get a single schedule by ID."""
    schedule = ScheduleRepository.get_by_id(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return schedule


@router.post("/", response_model=ScheduleModel, status_code=201)
def create_schedule(data: ScheduleCreate):
    """Create a new weekly schedule."""
    schedule = ScheduleRepository.create(data)

    # Auto-create a permission for the assigned teacher (if any)
    if data.teacher_id:
        _ensure_teacher_permission(data.teacher_id, schedule.id)

    EventRepository.create(EventCreate(
        type=EventType.SCHEDULE_CREATED,
        details={
            "name": data.name,
            "days": data.days,
            "start_time": data.start_time,
            "end_time": data.end_time,
        },
        severity=EventSeverity.INFO,
    ))

    return schedule


@router.put("/{schedule_id}", response_model=ScheduleModel)
def update_schedule(schedule_id: str, data: ScheduleUpdate):
    """Update schedule fields."""
    schedule = ScheduleRepository.update(schedule_id, data)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    # Auto-create a permission for the assigned teacher (if any)
    if data.teacher_id:
        _ensure_teacher_permission(data.teacher_id, schedule_id)

    EventRepository.create(EventCreate(
        type=EventType.SCHEDULE_UPDATED,
        details={
            "schedule_id": schedule_id,
            "name": data.name or schedule.name,
        },
        severity=EventSeverity.INFO,
    ))

    return schedule


def _ensure_teacher_permission(teacher_id: str, schedule_id: str):
    """
    Create a can_unlock permission for a teacher on a specific schedule
    if one does not already exist.
    """
    existing = PermissionRepository.find_for_user_and_schedule(teacher_id, schedule_id)
    if existing:
        return  # Already has a permission covering this schedule
    PermissionRepository.create(PermissionCreate(
        user_id=teacher_id,
        schedule_ids=[schedule_id],
        can_unlock=True,
        can_access_outside_schedule=False,
        granted_by="system (assigned teacher)",
    ))


@router.delete("/{schedule_id}")
def delete_schedule(schedule_id: str):
    """Delete a schedule."""
    schedule = ScheduleRepository.get_by_id(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if not ScheduleRepository.delete(schedule_id):
        raise HTTPException(status_code=404, detail="Schedule not found")

    EventRepository.create(EventCreate(
        type=EventType.SCHEDULE_DELETED,
        details={"schedule_id": schedule_id, "name": schedule.name},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "deleted", "schedule_id": schedule_id}


@router.get("/{schedule_id}/attendance/sessions")
def get_attendance_sessions(schedule_id: str):
    """
    Return all past dates (up to 90 days) when this schedule was active,
    with the number of students that attended each session.
    """
    schedule = ScheduleRepository.get_by_id(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    today = sim_clock.now().date()
    start_date = today - timedelta(days=90)

    # Fetch all access_granted events in the 90-day window in one query
    from_ts = datetime(start_date.year, start_date.month, start_date.day, 0, 0, 0, tzinfo=timezone.utc)
    to_ts = sim_clock.now()

    if to_ts.tzinfo is None:
        to_ts = to_ts.replace(tzinfo=timezone.utc)

    # Fetch raw events and filter in-memory to avoid Firestore composite index requirement
    raw_events = EventRepository.query(limit=5000)
    events = []
    for event in raw_events:
        if event.type != "access_granted":
            continue
        ts = event.timestamp
        if not ts:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if from_ts <= ts <= to_ts:
            events.append(event)

    start_h, start_m = map(int, schedule.start_time.split(':'))
    end_h, end_m = map(int, schedule.end_time.split(':'))
    start_minutes = start_h * 60 + start_m
    end_minutes = end_h * 60 + end_m

    # Group distinct user_ids per matching date
    attendance_by_date: dict[str, set] = {}
    for event in events:
        if not event.timestamp:
            continue
        ts = event.timestamp
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        day_name = ts.strftime('%A').lower()
        if day_name not in schedule.days:
            continue

        event_minutes = ts.hour * 60 + ts.minute
        if not (start_minutes <= event_minutes < end_minutes):
            continue

        date_str = ts.date().isoformat()
        if date_str not in attendance_by_date:
            attendance_by_date[date_str] = set()
        if event.user_id:
            attendance_by_date[date_str].add(event.user_id)

    # Build list of every scheduled day in the window (newest first)
    result = []
    current = today
    while current >= start_date:
        day_name = current.strftime('%A').lower()
        if day_name in schedule.days:
            date_str = current.isoformat()
            result.append({
                "date": date_str,
                "day": day_name,
                "count": len(attendance_by_date.get(date_str, set())),
            })
        current -= timedelta(days=1)

    return result


@router.get("/{schedule_id}/attendance")
def get_attendance(schedule_id: str, date: Optional[str] = None):
    """
    Return attendance for a schedule on a given date (YYYY-MM-DD).
    Returns two lists: present (with entry timestamp) and absent (enrolled but no entry).
    """
    schedule = ScheduleRepository.get_by_id(schedule_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if date is None:
        date = sim_clock.now().date().isoformat()

    try:
        target_date = datetime.strptime(date, '%Y-%m-%d').date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    start_h, start_m = map(int, schedule.start_time.split(':'))
    end_h, end_m = map(int, schedule.end_time.split(':'))

    from_ts = datetime(target_date.year, target_date.month, target_date.day,
                       start_h, start_m, 0, tzinfo=timezone.utc)
    to_ts = datetime(target_date.year, target_date.month, target_date.day,
                     end_h, end_m, 0, tzinfo=timezone.utc)

    # Fetch raw recent events and filter in memory to avoid Firestore 
    # requiring a manual Composite Index for Time + Type combinations.
    raw_events = EventRepository.query(limit=2000)
    events = []
    for e in raw_events:
        if e.type != "access_granted":
            continue
        # Ensure timestamp is UTC for accurate bounds checking
        ts = e.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
            
        if ts and from_ts <= ts <= to_ts:
            events.append(e)

    all_users = UserRepository.get_all()
    user_map = {u.id: u for u in all_users if u.id}

    enrolled_ids = set(schedule.user_overrides or [])
    if schedule.teacher_id:
        enrolled_ids.add(schedule.teacher_id)

    for u in all_users:
        if u.id and u.role:
            r_str = u.role.value if hasattr(u.role, "value") else str(u.role)
            if r_str.lower() in [r.lower() for r in schedule.roles]:
                enrolled_ids.add(u.id)

    # Events come back newest-first; reverse to get oldest-first so we keep the earliest entry
    seen: dict[str, dict] = {}
    for event in reversed(events):
        uid = event.user_id
        if not uid or uid in seen:
            continue
        user = user_map.get(uid)
        ts = event.timestamp
        if ts and ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        seen[uid] = {
            "user_id": uid,
            "name": user.name if user else (
                (event.details or {}).get("name", "Unknown")
            ),
            "student_id": user.student_id if user else None,
            "role": (user.role.value if hasattr(user.role, 'value') else str(user.role)) if (user and user.role) else None,
            "timestamp": ts.replace(tzinfo=None).isoformat() if ts else None,
        }

    # Enrolled students who were absent
    absent = []
    for uid in enrolled_ids:
        if uid not in seen:
            user = user_map.get(uid)
            if user:
                absent.append({
                    "user_id": uid,
                    "name": user.name,
                    "student_id": user.student_id,
                    "role": str(user.role),
                    "timestamp": None,
                })

    return {
        "date": date,
        "schedule_id": schedule_id,
        "schedule_name": schedule.name,
        "present": list(seen.values()),
        "absent": absent,
    }
