"""
LabSecure AI v2 — InsightFace Engine
Face detection, embedding extraction, and recognition with OpenVINO acceleration.
"""

import logging
import threading
from typing import Optional
import numpy as np

logger = logging.getLogger(__name__)


class FaceEngine:
    """
    Wraps InsightFace FaceAnalysis for detection and recognition.
    Supports OpenVINO (Intel), CUDA (NVIDIA), or CPU execution providers.
    """

    def __init__(
        self,
        provider: str = "openvino",
        detection_threshold: float = 0.5,
        recognition_threshold: float = 0.4,
        model_name: str = "buffalo_l",
        det_size: int = 640,
    ):
        self.provider = provider
        self.detection_threshold = detection_threshold
        self.recognition_threshold = recognition_threshold
        self.model_name = model_name
        self.det_size = (det_size, det_size)
        self._app = None
        self._initialized = False
        # Lock ensures only one inference runs at a time.
        # The detection thread and enrollment HTTP handlers share this engine;
        # without the lock they'd compete for the GIL and freeze the entire app.
        self._inference_lock = threading.Lock()

    def initialize(self):
        """Load InsightFace models with the configured execution provider."""
        if self._initialized:
            return

        try:
            import insightface
            from insightface.app import FaceAnalysis

            # Map provider strings to ONNX Runtime execution providers
            provider_map = {
                "openvino": ["OpenVINOExecutionProvider", "CPUExecutionProvider"],
                "cuda": ["CUDAExecutionProvider", "CPUExecutionProvider"],
                "cpu": ["CPUExecutionProvider"],
            }
            providers = provider_map.get(self.provider, ["CPUExecutionProvider"])

            self._app = FaceAnalysis(
                name=self.model_name,
                providers=providers,
            )
            self._app.prepare(ctx_id=0, det_size=self.det_size, det_thresh=self.detection_threshold)

            self._initialized = True
            logger.info(f"FaceEngine initialized: model={self.model_name}, det_size={self.det_size}, providers={providers}")

        except Exception as e:
            logger.error(f"Failed to initialize FaceEngine: {e}")
            logger.info("Falling back to CPU-only mode")
            try:
                import insightface
                from insightface.app import FaceAnalysis

                self._app = FaceAnalysis(
                    name=self.model_name,
                    providers=["CPUExecutionProvider"],
                )
                self._app.prepare(ctx_id=0, det_size=self.det_size, det_thresh=self.detection_threshold)
                self._initialized = True
                logger.info(f"FaceEngine initialized with CPU fallback: model={self.model_name}, det_size={self.det_size}")
            except Exception as e2:
                logger.error(f"FaceEngine CPU fallback also failed: {e2}")
                raise

    def detect(self, frame: np.ndarray) -> list[dict]:
        """
        Detect faces in a frame.
        Thread-safe: acquires the inference lock so only one call runs at a time.

        Returns:
            List of face dicts with keys: bbox, landmarks, embedding, det_score
        """
        if not self._initialized:
            self.initialize()

        with self._inference_lock:
            faces = self._app.get(frame)

        results = []
        for face in faces:
            bbox = face.bbox.astype(int).tolist()  # [x1, y1, x2, y2]
            centroid = (
                int((bbox[0] + bbox[2]) / 2),
                int((bbox[1] + bbox[3]) / 2),
            )
            result = {
                "bbox": bbox,
                "centroid": centroid,
                "landmarks": face.landmark_2d_106.tolist() if face.landmark_2d_106 is not None else None,
                "embedding": face.embedding,  # 512-d numpy array
                "det_score": float(face.det_score),
            }
            results.append(result)

        return results

    def compare(self, embedding1: np.ndarray, embedding2: np.ndarray) -> float:
        """Compute cosine similarity between two face embeddings."""
        if embedding1 is None or embedding2 is None:
            return 0.0
        if embedding1.shape != embedding2.shape:
            return 0.0  # Dimension mismatch (e.g. legacy 128-dim vs 512-dim) — skip
        norm1 = np.linalg.norm(embedding1)
        norm2 = np.linalg.norm(embedding2)
        if norm1 == 0 or norm2 == 0:
            return 0.0
        return float(np.dot(embedding1, embedding2) / (norm1 * norm2))

    def recognize(
        self,
        embedding: np.ndarray,
        database: dict[str, np.ndarray],
    ) -> tuple[Optional[str], float]:
        """
        Match an embedding against a database of known faces.

        Args:
            embedding: 512-d face embedding
            database: dict mapping user_id -> embedding (numpy array)

        Returns:
            (user_id or None, similarity_score)
        """
        best_match = None
        best_score = 0.0

        for user_id, db_embedding in database.items():
            score = self.compare(embedding, db_embedding)
            if score > best_score:
                best_score = score
                best_match = user_id

        logger.info(f"Match result: id={best_match}, score={best_score:.3f}, threshold={self.recognition_threshold}")
        if best_score >= self.recognition_threshold:
            return best_match, best_score
        return None, best_score

    def get_face_crop(self, frame: np.ndarray, bbox: list[int], padding: int = 20) -> np.ndarray:
        """Extract a padded face crop from the frame."""
        h, w = frame.shape[:2]
        x1 = max(0, bbox[0] - padding)
        y1 = max(0, bbox[1] - padding)
        x2 = min(w, bbox[2] + padding)
        y2 = min(h, bbox[3] + padding)
        return frame[y1:y2, x1:x2]
