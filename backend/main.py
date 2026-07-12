"""
LabSecure AI v2 — FastAPI Application Entry Point
Initializes all subsystems and mounts API routers.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_config
from backend import dependencies
from backend.api import users, schedules, permissions, events, guests, emergency, cameras, ws_feed, rooms, auth
from backend.api import door_controller as door_ctrl
from backend.utils.sim_clock import router as sim_clock_router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("server_debug.log", mode="a"),
    ]
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    logger.info("=" * 60)
    logger.info("  LabSecure AI v2 — Starting Up")
    logger.info("=" * 60)

    # ── Seed Default Admin ─────────────────────────────────
    try:
        from backend.db.repositories import AdminRepository
        from backend.db.schemas import AdminCreate
        admins = AdminRepository.get_all()
        if not admins:
            logger.info("No admins found, creating default admin account (admin/admin)...")
            AdminRepository.create(AdminCreate(username="admin", password="admin"))
    except Exception as e:
        logger.warning(f"Failed to check/seed default admin: {e}")

    # ── Initialize Firebase ────────────────────────────────
    try:
        from backend.db.firebase_client import init_firebase
        init_firebase()
        logger.info("✓ Firebase initialized")
    except Exception as e:
        logger.warning(f"✗ Firebase init failed (will retry on first use): {e}")

    # ── Start Event Batch Writer ───────────────────────────
    try:
        from backend.db.repositories import start_event_writer
        start_event_writer()
        logger.info("✓ Event batch writer started")
    except Exception as e:
        logger.warning(f"✗ Event batch writer failed: {e}")

    # ── Initialize Access Controller ───────────────────────
    try:
        from backend.core.access_control import AccessController
        dependencies.access_controller = AccessController()
        logger.info("✓ Access Controller initialized")
    except Exception as e:
        logger.warning(f"✗ Access Controller init failed: {e}")

    # ── Initialize Anomaly Detector ─────────────────────  
    try:
        from backend.core.anomaly_detector import AnomalyDetector
        dependencies.anomaly_detector = AnomalyDetector.from_config()
        logger.info("✓ Anomaly Detector initialized")
    except Exception as e:
        logger.warning(f"✗ Anomaly Detector init failed: {e}")

    # ── Initialize Camera Monitor ─────────────────────────
    try:
        from backend.services.camera_monitor import CameraMonitor
        dependencies.camera_monitor = CameraMonitor()
        dependencies.camera_monitor.start()
        cameras.set_monitor(dependencies.camera_monitor)
        logger.info("✓ Camera Monitor started")
    except Exception as e:
        logger.warning(f"✗ Camera Monitor init failed: {e}")

    # ── Initialize Vision Pipeline ────────────────────────
    try:
        import numpy as np
        from backend.vision.pipeline import VisionPipeline
        from backend.db.repositories import UserRepository

        # Load enrolled face descriptors from Firestore at startup
        def _load_face_database() -> tuple[dict, dict]:
            """Fetch all enrolled users' descriptors from Firestore (512-dim only)."""
            face_db: dict[str, np.ndarray] = {}
            user_info_map: dict[str, dict] = {}
            skipped = 0
            try:
                descriptors = UserRepository.get_all_descriptors()
                for entry in descriptors:
                    uid = entry["user_id"]
                    desc = entry.get("descriptor")
                    if not desc or len(desc) == 0:
                        continue
                    if len(desc) != 512:
                        # Old face-api.js 128-dim descriptors are incompatible with InsightFace.
                        # Skip them — user must re-enroll via the app to generate a 512-dim embedding.
                        skipped += 1
                        logger.warning(
                            f"Skipping {len(desc)}-dim descriptor for user {uid!r} "
                            f"('{entry.get('name', '?')}') — re-enroll to fix recognition."
                        )
                        continue
                    face_db[uid] = np.array(desc, dtype=np.float32)
                    user_info_map[uid] = {
                        "name": entry.get("name", "Unknown"),
                        "role": entry.get("role", ""),
                    }
            except Exception as db_err:
                logger.warning(f"Could not load face descriptors from Firestore: {db_err}")
            if skipped:
                logger.warning(
                    f"{skipped} descriptor(s) skipped (wrong dimension). "
                    "Re-enroll those users via the app to restore recognition."
                )
            return face_db, user_info_map


        face_db, user_info_map = _load_face_database()
        logger.info(f"✓ Loaded {len(face_db)} face descriptor(s) from Firestore")

        dependencies.vision_pipeline = VisionPipeline(
            face_database=face_db,
            user_info=user_info_map,
            on_access_event=_handle_access_event,
        )
        dependencies.vision_pipeline.start()
        cameras.set_pipeline(dependencies.vision_pipeline)
        ws_feed.set_pipeline(dependencies.vision_pipeline)
        logger.info("✓ Vision Pipeline started")
    except Exception as e:
        logger.warning(f"✗ Vision Pipeline start failed: {e}")
        logger.warning("  System will run without live face recognition")

    # ── Start Door Auto-Lock Thread ────────────────────────
    try:
        from backend.api.door_controller import start_autolock
        start_autolock()
        logger.info("✓ Door auto-lock thread started")
    except Exception as e:
        logger.warning(f"✗ Door auto-lock thread failed: {e}")

    # ── Database Biometric Encryption Migration ────────────
    # Requires LABSECURE_MASTER_KEY env var (64-char hex, 32 bytes).
    try:
        from backend.db.firebase_client import get_firestore
        from backend.core.encryption import BiometricEncryptor
        import numpy as np
        from google.cloud import firestore

        db = get_firestore()
        encryptor = BiometricEncryptor()

        # 1. Migrate Users
        users_ref = db.collection("users").stream()
        migrated_users = 0
        for doc in users_ref:
            data = doc.to_dict()
            if "face_descriptor" in data and "face_descriptor_encrypted" not in data:
                desc = data["face_descriptor"]
                if desc and isinstance(desc, list) and len(desc) == 512:
                    embedding_arr = np.array(desc, dtype=np.float32)
                    serialized = BiometricEncryptor.serialize_embedding(embedding_arr)
                    encrypted_payload = encryptor.encrypt(serialized)
                    db.collection("users").document(doc.id).update({
                        "face_descriptor_encrypted": encrypted_payload,
                        "face_descriptor": firestore.DELETE_FIELD,
                    })
                    migrated_users += 1
        if migrated_users > 0:
            logger.info(f"✓ Migrated {migrated_users} user face descriptors to encrypted format.")

        # 2. Migrate Guests
        guests_ref = db.collection("guests").stream()
        migrated_guests = 0
        for doc in guests_ref:
            data = doc.to_dict()
            if "face_descriptor" in data and "face_descriptor_encrypted" not in data:
                desc_str = data["face_descriptor"]
                if desc_str and isinstance(desc_str, str):
                    try:
                        desc = [float(x) for x in desc_str.split(",")]
                        if len(desc) == 512:
                            embedding_arr = np.array(desc, dtype=np.float32)
                            serialized = BiometricEncryptor.serialize_embedding(embedding_arr)
                            encrypted_payload = encryptor.encrypt(serialized)
                            db.collection("guests").document(doc.id).update({
                                "face_descriptor_encrypted": encrypted_payload,
                                "face_descriptor": firestore.DELETE_FIELD,
                            })
                            migrated_guests += 1
                    except Exception:
                        pass
        if migrated_guests > 0:
            logger.info(f"✓ Migrated {migrated_guests} guest face descriptors to encrypted format.")
    except Exception as migration_err:
        logger.warning(f"Skipping database biometric migration: {migration_err}")

    # ── Start Automated Biometric Data Retention Scheduler ──
    try:
        from backend.services.retention import purge_expired_guest_biometrics
        import asyncio

        async def retention_scheduler():
            while True:
                try:
                    purge_expired_guest_biometrics()
                except Exception as scheduler_err:
                    logger.error(f"Error in data retention job: {scheduler_err}")
                # Run once every 24 hours
                await asyncio.sleep(24 * 3600)

        asyncio.create_task(retention_scheduler())
        logger.info("✓ Automated Biometric Data Retention Scheduler started")
    except Exception as scheduler_init_err:
        logger.warning(f"✗ Automated Biometric Data Retention Scheduler init failed: {scheduler_init_err}")

    logger.info("=" * 60)
    logger.info("  LabSecure AI v2 — Ready")
    logger.info("=" * 60)

    yield

    # ── Shutdown ──────────────────────────────────────────
    logger.info("Shutting down LabSecure AI v2...")

    if dependencies.vision_pipeline:
        dependencies.vision_pipeline.stop()

    try:
        from backend.api.door_controller import stop_autolock
        stop_autolock()
    except Exception:
        pass

    if dependencies.camera_monitor:
        dependencies.camera_monitor.stop()

    # Flush remaining events before exiting
    try:
        from backend.db.repositories import stop_event_writer
        stop_event_writer()
        logger.info("✓ Event batch writer stopped")
    except Exception:
        pass

    logger.info("Shutdown complete.")


