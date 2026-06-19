"""
LabSecure AI v2 — Anomaly Detection
Detects unknown faces appearing across multiple cameras within a time window.
"""

import time
import logging
import threading
from collections import defaultdict
from typing import Optional

import numpy as np

from backend.config import get_config
from backend.db.schemas import EventCreate, EventType, EventSeverity
from backend.db.repositories import EventRepository

logger = logging.getLogger(__name__)


class AnomalyDetector:
    """
    Monitors for unknown face detections across cameras.
    If the same unknown face appears on 2+ cameras within a configurable window,
    triggers a critical anomaly alert.
    """

    def __init__(
        self,
        multi_camera_window: float = 60.0,
        alert_threshold: int = 2,
        cooldown: float = 300.0,
        similarity_threshold: float = 0.5,
    ):
        self.multi_camera_window = multi_camera_window
        self.alert_threshold = alert_threshold
        self.cooldown = cooldown
        self.similarity_threshold = similarity_threshold

        # Stores: list of (timestamp, camera_id, embedding)
        self._unknown_detections: list[tuple[float, str, np.ndarray]] = []
        self._last_alert_time: float = 0.0
        self._lock = threading.Lock()

        # Callback for alert notifications (e.g., FCM push)
        self.on_alert = None

    @classmethod
    def from_config(cls) -> "AnomalyDetector":
        cfg = get_config("anomaly")
        return cls(
            multi_camera_window=cfg.get("multi_camera_window_seconds", 60),
            alert_threshold=cfg.get("unknown_face_alert_threshold", 2),
            cooldown=cfg.get("cooldown_seconds", 300),
        )

    def report_unknown(self, camera_id: str, embedding: Optional[np.ndarray] = None):
        """
        Report an unknown face detection.
        
        Args:
            camera_id: Which camera detected the unknown face.
            embedding: Face embedding for cross-camera matching (optional).
        """
        now = time.time()

        with self._lock:
            # Clean old detections
            self._unknown_detections = [
                (t, c, e) for t, c, e in self._unknown_detections
                if now - t < self.multi_camera_window
            ]

            # Add new detection
            self._unknown_detections.append((now, camera_id, embedding))

            # Check for multi-camera anomaly
            self._check_anomaly(now, camera_id, embedding)

    def _check_anomaly(self, now: float, camera_id: str, embedding: Optional[np.ndarray]):
        """Check if current detection triggers an anomaly alert."""
        # Cooldown check
        if now - self._last_alert_time < self.cooldown:
            return

        if embedding is None:
            # Without embeddings, just count unique cameras for any unknown
            unique_cameras = set(c for _, c, _ in self._unknown_detections)
            if len(unique_cameras) >= self.alert_threshold:
                self._trigger_alert(unique_cameras, now)
            return

        # With embeddings, check if this specific face appeared on multiple cameras
        matching_cameras = set()
        for t, c, e in self._unknown_detections:
            if e is not None and self._compare_embeddings(embedding, e) >= self.similarity_threshold:
                matching_cameras.add(c)

        if len(matching_cameras) >= self.alert_threshold:
            self._trigger_alert(matching_cameras, now)

    def _compare_embeddings(self, e1: np.ndarray, e2: np.ndarray) -> float:
        """Cosine similarity between two embeddings."""
        norm1 = np.linalg.norm(e1)
        norm2 = np.linalg.norm(e2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(e1, e2) / (norm1 * norm2))

    def _trigger_alert(self, cameras: set[str], now: float):
        """Fire an anomaly alert."""
        self._last_alert_time = now

        logger.critical(
            f"ANOMALY ALERT: Unknown face detected on {len(cameras)} cameras: {cameras}"
        )

        # Log event
        try:
            EventRepository.create(EventCreate(
                type=EventType.ANOMALY_ALERT,
                camera_id=",".join(cameras),
                details={
                    "cameras": list(cameras),
                    "message": f"Unknown face detected across {len(cameras)} cameras within {self.multi_camera_window}s window",
                },
                severity=EventSeverity.CRITICAL,
            ))
        except Exception as e:
            logger.error(f"Failed to log anomaly event: {e}")

        # FCM notification callback
        if self.on_alert:
            try:
                self.on_alert({
                    "type": "anomaly_alert",
                    "cameras": list(cameras),
                    "timestamp": now,
                })
            except Exception as e:
                logger.error(f"Anomaly alert callback failed: {e}")
