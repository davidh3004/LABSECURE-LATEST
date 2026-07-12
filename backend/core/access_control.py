"""
LabSecure AI v2 — Access Control Engine
Validates access based on: Emergency State + Liveness + Schedule + Permissions + Guest Expiry.
"""

import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from backend.config import get_config
from backend.db.schemas import AccessDecision, EventType
from backend.db.repositories import (
    ScheduleRepository,
    PermissionRepository,
    GuestRepository,
    SystemStateRepository,
)
from backend.utils.sim_clock import sim_clock

logger = logging.getLogger(__name__)


class AccessController:
    """
    Validates whether a user should be granted access to the lab.
    
    Validation chain:
    1. Emergency lockdown → deny all
    2. Liveness check → deny if spoofed
    3. Guest check → validate time window
    4. Schedule check → is current time within an active schedule for user's role?
    5. Permission overrides → can user/role access outside schedule?
    """

    def __init__(self):
        ac_config = get_config("access_control")
        self.guest_grace_period = timedelta(
            minutes=ac_config.get("guest_grace_period_minutes", 5)
        )

    def validate(
        self,
        user_id: Optional[str],
        role: Optional[str],
        is_live: bool,
        liveness_score: float = 0.0,
        is_guest: bool = False,
        current_time: Optional[datetime] = None,
    ) -> AccessDecision:
        """
        Evaluate access for a detected face.
        
        Args:
            user_id: Recognized user ID (None for unknown faces)
            role: User's role string
            is_live: Whether liveness check passed
            liveness_score: Confidence of liveness check
            is_guest: Whether this is a guest user
            current_time: Override for testing; defaults to now (UTC)
            
        Returns:
            AccessDecision with granted/denied status and reason
        """
        now = current_time or sim_clock.now()

        # ── Step 1: Emergency Lockdown ─────────────────────
        try:
            state = SystemStateRepository.get()
            if state.emergency_lock:
                return AccessDecision(
                    granted=False,
                    reason="Emergency lockdown is active — all access revoked",
                    event_type=EventType.ACCESS_DENIED,
                    user_id=user_id,
                    role=role,
                    liveness_score=liveness_score,
                )
        except Exception as e:
            logger.warning(f"Could not check emergency state: {e}")

        # ── Step 2: Unknown Face ───────────────────────────
        if user_id is None:
            return AccessDecision(
                granted=False,
                reason="Face not recognized",
                event_type=EventType.UNKNOWN_FACE,
                liveness_score=liveness_score,
            )

        # ── Step 3: Liveness Check ─────────────────────────
        if not is_live:
            return AccessDecision(
                granted=False,
                reason="Liveness check failed — possible spoofing attempt",
                event_type=EventType.ACCESS_DENIED,
                user_id=user_id,
                role=role,
                liveness_score=liveness_score,
            )

        # ── Step 4: Guest Expiry Check ─────────────────────
        if is_guest:
            return self._validate_guest(user_id, now, liveness_score)

        # ── Step 5: Schedule Check ─────────────────────────
        in_schedule = self._is_in_schedule(user_id, role, now)

        if in_schedule:
            return AccessDecision(
                granted=True,
                reason="Access granted — within scheduled hours",
                event_type=EventType.ACCESS_GRANTED,
                user_id=user_id,
                role=role,
                liveness_score=liveness_score,
            )

        # ── Step 6: Permission Override ────────────────────
        has_override = self._has_outside_schedule_permission(user_id, role)

        if has_override:
            return AccessDecision(
                granted=True,
                reason="Access granted — outside schedule with permission override",
                event_type=EventType.ACCESS_GRANTED,
                user_id=user_id,
                role=role,
                liveness_score=liveness_score,
            )

        # ── Denied: Outside schedule, no override ─────────
        return AccessDecision(
            granted=False,
            reason="Access denied — outside scheduled hours and no permission override",
            event_type=EventType.ACCESS_DENIED,
            user_id=user_id,
            role=role,
            liveness_score=liveness_score,
        )

    def _validate_guest(self, guest_id: str, now: datetime, liveness_score: float) -> AccessDecision:
        """Check guest access window."""
        try:
            guest = GuestRepository.get_by_id(guest_id)
            if guest is None:
                return AccessDecision(
                    granted=False,
                    reason="Guest record not found",
                    event_type=EventType.ACCESS_DENIED,
                    user_id=guest_id,
                    role="guest",
                    liveness_score=liveness_score,
                )

            if guest.revoked:
                return AccessDecision(
                    granted=False,
                    reason="Guest access has been revoked",
                    event_type=EventType.ACCESS_DENIED,
                    user_id=guest_id,
                    role="guest",
                    liveness_score=liveness_score,
                )

            if guest.valid_from and now < guest.valid_from:
                return AccessDecision(
                    granted=False,
                    reason=f"Guest access not yet valid (starts {guest.valid_from})",
                    event_type=EventType.ACCESS_DENIED,
                    user_id=guest_id,
                    role="guest",
                    liveness_score=liveness_score,
                )

            if guest.valid_until:
                expiry_with_grace = guest.valid_until + self.guest_grace_period
                if now > expiry_with_grace:
                    return AccessDecision(
                        granted=False,
                        reason=f"Guest access expired at {guest.valid_until}",
                        event_type=EventType.GUEST_EXPIRED,
                        user_id=guest_id,
                        role="guest",
                        liveness_score=liveness_score,
                    )

            return AccessDecision(
                granted=True,
                reason="Guest access granted — within valid time window",
                event_type=EventType.ACCESS_GRANTED,
                user_id=guest_id,
                user_name=guest.name,
                role="guest",
                liveness_score=liveness_score,
            )
        except Exception as e:
            logger.error(f"Guest validation error: {e}")
            return AccessDecision(
                granted=False,
                reason=f"Guest validation error: {e}",
                event_type=EventType.ACCESS_DENIED,
                user_id=guest_id,
                role="guest",
                liveness_score=liveness_score,
            )

    def _is_in_schedule(self, user_id: str, role: Optional[str], now: datetime) -> bool:
        """Check if current time falls within any active schedule for the user's role."""
        try:
            schedules = ScheduleRepository.get_all(active_only=True)
            day_name = now.strftime("%A").lower()
            current_time_str = now.strftime("%H:%M")

            for schedule in schedules:
                # Check day
                if day_name not in schedule.days:
                    continue

                # Check time window (supports per-day hours)
                from backend.utils.schedule_utils import get_schedule_window_for_day
                start_time, end_time = get_schedule_window_for_day(schedule, day_name)
                if start_time <= current_time_str <= end_time:
                    # Check if user is in overrides (explicit include)
                    if user_id in schedule.user_overrides:
                        return True

                    # Check if user's role matches
                    if role and role in schedule.roles:
                        return True

                    # If no roles specified, schedule applies to all
                    if not schedule.roles:
                        return True

            return False
        except Exception as e:
            logger.error(f"Schedule check error: {e}")
            return False

    def _has_outside_schedule_permission(self, user_id: str, role: Optional[str]) -> bool:
        """Check if user or role has permission to access outside scheduled hours."""
        try:
            # Check user-specific permissions
            user_perms = PermissionRepository.get_for_user(user_id)
            for perm in user_perms:
                if perm.can_access_outside_schedule:
                    return True

            # Check role-based permissions
            if role:
                role_perms = PermissionRepository.get_for_role(role)
                for perm in role_perms:
                    if perm.can_access_outside_schedule:
                        return True

            return False
        except Exception as e:
            logger.error(f"Permission check error: {e}")
            return False
