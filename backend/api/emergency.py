"""
LabSecure AI v2 — Emergency Mode API
Kill switch to instantly lock/unlock the lab.
"""

from fastapi import APIRouter, HTTPException

from backend.db.schemas import EmergencyAction, SystemState, EventCreate, EventType, EventSeverity
from backend.db.repositories import SystemStateRepository, EventRepository

router = APIRouter(prefix="/api/emergency", tags=["Emergency"])


@router.get("/status", response_model=SystemState)
def get_emergency_status():
    """Get current emergency lockdown status."""
    return SystemStateRepository.get()


@router.post("/activate")
def activate_emergency(action: EmergencyAction):
    """
    Activate emergency lockdown.
    Instantly locks the lab and revokes all access permissions regardless of schedule.
    """
    state = SystemStateRepository.get()
    if state.emergency_lock:
        raise HTTPException(status_code=409, detail="Emergency lockdown is already active")

    SystemStateRepository.set_emergency(activated=True, activated_by=action.activated_by)

    EventRepository.create(EventCreate(
        type=EventType.EMERGENCY_LOCK,
        details={"activated_by": action.activated_by},
        severity=EventSeverity.CRITICAL,
    ))

    return {
        "status": "emergency_activated",
        "message": "Lab is now in EMERGENCY LOCKDOWN. All access revoked.",
        "activated_by": action.activated_by,
    }


@router.post("/deactivate")
def deactivate_emergency(action: EmergencyAction):
    """
    Deactivate emergency lockdown.
    Restores normal access control based on schedules and permissions.
    """
    state = SystemStateRepository.get()
    if not state.emergency_lock:
        raise HTTPException(status_code=409, detail="Emergency lockdown is not active")

    SystemStateRepository.set_emergency(activated=False, activated_by=action.activated_by)

    EventRepository.create(EventCreate(
        type=EventType.EMERGENCY_UNLOCK,
        details={"deactivated_by": action.activated_by},
        severity=EventSeverity.CRITICAL,
    ))

    return {
        "status": "emergency_deactivated",
        "message": "Emergency lockdown lifted. Normal access control restored.",
        "deactivated_by": action.activated_by,
    }