def _handle_access_event(camera_id: str, user_id: str, identity: dict):
    """Callback from vision pipeline when a face is recognized."""
    from backend.db.schemas import EventCreate, EventType, EventSeverity
    from backend.db.repositories import EventRepository

    try:
        if identity.get("status") == "unknown":
            # Report to anomaly detector
            if dependencies.anomaly_detector:
                dependencies.anomaly_detector.report_unknown(camera_id)

            EventRepository.create(EventCreate(
                type=EventType.UNKNOWN_FACE,
                camera_id=camera_id,
                details={"confidence": identity.get("confidence", 0)},
                severity=EventSeverity.WARNING,
            ))
        else:
            # Run access validation
            if dependencies.access_controller:
                from backend.core.access_control import AccessController
                decision = dependencies.access_controller.validate(
                    user_id=user_id,
                    role=identity.get("role"),
                    is_live=identity.get("is_live", False),
                    liveness_score=identity.get("liveness_score", 0),
                )

                EventRepository.create(EventCreate(
                    type=decision.event_type,
                    user_id=user_id,
                    camera_id=camera_id,
                    details={
                        "name": identity.get("name"),
                        "role": identity.get("role"),
                        "confidence": identity.get("confidence"),
                        "liveness": identity.get("liveness_score"),
                        "reason": decision.reason,
                    },
                    severity=EventSeverity.INFO if decision.granted else EventSeverity.WARNING,
                ))
    except Exception as e:
        logger.error(f"Access event handler error: {e}")


# ── Create FastAPI App ─────────────────────────────────────

app_config = get_config("app")

app = FastAPI(
    title="LabSecure AI v2",
    description="Enterprise-grade biometric access control for University Telematics Lab",
    version=app_config.get("version", "2.0.0"),
    lifespan=lifespan,
)

# CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(users.router)
app.include_router(schedules.router)
app.include_router(permissions.router)
app.include_router(events.router)
app.include_router(guests.router)
app.include_router(emergency.router)
app.include_router(cameras.router)
app.include_router(rooms.router)
app.include_router(auth.router)
app.include_router(ws_feed.router)
app.include_router(door_ctrl.router)
app.include_router(sim_clock_router)


@app.get("/")
def root():
    return {
        "name": "LabSecure AI v2",
        "version": app_config.get("version", "2.0.0"),
        "status": "operational",
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "vision_pipeline": dependencies.vision_pipeline is not None,
        "camera_monitor": dependencies.camera_monitor is not None,
        "access_controller": dependencies.access_controller is not None,
    }
