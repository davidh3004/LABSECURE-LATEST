"""
LabSecure AI v2 — Rooms API
Manage rooms/labs that cameras and schedules are assigned to.
"""

from fastapi import APIRouter, HTTPException

from backend.db.schemas import RoomModel, RoomCreate, RoomUpdate, EventCreate, EventType, EventSeverity
from backend.db.repositories import RoomRepository, EventRepository

router = APIRouter(prefix="/api/rooms", tags=["Rooms"])


# ── CRUD ──────────────────────────────────────────────

@router.get("/", response_model=list[RoomModel])
def list_rooms():
    """List all rooms."""
    return RoomRepository.get_all()


@router.get("/{room_id}", response_model=RoomModel)
def get_room(room_id: str):
    """Get a single room by ID."""
    room = RoomRepository.get_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


@router.post("/", response_model=RoomModel, status_code=201)
def create_room(data: RoomCreate):
    """Create a new room."""
    room = RoomRepository.create(data)

    EventRepository.create(EventCreate(
        type=EventType.ROOM_CREATED,
        details={"name": data.name, "floor": data.floor or "N/A"},
        severity=EventSeverity.INFO,
    ))

    return room


@router.put("/{room_id}", response_model=RoomModel)
def update_room(room_id: str, data: RoomUpdate):
    """Update a room."""
    room = RoomRepository.update(room_id, data)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    EventRepository.create(EventCreate(
        type=EventType.ROOM_UPDATED,
        details={"room_id": room_id, "name": room.name},
        severity=EventSeverity.INFO,
    ))

    return room


@router.delete("/{room_id}")
def delete_room(room_id: str):
    """Delete a room."""
    room = RoomRepository.get_by_id(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    if not RoomRepository.delete(room_id):
        raise HTTPException(status_code=404, detail="Room not found")

    EventRepository.create(EventCreate(
        type=EventType.ROOM_DELETED,
        details={"room_id": room_id, "name": room.name},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "deleted", "room_id": room_id}
