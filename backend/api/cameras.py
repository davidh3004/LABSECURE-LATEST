"""
LabSecure AI v2 — Camera Management API
Camera CRUD + health status + snapshot endpoints.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from backend.db.schemas import CameraCreate, CameraModel, EventCreate, EventType, EventSeverity
from backend.db.repositories import CameraRepository, EventRepository
from backend.config import get_config

router = APIRouter(prefix="/api/cameras", tags=["Cameras"])

# References set by main.py at startup
_pipeline = None
_monitor = None

# Cache: Firestore camera ID -> pipeline camera ID (for config.yaml cameras only)
_id_map: dict[str, str] = {}


def _build_rtsp_url(ip: str) -> str:
    """Return a full RTSP URL. If a bare IP (with optional port) is given,
    wrap it with the standard RTSP scheme and default path."""
    if ip.startswith(("rtsp://", "rtsps://", "http://", "https://")):
        return ip
    # bare IP or IP:port — use generic RTSP default
    host = ip.strip()
    if ":" not in host:
        host = f"{host}:554"
    return f"rtsp://{host}/stream1"


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline
    _rebuild_id_map()
    _init_firestore_cameras()


def _init_firestore_cameras():
    """Load all enabled cameras from Firestore and add them to the running pipeline at startup."""
    if _pipeline is None:
        return
    try:
        from backend.vision.camera import CameraStream
        from backend.db.repositories import CameraRepository

        db_cameras = CameraRepository.get_all()
        config_ids = {c["id"] for c in get_config("cameras")}
        vision_cfg = get_config("vision")

        for cam in db_cameras:
            if not cam.enabled:
                continue

            # If this camera is already mapped to a config.yaml camera, it's already started by the pipeline
            if cam.id in _id_map:
                continue

            # Otherwise, start it dynamically if it's not already in the pipeline
            if cam.id not in _pipeline._frame_queues:
                if cam.type == "ip" and cam.ip:
                    rtsp_url = _build_rtsp_url(cam.ip)
                    camera_stream = CameraStream(
                        camera_id=cam.id,
                        name=cam.name,
                        source=rtsp_url,
                        camera_type="ip",
                        target_fps=vision_cfg.get("target_fps", 25),
                    )
                    _pipeline.add_camera(camera_stream)
                elif cam.type == "webcam":
                    try:
                        device_index = int(cam.ip) if cam.ip and cam.ip.isdigit() else 0
                    except (ValueError, TypeError):
                        device_index = 0
                    camera_stream = CameraStream(
                        camera_id=cam.id,
                        name=cam.name,
                        source=device_index,
                        camera_type="webcam",
                        target_fps=vision_cfg.get("target_fps", 25),
                    )
                    _pipeline.add_camera(camera_stream)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Error initializing Firestore cameras: {e}", exc_info=True)


def set_monitor(monitor):
    global _monitor
    _monitor = monitor


def _rebuild_id_map():
    """Pre-build the Firestore ID -> pipeline config ID mapping."""
    global _id_map
    _id_map.clear()

    if _pipeline is None:
        return

    try:
        import re
        cameras = CameraRepository.get_all()
        cameras_config = get_config("cameras")

        for cam in cameras:
            if cam.ip:
                # ── IP cameras: match by IP address ───────────────────
                cam_ip = cam.ip
                ip_match = re.search(r'@([\d.]+)', cam_ip)
                plain_ip = ip_match.group(1) if ip_match else cam_ip

                for cam_cfg in cameras_config:
                    cfg_ip = cam_cfg.get("static_ip") or ""
                    cfg_url = cam_cfg.get("url", "")
                    if (plain_ip == cfg_ip or
                        cam_ip == cfg_url or
                        f"@{plain_ip}" in cfg_url or
                        f"/{plain_ip}" in cfg_url):
                        _id_map[cam.id] = cam_cfg["id"]
                        break
            else:
                # ── Webcam / local devices: match by type ──────────────
                cam_type = getattr(cam, "type", None) or "webcam"
                for cam_cfg in cameras_config:
                    if cam_cfg.get("type") == cam_type and cam_cfg.get("enabled", True):
                        _id_map[cam.id] = cam_cfg["id"]
                        break

    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Error rebuilding ID map: {e}", exc_info=True)


def resolve_camera_id(camera_id: str) -> str:
    """Resolve a Firestore camera ID to a pipeline camera ID."""
    mapped_id = _id_map.get(camera_id, camera_id)
    if _pipeline:
        if mapped_id in _pipeline._frame_queues:
            return mapped_id
        if "cam_webcam" in _pipeline._frame_queues:
            return "cam_webcam"
    return mapped_id


@router.get("/health")
def get_camera_health():
    """
    Get comprehensive health status for all cameras and network equipment.
    Combines vision pipeline status with network ping results.
    """
    result = {
        "cameras": [],
        "network": {},
    }

    # Reverse ID map (Pipeline ID -> Firestore ID)
    rev_map = {v: k for k, v in _id_map.items()}

    # Vision pipeline camera status
    if _pipeline:
        for health in _pipeline.get_camera_health():
            # Translate pipeline ID to Firestore ID for the frontend
            pid = health["camera_id"]
            matched_id = rev_map.get(pid, pid)
            health["camera_id"] = matched_id
            result["cameras"].append(health)

    # Network ping status
    if _monitor:
        result["network"] = _monitor.get_health()

    return result


@router.get("/list")
def list_cameras():
    """List all cameras from Firestore (added via Camera Health UI)."""
    cameras = CameraRepository.get_all()
    return [cam.model_dump() for cam in cameras]


@router.get("/{camera_id}/snapshot")
def get_snapshot(camera_id: str):
    """
    Get the latest JPEG frame for a camera instantly via HTTP.
    Useful for showing the first frame before the WebSocket connects.
    """
    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Vision pipeline not running")

    pipeline_id = resolve_camera_id(camera_id)
    frame = _pipeline.get_snapshot(pipeline_id)

    if frame is None:
        raise HTTPException(status_code=404, detail="No frame available")

    jpeg_bytes = frame.to_jpeg()
    return Response(content=jpeg_bytes, media_type="image/jpeg")


@router.get("/{camera_id}/raw-snapshot")
def get_raw_snapshot(camera_id: str):
    """
    Get the latest RAW frame (no recognition overlays, full resolution).
    Used by face enrollment when capturing from a backend camera, so the
    enrollment photo isn't polluted by bounding boxes and labels.
    """
    if _pipeline is None:
        raise HTTPException(status_code=503, detail="Vision pipeline not running")

    pipeline_id = resolve_camera_id(camera_id)
    jpeg_bytes = _pipeline.get_raw_snapshot_jpeg(pipeline_id)

    if jpeg_bytes is None:
        raise HTTPException(status_code=404, detail="No frame available")

    return Response(content=jpeg_bytes, media_type="image/jpeg")


@router.post("/", response_model=CameraModel, status_code=201)
def create_camera(data: CameraCreate):
    """Create a new camera and start it in the vision pipeline immediately."""
    cam = CameraRepository.create(data)

    # Rebuild map FIRST so we know if this Firestore camera maps to a config.yaml camera.
    _rebuild_id_map()

    if _pipeline:
        from backend.vision.camera import CameraStream
        vision_cfg = get_config("vision")

        if cam.id in _id_map:
            # This camera maps to a config.yaml pipeline entry (e.g. cam_webcam).
            # The pipeline stream should already be running, but if it was previously
            # killed (e.g. by deleting the old Firestore record), revive it from config.
            mapped_id = _id_map[cam.id]
            if mapped_id not in _pipeline._frame_queues:
                cameras_config = get_config("cameras")
                cam_cfg = next((c for c in cameras_config if c["id"] == mapped_id), None)
                if cam_cfg:
                    cam_type = cam_cfg.get("type", "ip")
                    source = (
                        cam_cfg.get("device_index", 0)
                        if cam_type == "webcam"
                        else cam_cfg.get("url", "")
                    )
                    revived = CameraStream(
                        camera_id=mapped_id,
                        name=cam_cfg.get("name", mapped_id),
                        source=source,
                        camera_type=cam_type,
                        target_fps=vision_cfg.get("target_fps", 25),
                    )
                    _pipeline.add_camera(revived)

        else:
            # No config.yaml entry covers this camera — start it dynamically.
            if data.type == "ip" and data.ip:
                rtsp_url = _build_rtsp_url(data.ip)
                camera_stream = CameraStream(
                    camera_id=cam.id,
                    name=cam.name,
                    source=rtsp_url,
                    camera_type="ip",
                    target_fps=vision_cfg.get("target_fps", 25),
                )
                _pipeline.add_camera(camera_stream)

            elif data.type == "webcam":
                # device_index optionally provided in the ip field, defaults to 0
                try:
                    device_index = int(data.ip) if data.ip and data.ip.isdigit() else 0
                except (ValueError, TypeError):
                    device_index = 0
                camera_stream = CameraStream(
                    camera_id=cam.id,
                    name=cam.name,
                    source=device_index,
                    camera_type="webcam",
                    target_fps=vision_cfg.get("target_fps", 25),
                )
                _pipeline.add_camera(camera_stream)

    EventRepository.create(EventCreate(
        type=EventType.CAMERA_ADDED,
        details={"name": data.name, "type": data.type, "ip": data.ip or "N/A"},
        severity=EventSeverity.INFO,
    ))

    return cam


@router.put("/{camera_id}", response_model=CameraModel)
def update_camera(camera_id: str, data: dict):
    """Update camera fields (name, room_id, enabled, ip)."""
    cam = CameraRepository.get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    old_ip = cam.ip
    old_name = cam.name
    old_enabled = cam.enabled

    updated = CameraRepository.update(camera_id, data)
    _rebuild_id_map()

    # If the camera's IP/URL, enabled status, or name changes, update the running pipeline
    if _pipeline:
        pipeline_id = resolve_camera_id(camera_id)
        config_ids = {c["id"] for c in get_config("cameras")}

        # Only modify the pipeline for dynamically added cameras
        if pipeline_id not in config_ids:
            # Check if fields changed
            ip_changed = "ip" in data and data["ip"] != old_ip
            enabled_changed = "enabled" in data and data["enabled"] != old_enabled
            name_changed = "name" in data and data["name"] != old_name

            if ip_changed or enabled_changed or name_changed:
                # Remove old stream if it exists in the pipeline
                _pipeline.remove_camera(pipeline_id)

                # Start new stream if enabled and has a source
                if updated.enabled:
                    from backend.vision.camera import CameraStream
                    vision_cfg = get_config("vision")
                    if updated.type == "ip" and updated.ip:
                        rtsp_url = _build_rtsp_url(updated.ip)
                        camera_stream = CameraStream(
                            camera_id=updated.id,
                            name=updated.name,
                            source=rtsp_url,
                            camera_type="ip",
                            target_fps=vision_cfg.get("target_fps", 25),
                        )
                        _pipeline.add_camera(camera_stream)
                    elif updated.type == "webcam":
                        try:
                            device_index = int(updated.ip) if updated.ip and updated.ip.isdigit() else 0
                        except (ValueError, TypeError):
                            device_index = 0
                        camera_stream = CameraStream(
                            camera_id=updated.id,
                            name=updated.name,
                            source=device_index,
                            camera_type="webcam",
                            target_fps=vision_cfg.get("target_fps", 25),
                        )
                        _pipeline.add_camera(camera_stream)

    return updated


@router.delete("/{camera_id}")
def delete_camera(camera_id: str):
    """Delete a camera and remove it from the vision pipeline."""
    cam = CameraRepository.get_by_id(camera_id)
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    if not CameraRepository.delete(camera_id):
        raise HTTPException(status_code=404, detail="Camera not found")

    if _pipeline:
        pipeline_id = resolve_camera_id(camera_id)

        # IMPORTANT: Never kill a config.yaml camera (e.g. cam_webcam) from the
        # pipeline just because the Firestore record was deleted. Config cameras
        # are permanent infrastructure managed by config.yaml — only the Firestore
        # record (the UI entry) is being removed. Dynamic cameras added at runtime
        # (their IDs are Firestore document IDs, not config IDs) are safe to stop.
        config_ids = {c["id"] for c in get_config("cameras")}
        if pipeline_id not in config_ids:
            _pipeline.remove_camera(pipeline_id)

    _rebuild_id_map()

    EventRepository.create(EventCreate(
        type=EventType.CAMERA_DELETED,
        details={"camera_id": camera_id, "name": cam.name, "type": cam.type},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "deleted", "camera_id": camera_id}

