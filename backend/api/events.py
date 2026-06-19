"""
LabSecure AI v2 — Event Log API
Query and stream system events with filtering and pagination.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Query

from backend.db.schemas import EventModel
from backend.db.repositories import EventRepository

router = APIRouter(prefix="/api/events", tags=["Events"])


@router.get("/", response_model=list[EventModel])
def list_events(
    type: Optional[str] = Query(None, description="Filter by event type"),
    severity: Optional[str] = Query(None, description="Filter by severity"),
    camera_id: Optional[str] = Query(None, description="Filter by camera ID"),
    user_id: Optional[str] = Query(None, description="Filter by user ID"),
    from_time: Optional[datetime] = Query(None, alias="from", description="From timestamp (ISO 8601)"),
    to_time: Optional[datetime] = Query(None, alias="to", description="To timestamp (ISO 8601)"),
    limit: int = Query(100, ge=1, le=500, description="Max results"),
    offset: int = Query(0, ge=0, description="Pagination offset"),
):
    """
    Query system events with optional filters.
    Results are ordered by timestamp descending (newest first).
    """
    return EventRepository.query(
        event_type=type,
        severity=severity,
        camera_id=camera_id,
        user_id=user_id,
        from_time=from_time,
        to_time=to_time,
        limit=limit,
        offset=offset,
    )


@router.get("/types")
def list_event_types():
    """Get all possible event types."""
    from backend.db.schemas import EventType
    return [{"value": e.value, "label": e.value.replace("_", " ").title()} for e in EventType]


@router.get("/stats")
def event_stats(
    from_time: Optional[datetime] = Query(None, alias="from"),
    to_time: Optional[datetime] = Query(None, alias="to"),
):
    """Get event count statistics by type and severity."""
    events = EventRepository.query(from_time=from_time, to_time=to_time, limit=500)

    type_counts: dict[str, int] = {}
    severity_counts: dict[str, int] = {}

    for event in events:
        type_counts[event.type] = type_counts.get(event.type, 0) + 1
        severity_counts[event.severity] = severity_counts.get(event.severity, 0) + 1

    return {
        "total": len(events),
        "by_type": type_counts,
        "by_severity": severity_counts,
    }
