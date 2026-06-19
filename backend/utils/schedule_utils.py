"""
LabSecure AI v2 — Schedule Utilities
Helpers to find the active schedule for a room and check user authorization.
Uses the simulation clock for all time comparisons.
"""

import logging
from datetime import datetime
from typing import Optional

from backend.db.repositories import ScheduleRepository, UserRepository
from backend.db.schemas import ScheduleModel
from backend.utils.sim_clock import sim_clock

logger = logging.getLogger(__name__)


def get_active_schedule(room_id: str) -> Optional[ScheduleModel]:
    """
    Find the currently active schedule for a given room.
    A schedule is active if:
      - It is marked active
      - It has this room_id
      - Today's day is in its days list
      - Current time is between start_time and end_time
    """
    now = sim_clock.now()
    today = sim_clock.today_day_name()
    current_time_str = now.strftime("%H:%M")

    schedules = ScheduleRepository.get_all(active_only=True)

    for schedule in schedules:
        if schedule.room_id != room_id:
            continue
        if today not in [d.lower() for d in schedule.days]:
            continue
        if schedule.start_time <= current_time_str <= schedule.end_time:
            return schedule

    return None


def get_schedule_in_grace_period(room_id: str, grace_minutes: int = 30) -> Optional[ScheduleModel]:
    """
    Find a schedule that has ended but is still within the grace period.
    This is used to keep the door unlocked after the class ends.
    """
    now = sim_clock.now()
    today = sim_clock.today_day_name()
    current_time_str = now.strftime("%H:%M")

    schedules = ScheduleRepository.get_all(active_only=True)

    for schedule in schedules:
        if schedule.room_id != room_id:
            continue
        if today not in [d.lower() for d in schedule.days]:
            continue

        # Check if we're past end_time but within grace period
        end_h, end_m = map(int, schedule.end_time.split(":"))
        grace_h = end_h + (end_m + grace_minutes) // 60
        grace_m = (end_m + grace_minutes) % 60
        grace_time_str = f"{grace_h:02d}:{grace_m:02d}"

        if schedule.end_time < current_time_str <= grace_time_str:
            return schedule

    return None


def is_user_authorized_to_unlock(user_id: str, user_role: str, schedule: ScheduleModel) -> bool:
    """
    Check if a user can UNLOCK the door for this schedule.

    Rules (evaluated in order):
      1. Admins and security can always unlock.
      2. If the schedule has a specific teacher_id, that teacher can unlock.
      3. Any permission entry with can_unlock=True that covers this user
         (by user_id or role) AND covers this schedule (empty schedule_ids
         means all schedules) grants unlock access.
      4. If no teacher_id is set, fall back to role-based check on schedule.roles.
    """
    # Rule 1 — always allow admins and security
    if user_role in ("admin", "security"):
        return True

    # Rule 2 — assigned teacher
    if schedule.teacher_id and user_id == schedule.teacher_id:
        return True

    # Rule 3 — check permissions table
    try:
        from backend.db.repositories import PermissionRepository
        perms = PermissionRepository.get_all()
        for perm in perms:
            if not perm.can_unlock:
                continue
            matches = (perm.user_id == user_id) or (
                perm.role and perm.role.lower() == user_role.lower()
            )
            if not matches:
                continue
            # Empty schedule_ids = applies to all schedules
            if not perm.schedule_ids or (schedule.id and schedule.id in perm.schedule_ids):
                return True
    except Exception:
        pass  # Don't block unlock if permissions query fails

    # Rule 4 — fall back to role-based
    if user_role in [r.lower() for r in schedule.roles]:
        if user_role in ("teacher", "employee"):
            return True

    return False


def get_attendance_status(user_id: Optional[str], user_role: Optional[str], schedule: ScheduleModel) -> str:
    """
    Determine attendance status for someone entering:
      - "present" — enrolled in this class (in user_overrides or role matches)
      - "not_enrolled" — recognized user but not in this class's roster
      - "unknown" — face not recognized at all
    """
    if user_id is None:
        return "unknown"

    if user_id in schedule.user_overrides:
        return "present"

    if user_role and user_role.lower() in [r.lower() for r in schedule.roles]:
        return "present"

    if schedule.teacher_id and user_id == schedule.teacher_id:
        return "present"

    return "not_enrolled"
