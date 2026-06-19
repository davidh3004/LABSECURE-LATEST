"""
LabSecure AI v2 — Simulation Clock
A global clock override for demo/testing. All schedule and door logic
calls sim_clock.now() instead of datetime.now() so the presenter can
set any day/time and walk through the full access-control flow live.
"""

import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sim-clock", tags=["Simulation Clock"])


class _SimClock:
    """Singleton simulation clock."""

    def __init__(self):
        self._override: Optional[datetime] = None
        self._day_override: Optional[str] = None  # e.g. "monday"

    def now(self) -> datetime:
        """Return the overridden time if set, otherwise real local time."""
        if self._override is not None:
            return self._override
        return datetime.now()

    def today_day_name(self) -> str:
        """Return lowercase weekday name (e.g. 'monday')."""
        if self._day_override is not None:
            return self._day_override
        return self.now().strftime("%A").lower()

    def set(self, date_str: str, hour: int, minute: int):
        """Override the clock to a specific date + time."""
        target_date = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        self._override = target_date.replace(
            hour=hour, minute=minute, second=0, microsecond=0,
        )
        self._day_override = self._override.strftime("%A").lower()
        logger.info(f"Simulation clock set to {date_str} {self._day_override} {hour:02d}:{minute:02d}")

    def reset(self):
        """Revert to real system time."""
        self._override = None
        self._day_override = None
        logger.info("Simulation clock reset to real time")

    @property
    def is_overridden(self) -> bool:
        return self._override is not None

    def to_dict(self) -> dict:
        now = self.now()
        return {
            "current_time": now.isoformat(),
            "date": now.strftime("%Y-%m-%d"),
            "day": self.today_day_name(),
            "hour": now.hour,
            "minute": now.minute,
            "is_simulated": self.is_overridden,
        }


# Global singleton
sim_clock = _SimClock()


# ── API Endpoints ─────────────────────────────────────

class SetClockRequest(BaseModel):
    date: str      # e.g. "2026-03-24"
    hour: int      # 0-23
    minute: int    # 0-59


@router.get("/")
def get_clock():
    """Get current simulation clock state."""
    return sim_clock.to_dict()


@router.post("/set")
def set_clock(data: SetClockRequest):
    """Override the simulation clock to a specific date + time."""
    sim_clock.set(data.date, data.hour, data.minute)
    return {"status": "set", **sim_clock.to_dict()}


@router.post("/reset")
def reset_clock():
    """Reset simulation clock to real system time."""
    sim_clock.reset()
    return {"status": "reset", **sim_clock.to_dict()}
