"""
LabSecure AI v2 — Guest Access API
Register, list, and revoke temporary guest access.
"""

from fastapi import APIRouter, HTTPException, UploadFile, File, Form

from backend.db.schemas import GuestModel, GuestCreate, EventCreate, EventType, EventSeverity
from backend.db.repositories import GuestRepository, EventRepository

router = APIRouter(prefix="/api/guests", tags=["Guests"])


@router.get("/", response_model=list[GuestModel])
def list_guests(include_expired: bool = False):
    """List all guests. By default only shows active (non-expired, non-revoked) guests."""
    return GuestRepository.get_all(include_expired=include_expired)


@router.get("/{guest_id}", response_model=GuestModel)
def get_guest(guest_id: str):
    """Get a single guest by ID."""
    guest = GuestRepository.get_by_id(guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")
    return guest


@router.post("/", response_model=GuestModel, status_code=201)
def register_guest(data: GuestCreate):
    """Register a new temporary guest with a time-limited access window."""
    guest = GuestRepository.create(data)

    EventRepository.create(EventCreate(
        type=EventType.GUEST_REGISTERED,
        details={
            "guest_name": guest.name,
            "sponsor_id": guest.sponsor_id,
            "valid_from": data.valid_from.isoformat(),
            "valid_until": data.valid_until.isoformat(),
        },
        severity=EventSeverity.INFO,
    ))

    return guest


@router.delete("/{guest_id}")
def revoke_guest(guest_id: str):
    """Revoke a guest's access immediately."""
    if not GuestRepository.revoke(guest_id):
        raise HTTPException(status_code=404, detail="Guest not found")

    EventRepository.create(EventCreate(
        type=EventType.GUEST_REVOKED,
        details={"guest_id": guest_id, "action": "revoked"},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "revoked", "guest_id": guest_id}


@router.post("/{guest_id}/enroll-face")
async def enroll_guest_face(guest_id: str, photo: UploadFile = File(...)):
    """
    Enroll a face for a guest.
    Runs InsightFace detection in a thread-pool executor so the FastAPI event loop
    stays responsive during the 200-400ms CPU inference (GIL-friendly).
    """
    import asyncio
    import cv2
    import numpy as np
    import logging
    from backend import dependencies

    log = logging.getLogger(__name__)

    guest = GuestRepository.get_by_id(guest_id)
    if not guest:
        raise HTTPException(status_code=404, detail="Guest not found")

    # Decode image (fast — no inference yet)
    image_bytes = await photo.read()
    nparr = np.frombuffer(image_bytes, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Could not decode image — ensure it is a valid JPEG/PNG.")

    pipeline = dependencies.vision_pipeline
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Vision pipeline is not running.")

    # ── Run InsightFace inference in a thread pool ────────────
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
    blob_path = f"face_photos/guests/{guest_id}/photo.jpg"
    GuestRepository.update_face_data(guest_id, desc_list, blob_path)
    log.info(f"Saved 512-dim face descriptor for guest {guest_id}")

    # Upload photo to Firebase Storage (best-effort)
    try:
        from backend.db.firebase_client import get_storage_bucket
        bucket = get_storage_bucket()
        if bucket:
            blob = bucket.blob(blob_path)
            blob.upload_from_string(image_bytes, content_type=photo.content_type or "image/jpeg")
    except Exception as upload_err:
        log.warning(f"Photo upload to Firebase Storage failed for guest {guest_id}: {upload_err}")

    return {
        "status": "enrolled",
        "guest_id": guest_id,
        "embedding_dim": len(desc_list),
        "face_encoding_ref": blob_path,
    }


