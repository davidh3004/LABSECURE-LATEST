"""
LabSecure AI v2 — Camera Stream Abstraction
Thread-safe camera capture with auto-reconnect for IP cameras and webcams.
"""

import os
import time
import threading
import logging
from datetime import datetime, timezone
from typing import Optional

import cv2
import numpy as np

from backend.config import get_config

logger = logging.getLogger(__name__)


class CameraStream:
    """
    Thread-safe camera capture wrapper.
    Supports RTSP/HTTP IP cameras and local webcams.
    Runs frame grabbing in a background thread for non-blocking reads.
    """

    def __init__(
        self,
        camera_id: str,
        name: str,
        source,  # str (URL) or int (device index)
        camera_type: str = "ip",
        target_fps: int = 25,
        reconnect_delay: float = 2.0,
        max_reconnect_delay: float = 30.0,
    ):
        self.camera_id = camera_id
        self.name = name
        self.source = source
        self.camera_type = camera_type
        self.target_fps = target_fps
        self.reconnect_delay = reconnect_delay
        self.max_reconnect_delay = max_reconnect_delay

        self._cap: Optional[cv2.VideoCapture] = None
        self._frame: Optional[np.ndarray] = None
        self._frame_lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._watchdog_thread: Optional[threading.Thread] = None

        # Health metrics
        self._connected = False
        self._fps = 0.0
        self._last_frame_time: Optional[datetime] = None
        self._frame_count = 0
        self._fps_timer = time.time()

        # Watchdog: if no new frame arrives within this many seconds, force reconnect.
        # This unblocks a stalled _cap.read() by releasing the capture object.
        self._watchdog_timeout = 6.0

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def fps(self) -> float:
        return self._fps

    @property
    def last_frame_time(self) -> Optional[datetime]:
        return self._last_frame_time

    def start(self):
        """Start the background frame-grabbing thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._capture_loop, daemon=True)
        self._thread.start()
        # Watchdog monitors frame arrival to prevent silent stalls
        self._watchdog_thread = threading.Thread(target=self._watchdog_loop, daemon=True)
        self._watchdog_thread.start()
        logger.info(f"[{self.camera_id}] Camera stream started: {self.name}")

    def stop(self):
        """Stop the capture thread and release resources."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=5.0)
        if self._cap:
            self._cap.release()
            self._cap = None
        self._connected = False
        logger.info(f"[{self.camera_id}] Camera stream stopped: {self.name}")

    def read(self) -> Optional[np.ndarray]:
        """Get the latest frame (thread-safe). Returns reference (callers copy if needed)."""
        with self._frame_lock:
            return self._frame

    def get_health(self) -> dict:
        """Get camera health metrics."""
        return {
            "camera_id": self.camera_id,
            "name": self.name,
            "type": self.camera_type,
            "connected": self._connected,
            "fps": round(self._fps, 1),
            "last_frame_time": self._last_frame_time.isoformat() if self._last_frame_time else None,
        }

    def _connect(self) -> bool:
        """Attempt to open the video capture."""
        try:
            if self._cap:
                self._cap.release()

            if self.camera_type == "webcam":
                # On Windows, CAP_DSHOW is often required for stable webcam reading
                import platform
                backend = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
                self._cap = cv2.VideoCapture(self.source, backend)
                # Force HD presets to match IP camera quality bounds
                self._cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                self._cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                # Force MJPG codec to ensure high FPS delivery
                self._cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
            else:
                # Force TCP, disable buffering, and enable low delay for RTSP
                os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay"
                self._cap = cv2.VideoCapture(self.source, cv2.CAP_FFMPEG)
                self._cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                # Per-frame read timeout (OpenCV >= 4.5.3 / FFMPEG backend)
                # Prevents _cap.read() from blocking forever on a dead connection
                self._cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 5000)
                self._cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 5000)

            if self._cap.isOpened():
                self._connected = True
                logger.info(f"[{self.camera_id}] Connected to {self.source}")
                return True
            else:
                self._connected = False
                logger.warning(f"[{self.camera_id}] Failed to open {self.source}")
                return False
        except Exception as e:
            self._connected = False
            logger.error(f"[{self.camera_id}] Connection error: {e}")
            return False

    def _capture_loop(self):
        """Main capture loop running in background thread."""
        delay = self.reconnect_delay
        frame_interval = 1.0 / self.target_fps
        heartbeat_time = time.time()

        while self._running:
            # Connect if not connected
            if not self._connected or self._cap is None or not self._cap.isOpened():
                if not self._connect():
                    logger.info(f"[{self.camera_id}] Retrying in {delay:.1f}s...")
                    time.sleep(delay)
                    delay = min(delay * 1.5, self.max_reconnect_delay)
                    continue
                delay = self.reconnect_delay  # Reset on successful connect

            # Heartbeat log every 10s so we can tell which camera is alive
            now = time.time()
            if now - heartbeat_time >= 10.0:
                logger.debug(f"[{self.camera_id}] Capture heartbeat — fps={self._fps:.1f} connected={self._connected}")
                heartbeat_time = now

            # Grab frame — may block up to CAP_PROP_READ_TIMEOUT_MSEC (5s for IP)
            # or indefinitely for webcam. Watchdog covers IP cameras.
            frame_start = time.time()
            ret, frame = self._cap.read()

            if not ret or frame is None:
                self._connected = False
                logger.warning(f"[{self.camera_id}] Frame read failed after {time.time()-frame_start:.2f}s — reconnecting")
                continue

            # Update frame (thread-safe)
            with self._frame_lock:
                self._frame = frame

            self._last_frame_time = datetime.now(timezone.utc)
            self._frame_count += 1

            # Calculate FPS every second
            elapsed = time.time() - self._fps_timer
            if elapsed >= 1.0:
                self._fps = self._frame_count / elapsed
                self._frame_count = 0
                self._fps_timer = time.time()

            # No rate limiting sleep here for the capture thread.
            # Draining the OpenCV/FFmpeg buffer as fast as frames arrive
            # is critical to prevent RTSP stream lag and accumulation delay.

    def _watchdog_loop(self):
        """
        Monitors frame arrival for IP cameras.
        If _cap.read() blocks indefinitely (silent RTSP drop), releasing _cap
        from this thread unblocks the blocking read() in _capture_loop.
        """
        check_interval = 2.0
        while self._running:
            time.sleep(check_interval)
            if not self._connected or self._last_frame_time is None:
                continue
            age = (datetime.now(timezone.utc) - self._last_frame_time).total_seconds()
            if age > self._watchdog_timeout:
                logger.warning(
                    f"[{self.camera_id}] Watchdog: no frame for {age:.1f}s — "
                    f"releasing capture to unblock read()"
                )
                # Force-release: this unblocks a hanging _cap.read() in the capture thread
                cap = self._cap
                self._cap = None
                self._connected = False
                if cap:
                    try:
                        cap.release()
                    except Exception:
                        pass


def create_cameras_from_config() -> list[CameraStream]:
    """Create CameraStream instances from config.yaml."""
    cameras_config = get_config("cameras")
    vision_config = get_config("vision")
    target_fps = vision_config.get("target_fps", 25)
    cameras = []

    for cam_cfg in cameras_config:
        if not cam_cfg.get("enabled", True):
            continue

        cam_type = cam_cfg.get("type", "ip")
        source = cam_cfg.get("device_index", 0) if cam_type == "webcam" else cam_cfg.get("url", "")

        camera = CameraStream(
            camera_id=cam_cfg["id"],
            name=cam_cfg.get("name", cam_cfg["id"]),
            source=source,
            camera_type=cam_type,
            target_fps=target_fps,
        )
        cameras.append(camera)

    return cameras
