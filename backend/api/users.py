"""
LabSecure AI v2 — User Management API
CRUD endpoints for managing lab users and their face enrollments.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from typing import Optional

from backend.db.schemas import UserModel, UserCreate, UserUpdate, UserRole, EventCreate, EventType, EventSeverity
from backend.db.repositories import UserRepository, EventRepository

router = APIRouter(prefix="/api/users", tags=["Users"])


@router.get("/", response_model=list[UserModel])
def list_users(active_only: bool = False):
    """List all users, optionally filtering to active only."""
    return UserRepository.get_all(active_only=active_only)


@router.get("/descriptors")
def get_all_descriptors():
    """Return face descriptors for all enrolled users (for client-side matching)."""
    return UserRepository.get_all_descriptors()


@router.get("/{user_id}", response_model=UserModel)
def get_user(user_id: str):
    """Get a single user by ID."""
    user = UserRepository.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/", response_model=UserModel, status_code=201)
def create_user(data: UserCreate):
    """Create a new user."""
    user = UserRepository.create(data)

    # Log event
    EventRepository.create(EventCreate(
        type=EventType.USER_CREATED,
        user_id=user.id,
        details={"name": user.name, "role": user.role.value if hasattr(user.role, 'value') else user.role},
        severity=EventSeverity.INFO,
    ))

    return user


@router.put("/{user_id}", response_model=UserModel)
def update_user(user_id: str, data: UserUpdate):
    """Update user fields."""
    user = UserRepository.update(user_id, data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Log role changes
    if data.role is not None:
        EventRepository.create(EventCreate(
            type=EventType.ROLE_CHANGE,
            user_id=user_id,
            details={"new_role": data.role.value, "name": user.name},
            severity=EventSeverity.WARNING,
        ))

    # Log general updates (name, student_id, active status)
    changes = {}
    if data.name is not None:
        changes["name"] = data.name
    if data.student_id is not None:
        changes["student_id"] = data.student_id
    if data.active is not None:
        changes["active"] = data.active
    if changes:
        EventRepository.create(EventCreate(
            type=EventType.USER_UPDATED,
            user_id=user_id,
            details={"name": user.name, **changes},
            severity=EventSeverity.INFO,
        ))

    return user


@router.delete("/{user_id}")
def delete_user(user_id: str):
    """Delete a user."""
    user = UserRepository.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not UserRepository.delete(user_id):
        raise HTTPException(status_code=404, detail="User not found")

    EventRepository.create(EventCreate(
        type=EventType.USER_DELETED,
        user_id=user_id,
        details={"name": user.name, "role": user.role.value if hasattr(user.role, 'value') else user.role},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "deleted", "user_id": user_id}



@router.post("/{user_id}/enroll-face")
async def enroll_face(user_id: str, photo: UploadFile = File(...)):
    """
    Enroll a face for a user.
    Runs InsightFace detection in a thread-pool executor so the FastAPI event loop
    stays responsive during the 200-400ms CPU inference (GIL-friendly).
    """
    import asyncio
    import cv2
    import numpy as np
    import logging
    from backend import dependencies

    log = logging.getLogger(__name__)

    # Verify user exists
    user = UserRepository.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Read photo bytes (fast — no inference yet)
    image_bytes = await photo.read()
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image — ensure it is a valid JPEG/PNG.")

    pipeline = dependencies.vision_pipeline
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Vision pipeline is not running.")

    # ── Run InsightFace inference in a thread pool ────────────
    # This releases the asyncio event loop while waiting for the inference lock,
    # so other HTTP requests (UI, health checks, etc.) remain responsive.
    loop = asyncio.get_event_loop()
    try:
        faces = await loop.run_in_executor(None, pipeline.face_engine.detect, frame)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Face embedding extraction failed: {e}")

    if not faces:
        raise HTTPException(status_code=422, detail="No face detected. Please use a clear, well-lit frontal photo.")
    if len(faces) > 1:
        raise HTTPException(status_code=422, detail=f"{len(faces)} faces detected. Please capture only one face.")

    embedding: np.ndarray = faces[0]["embedding"]
    if embedding is None:
        raise HTTPException(status_code=422, detail="Could not extract embedding. Please try a different photo.")

    desc_list: list[float] = embedding.tolist()

    # Save 512-dim descriptor to Firestore
    blob_path = f"face_photos/{user_id}/photo.jpg"
    UserRepository.update_face_data(user_id, desc_list, blob_path)
    log.info(f"Saved 512-dim face descriptor for user {user_id}")

    # Hot-reload pipeline database (so recognition works immediately, no restart needed)
    try:
        from backend.db.repositories import UserRepository as UR
        descriptors = UR.get_all_descriptors()
        face_db: dict[str, np.ndarray] = {}
        user_info_map: dict[str, dict] = {}
        for entry in descriptors:
            uid = entry["user_id"]
            desc = entry.get("descriptor")
            if desc and len(desc) == 512:
                face_db[uid] = np.array(desc, dtype=np.float32)
                user_info_map[uid] = {"name": entry.get("name", "Unknown"), "role": entry.get("role", "")}
        dependencies.vision_pipeline.update_database(face_db, user_info_map)
        log.info(f"Pipeline face database reloaded: {len(face_db)} enrolled users")
    except Exception as reload_err:
        log.warning(f"Pipeline hot-reload after enrollment failed: {reload_err}")

    # Upload photo to Firebase Storage (best-effort, non-blocking)
    try:
        from backend.db.firebase_client import get_storage_bucket
        bucket = get_storage_bucket()
        if bucket:
            blob = bucket.blob(blob_path)
            blob.upload_from_string(image_bytes, content_type=photo.content_type or "image/jpeg")
    except Exception as upload_err:
        log.warning(f"Photo upload to Firebase Storage failed for {user_id}: {upload_err}")

    return {
        "status": "enrolled",
        "user_id": user_id,
        "embedding_dim": len(desc_list),
        "face_encoding_ref": blob_path,
    }

