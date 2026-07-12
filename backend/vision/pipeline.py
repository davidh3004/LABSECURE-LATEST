"""
LabSecure AI v2 — Vision Pipeline Orchestrator
Multi-threaded stream processing with decoupled detection and display.

Architecture:
  - Display thread: reads frames at full camera FPS, overlays cached annotations
  - Detection thread: runs face analysis independently, updates shared annotation cache
  This ensures smooth video regardless of detection speed.
"""

import time
import queue
import logging
import threading
from typing import Optional

import cv2
import numpy as np

from backend.config import get_config
from backend.vision.camera import CameraStream, create_cameras_from_config
from backend.vision.face_engine import FaceEngine
from backend.vision.liveness import LivenessDetector
from backend.vision.tracker import CentroidTracker

logger = logging.getLogger(__name__)


class AnnotatedFrame:
    """Container for a processed frame with metadata."""

    def __init__(self, camera_id: str, frame: np.ndarray, faces: list[dict], timestamp: float, quality: int = 70):
        self.camera_id = camera_id
        self.frame = frame
        self.faces = faces
        self.timestamp = timestamp
        self._quality = quality
        self._jpeg: Optional[bytes] = None

    def to_jpeg(self) -> bytes:
        """Encode annotated frame as JPEG bytes."""
        if self._jpeg is None:
            _, buffer = cv2.imencode(".jpg", self.frame, [cv2.IMWRITE_JPEG_QUALITY, self._quality])
            self._jpeg = buffer.tobytes()
        return self._jpeg


