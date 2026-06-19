"""
LabSecure AI v2 — WebSocket Live Feed
Streams annotated JPEG frames to the frontend dashboard.
"""

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["Live Feed"])

logger = logging.getLogger(__name__)

# Reference set by main.py at startup
_pipeline = None


def set_pipeline(pipeline):
    global _pipeline
    _pipeline = pipeline


def _resolve_camera_id(camera_id: str) -> str:
    """Resolve a Firestore camera ID to a pipeline camera ID using the shared map."""
    from backend.api.cameras import resolve_camera_id
    return resolve_camera_id(camera_id)


class ConnectionManager:
    """Manages active WebSocket connections per camera."""

    def __init__(self):
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, camera_id: str):
        await websocket.accept()
        if camera_id not in self.active_connections:
            self.active_connections[camera_id] = []
        self.active_connections[camera_id].append(websocket)

    def disconnect(self, websocket: WebSocket, camera_id: str):
        if camera_id in self.active_connections:
            self.active_connections[camera_id] = [
                ws for ws in self.active_connections[camera_id] if ws != websocket
            ]


manager = ConnectionManager()


@router.websocket("/ws/feed/{camera_id}")
async def feed_websocket(websocket: WebSocket, camera_id: str):
    """
    WebSocket endpoint for live camera feed.
    Streams annotated JPEG frames as binary messages.
    Uses the snapshot cache (never consumed) for reliable frame access.
    """
    # Resolve Firestore camera ID to pipeline camera ID
    pipeline_camera_id = _resolve_camera_id(camera_id)
    if pipeline_camera_id != camera_id:
        logger.info(f"Camera ID mapped: {camera_id} -> {pipeline_camera_id}")

    await manager.connect(websocket, camera_id)

    last_timestamp = 0.0  # Track last sent frame to avoid duplicates

    try:
        while True:
            if _pipeline is None:
                await asyncio.sleep(0.1)
                continue

            # Use snapshot cache (non-consuming) instead of queue
            frame = _pipeline.get_snapshot(pipeline_camera_id)

            if frame and frame.timestamp > last_timestamp:
                last_timestamp = frame.timestamp
                jpeg_bytes = frame.to_jpeg()
                await websocket.send_bytes(jpeg_bytes)
            else:
                await asyncio.sleep(0.04)  # ~25fps polling

    except WebSocketDisconnect:
        manager.disconnect(websocket, camera_id)
    except Exception as e:
        logger.error(f"WebSocket error for {camera_id}: {e}")
        manager.disconnect(websocket, camera_id)