class VisionPipeline:
    """
    Orchestrates multi-camera face processing pipeline.

    Uses a decoupled architecture: each camera gets two threads:
    - Display thread: reads frames and pushes annotated output at full FPS
    - Detection thread: runs face analysis independently without blocking display
    """

    def __init__(
        self,
        face_database: Optional[dict[str, np.ndarray]] = None,
        user_info: Optional[dict[str, dict]] = None,
        on_access_event=None,  # Callback: (camera_id, user_id, decision) -> None
    ):
        """
        Args:
            face_database: Dict of user_id -> face embedding (numpy array).
            user_info: Dict of user_id -> {name, role, ...} for annotation.
            on_access_event: Callback for access events.
        """
        self.face_database = face_database or {}
        self.user_info = user_info or {}
        self.on_access_event = on_access_event

        # Load config
        vision_cfg = get_config("vision")
        tracker_cfg = get_config("tracker")

        # Initialize components
        self.face_engine = FaceEngine(
            provider=vision_cfg.get("execution_provider", "cpu"),
            detection_threshold=vision_cfg.get("detection_threshold", 0.5),
            recognition_threshold=vision_cfg.get("recognition_threshold", 0.4),
            model_name=vision_cfg.get("model_name", "buffalo_l"),
            det_size=vision_cfg.get("det_size", 640),
        )
        self.liveness_detector = LivenessDetector.from_config()

        self._recognition_interval = vision_cfg.get("recognition_interval_frames", 8)
        self._tracker_max_disappeared = tracker_cfg.get("max_disappeared_frames", 50)
        self._tracker_max_distance = tracker_cfg.get("max_distance", 75)
        self._display_fps = vision_cfg.get("target_fps", 15)
        self._stream_width = vision_cfg.get("stream_width", 640)
        self._stream_quality = vision_cfg.get("stream_quality", 60)

        # Per-camera state
        self._cameras: list[CameraStream] = []
        self._trackers: dict[str, CentroidTracker] = {}
        self._threads: dict[str, list[threading.Thread]] = {}
        self._frame_queues: dict[str, queue.Queue] = {}

        # Shared detection state per camera
        self._latest_annotations: dict[str, list[dict]] = {}
        self._annotation_locks: dict[str, threading.Lock] = {}
        self._detection_frames: dict[str, Optional[np.ndarray]] = {}
        self._detection_frame_locks: dict[str, threading.Lock] = {}

        # Latest frame cache per camera (for snapshot endpoint, never consumed)
        self._latest_frame_cache: dict[str, 'AnnotatedFrame'] = {}
        # Latest raw frame (no overlays, full resolution) — used for enrollment
        # photo capture from backend cameras.
        self._latest_raw_frame_cache: dict[str, np.ndarray] = {}

        # Shared output queue for WebSocket broadcast
        self.output_queue: queue.Queue = queue.Queue(maxsize=30)

        self._running = False

    def start(self):
        """Initialize cameras and start processing threads."""
        if self._running:
            return

        logger.info("Starting Vision Pipeline (decoupled mode)...")

        # Initialize face engine
        try:
            self.face_engine.initialize()
        except Exception as e:
            logger.error(f"Failed to initialize face engine: {e}")
            logger.warning("Pipeline will run without face recognition")

        # Create cameras from config
        self._cameras = create_cameras_from_config()

        self._running = True

        for camera in self._cameras:
            cam_id = camera.camera_id

            # Create per-camera tracker
            self._trackers[cam_id] = CentroidTracker(
                max_disappeared=self._tracker_max_disappeared,
                max_distance=self._tracker_max_distance,
            )

            # Create per-camera output queue
            self._frame_queues[cam_id] = queue.Queue(maxsize=5)

            # Initialize shared state
            self._latest_annotations[cam_id] = []
            self._annotation_locks[cam_id] = threading.Lock()
            self._detection_frames[cam_id] = None
            self._detection_frame_locks[cam_id] = threading.Lock()

            # Start camera stream
            camera.start()

            # Start display thread (full FPS frame delivery)
            display_thread = threading.Thread(
                target=self._display_loop,
                args=(camera,),
                daemon=True,
            )
            display_thread.start()

            # Start detection thread (runs at its own pace)
            detection_thread = threading.Thread(
                target=self._detection_loop,
                args=(camera,),
                daemon=True,
            )
            detection_thread.start()

            self._threads[cam_id] = [display_thread, detection_thread]

        logger.info(f"Vision Pipeline started with {len(self._cameras)} cameras")

    def stop(self):
        """Stop all cameras and processing threads."""
        self._running = False

        for camera in self._cameras:
            camera.stop()

        for threads in self._threads.values():
            for thread in threads:
                thread.join(timeout=5.0)

        self._threads.clear()
        self._frame_queues.clear()
        logger.info("Vision Pipeline stopped")

    def get_latest_frame(self, camera_id: str) -> Optional[AnnotatedFrame]:
        """Get the latest annotated frame for a camera."""
        q = self._frame_queues.get(camera_id)
        if q is None:
            return None
        try:
            return q.get_nowait()
        except queue.Empty:
            return None

    def get_snapshot(self, camera_id: str) -> Optional['AnnotatedFrame']:
        """Get the latest frame without consuming from the queue (for HTTP snapshot)."""
        return self._latest_frame_cache.get(camera_id)

    def get_raw_snapshot_jpeg(self, camera_id: str, quality: int = 90) -> Optional[bytes]:
        """Get the latest raw frame (no annotation overlays, full resolution) as JPEG."""
        frame = self._latest_raw_frame_cache.get(camera_id)
        if frame is None:
            return None
        _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
        return buffer.tobytes()

    def get_camera_health(self) -> list[dict]:
        """Get health status for all cameras."""
        return [cam.get_health() for cam in self._cameras]

    def add_camera(self, camera: CameraStream):
        """Dynamically add and start a new camera in the running pipeline."""
        cam_id = camera.camera_id
        if cam_id in self._frame_queues:
            logger.warning(f"[{cam_id}] Camera already exists in pipeline, skipping")
            return

        self._trackers[cam_id] = CentroidTracker(
            max_disappeared=self._tracker_max_disappeared,
            max_distance=self._tracker_max_distance,
        )
        self._frame_queues[cam_id] = queue.Queue(maxsize=5)
        self._latest_annotations[cam_id] = []
        self._annotation_locks[cam_id] = threading.Lock()
        self._detection_frames[cam_id] = None
        self._detection_frame_locks[cam_id] = threading.Lock()

        self._cameras.append(camera)
        camera.start()

        display_thread = threading.Thread(target=self._display_loop, args=(camera,), daemon=True)
        detection_thread = threading.Thread(target=self._detection_loop, args=(camera,), daemon=True)
        display_thread.start()
        detection_thread.start()
        self._threads[cam_id] = [display_thread, detection_thread]

        logger.info(f"[{cam_id}] Camera '{camera.name}' dynamically added to pipeline")

    def remove_camera(self, camera_id: str):
        """Dynamically stop and remove a camera from the running pipeline."""
        camera = next((c for c in self._cameras if c.camera_id == camera_id), None)
        if camera is None:
            return

        camera.stop()
        self._cameras = [c for c in self._cameras if c.camera_id != camera_id]

        # Removing from _frame_queues signals the display/detection threads to stop
        self._frame_queues.pop(camera_id, None)
        self._latest_frame_cache.pop(camera_id, None)
        self._latest_raw_frame_cache.pop(camera_id, None)
        self._latest_annotations.pop(camera_id, None)
        self._annotation_locks.pop(camera_id, None)
        self._detection_frames.pop(camera_id, None)
        self._detection_frame_locks.pop(camera_id, None)
        self._trackers.pop(camera_id, None)
        self._threads.pop(camera_id, None)

        logger.info(f"[{camera_id}] Camera removed from pipeline")

    def update_database(self, face_database: dict[str, np.ndarray], user_info: dict[str, dict]):
        """Update the face database and user info (thread-safe via dict replacement).
        Only accepts 512-dim embeddings compatible with InsightFace."""
        EXPECTED_DIM = 512
        filtered = {uid: emb for uid, emb in face_database.items() if emb.shape[0] == EXPECTED_DIM}
        skipped = len(face_database) - len(filtered)
        if skipped:
            logger.warning(f"update_database: skipped {skipped} descriptor(s) with wrong dimensions (expected {EXPECTED_DIM}-dim).")
        self.face_database = filtered
        self.user_info = user_info


    # ── Display Thread ────────────────────────────────────────

    def _display_loop(self, camera: CameraStream):
        """
        Reads frames at full camera FPS, overlays cached annotations,
        and pushes to WebSocket queues. Never blocked by detection.
        """
        cam_id = camera.camera_id
        frame_interval = 1.0 / self._display_fps
        heartbeat_time = time.time()
        frames_sent = 0

        logger.info(f"[{cam_id}] Display thread started ({self._display_fps} FPS)")

        while self._running and cam_id in self._frame_queues:
            loop_start = time.time()

            frame = camera.read()
            if frame is None:
                time.sleep(0.01)
                continue

            # Heartbeat: logs every 10s so we can verify display loop is alive and measure actual FPS
            frames_sent += 1
            now = time.time()
            if now - heartbeat_time >= 10.0:
                actual_fps = frames_sent / (now - heartbeat_time)
                logger.debug(f"[{cam_id}] Display heartbeat — actual={actual_fps:.1f}fps cam_fps={camera.fps:.1f}")
                heartbeat_time = now
                frames_sent = 0

            timestamp = time.time()

            # Submit frame for detection (non-blocking overwrite)
            with self._detection_frame_locks[cam_id]:
                self._detection_frames[cam_id] = frame

            # Cache raw frame before any overlays/downscaling (for enrollment capture)
            self._latest_raw_frame_cache[cam_id] = frame

            # Read cached annotations (non-blocking)
            with self._annotation_locks[cam_id]:
                annotations = list(self._latest_annotations[cam_id])

            # Draw annotations on current frame
            annotated_frame = self._draw_annotations(frame, annotations)

            # Downscale for streaming — reduces JPEG encode time ~4x on CPU
            h, w = annotated_frame.shape[:2]
            if w > self._stream_width:
                scale = self._stream_width / w
                annotated_frame = cv2.resize(
                    annotated_frame,
                    (self._stream_width, int(h * scale)),
                    interpolation=cv2.INTER_LINEAR,
                )

            # Push to queues
            af = AnnotatedFrame(cam_id, annotated_frame, annotations, timestamp, quality=self._stream_quality)

            # Cache latest frame (for snapshot endpoint)
            self._latest_frame_cache[cam_id] = af

            # Per-camera queue (drop old frames)
            q = self._frame_queues.get(cam_id)
            if q:
                while not q.empty():
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        break
                q.put(af)

            # Global output queue
            try:
                self.output_queue.put_nowait(af)
            except queue.Full:
                try:
                    self.output_queue.get_nowait()
                    self.output_queue.put_nowait(af)
                except queue.Empty:
                    pass

            # Rate limit to target display FPS
            elapsed = time.time() - loop_start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

        logger.info(f"[{cam_id}] Display thread stopped")

    # ── Detection Thread ──────────────────────────────────────

    def _detection_loop(self, camera: CameraStream):
        """
        Runs face detection, recognition, and liveness analysis on the latest
        frame. Updates shared annotations cache. Runs as fast as the CPU allows
        without blocking the display thread.
        """
        cam_id = camera.camera_id
        tracker = self._trackers[cam_id]
        detection_count = 0
        heartbeat_time = time.time()
        last_empty_db_warning = 0.0

        logger.info(f"[{cam_id}] Detection thread started")

        while self._running and cam_id in self._frame_queues:
            # Grab the latest frame (non-blocking swap)
            # Copy because the display thread draws annotations in-place on the
            # same underlying array.  This is the only array copy in the hot path.
            with self._detection_frame_locks[cam_id]:
                raw = self._detection_frames[cam_id]
                self._detection_frames[cam_id] = None
                frame = raw.copy() if raw is not None else None

            if frame is None:
                time.sleep(0.05)
                continue

            detection_count += 1

            # Heartbeat every 10s
            now = time.time()
            if now - heartbeat_time >= 10.0:
                logger.debug(f"[{cam_id}] Detection heartbeat — cycles={detection_count} in last 10s")
                heartbeat_time = now
                detection_count = 0

            try:
                # Step 1: Detect faces
                faces = self.face_engine.detect(frame)

                # Step 2: Update tracker with centroids
                centroids = [f["centroid"] for f in faces]
                tracked = tracker.update(centroids)

                # Step 3: Process each tracked face
                annotated_faces = []
                for i, (track_id, centroid, is_new) in enumerate(tracked):
                    face_data = self._find_face_for_centroid(faces, centroid)
                    if face_data is None:
                        continue

                    identity = tracker.get_identity(track_id)

                    # Run recognition for new faces or periodically
                    if is_new or (identity is None and detection_count % self._recognition_interval == 0):
                        embedding = face_data.get("embedding")
                        if embedding is None:
                            logger.warning(f"[{cam_id}] Face embedding is None!")
                        elif not self.face_database:
                            # Rate-limit: this fires on every recognition attempt, so
                            # without throttling it floods the log several times per second.
                            if now - last_empty_db_warning >= 30.0:
                                logger.warning(
                                    f"[{cam_id}] Face database is empty — no users enrolled with "
                                    f"512-dim descriptors. Enroll faces via the Users page. "
                                    f"(This warning is shown at most once every 30s.)"
                                )
                                last_empty_db_warning = now
                        else:
                            compatible_db = {
                                uid: db_emb
                                for uid, db_emb in self.face_database.items()
                                if db_emb.shape == embedding.shape
                            }
                            if not compatible_db:
                                logger.warning(f"[{cam_id}] Shape Mismatch in Database vs Frame")
                            else:
                                user_id, confidence = self.face_engine.recognize(
                                    embedding,
                                    compatible_db,
                                )

                                info = self.user_info.get(user_id, {}) if user_id else {}
                                identity = {
                                    "user_id": user_id,
                                    "name": info.get("name", "Unknown"),
                                    "role": info.get("role", "unknown"),
                                    "confidence": confidence,
                                    "status": "recognized" if user_id else "unknown",
                                }
                                tracker.set_identity(track_id, identity)

                                # Trigger access event callback
                                if self.on_access_event and user_id:
                                    self.on_access_event(cam_id, user_id, identity)

                    # Run liveness check (EVERY FRAME)
                    face_crop = self.face_engine.get_face_crop(frame, face_data["bbox"])
                    if face_crop is not None:
                        is_live, liveness_score = self.liveness_detector.check(face_crop)
                    else:
                        is_live, liveness_score = True, 1.0  # Fallback

                    current_identity = tracker.get_identity(track_id)
                    if current_identity:
                        current_identity["is_live"] = is_live
                        current_identity["liveness_score"] = liveness_score
                        if not is_live:
                            current_identity["status"] = "spoof"
                        elif current_identity.get("status") == "spoof":
                            # Restore previous verified state
                            current_identity["status"] = "recognized" if current_identity.get("user_id") else "unknown"
                        tracker.set_identity(track_id, current_identity)

                    # Build annotation data
                    annotation = {
                        "track_id": track_id,
                        "bbox": face_data["bbox"],
                        "centroid": centroid,
                        "identity": identity or {"name": "Detecting...", "status": "pending"},
                    }
                    annotated_faces.append(annotation)

                # Update shared annotations (thread-safe)
                with self._annotation_locks[cam_id]:
                    self._latest_annotations[cam_id] = annotated_faces

                # buffalo_sc at det_size=320 runs ~50-100ms on CPU.
                # A short sleep keeps API threads responsive without wasting cycles.
                time.sleep(0.08)

            except Exception as e:
                logger.error(f"[{cam_id}] Detection error: {e}", exc_info=True)
                time.sleep(0.2)

        logger.info(f"[{cam_id}] Detection thread stopped")

    # ── Helpers ────────────────────────────────────────────────

    def _find_face_for_centroid(self, faces: list[dict], centroid: tuple) -> Optional[dict]:
        """Find the detected face closest to a given centroid."""
        if not faces:
            return None

        min_dist = float("inf")
        closest = None

        for face in faces:
            fc = face["centroid"]
            d = ((fc[0] - centroid[0]) ** 2 + (fc[1] - centroid[1]) ** 2) ** 0.5
            if d < min_dist:
                min_dist = d
                closest = face

        return closest if min_dist < 100 else None

    def _draw_annotations(self, frame: np.ndarray, faces: list[dict]) -> np.ndarray:
        """Draw bounding boxes, names, roles, and status on the frame."""
        annotated = frame.copy()

        for face in faces:
            bbox = face["bbox"]
            identity = face.get("identity", {})
            name = identity.get("name", "?")
            role = identity.get("role", "")
            status = identity.get("status", "pending")
            is_live = identity.get("is_live", None)

            # Color based on status
            if status == "recognized" and is_live:
                color = (0, 200, 100)     # Green — recognized + live
            elif status == "recognized" and not is_live:
                color = (0, 165, 255)     # Orange — recognized but not live
            elif status == "unknown":
                color = (0, 0, 220)       # Red — unknown
            else:
                color = (200, 200, 200)   # Gray — pending

            # Bounding box
            cv2.rectangle(annotated, (bbox[0], bbox[1]), (bbox[2], bbox[3]), color, 2)

            # Label background
            label = f"{name}"
            if role and role != "unknown":
                label += f" [{role}]"

            liveness_label = "LIVE" if is_live else "SPOOF" if is_live is not None else ""
            (lw, lh), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)

            cv2.rectangle(
                annotated,
                (bbox[0], bbox[1] - lh - 16),
                (bbox[0] + lw + 10, bbox[1]),
                color,
                -1,
            )
            cv2.putText(
                annotated, label,
                (bbox[0] + 5, bbox[1] - 8),
                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA,
            )

            # Liveness label below bbox
            if liveness_label:
                l_color = (0, 200, 100) if is_live else (0, 0, 220)
                cv2.putText(
                    annotated, liveness_label,
                    (bbox[0] + 5, bbox[3] + 18),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, l_color, 1, cv2.LINE_AA,
                )

        return annotated
