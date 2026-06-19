"""
LabSecure AI v2 — Liveness Detection (Anti-Spoofing)
Multi-signal analysis to distinguish real faces from photos/screens.
"""

import logging
import cv2
import numpy as np

from backend.config import get_config

logger = logging.getLogger(__name__)


class LivenessDetector:
    """
    Multi-signal liveness detector using texture, edge, and color analysis.
    Detects printed photos, digital screen presentations, and flat surfaces.
    """

    def __init__(
        self,
        lbp_weight: float = 0.4,
        edge_weight: float = 0.3,
        color_weight: float = 0.3,
        threshold: float = 0.6,
        min_face_size: int = 80,
    ):
        self.lbp_weight = lbp_weight
        self.edge_weight = edge_weight
        self.color_weight = color_weight
        self.threshold = threshold
        self.min_face_size = min_face_size

    @classmethod
    def from_config(cls) -> "LivenessDetector":
        """Create from config.yaml."""
        liveness_cfg = get_config("liveness")
        vision_cfg = get_config("vision")
        return cls(
            lbp_weight=liveness_cfg.get("lbp_weight", 0.4),
            edge_weight=liveness_cfg.get("edge_weight", 0.3),
            color_weight=liveness_cfg.get("color_weight", 0.3),
            threshold=vision_cfg.get("liveness_threshold", 0.6),
            min_face_size=liveness_cfg.get("min_face_size", 80),
        )

    def check(self, face_crop: np.ndarray) -> tuple[bool, float]:
        """
        Analyze a face crop for liveness.

        Args:
            face_crop: BGR face image (cropped from frame).

        Returns:
            (is_live, confidence_score) where score is 0.0-1.0
        """
        if face_crop is None or face_crop.size == 0:
            return False, 0.0

        h, w = face_crop.shape[:2]
        if h < self.min_face_size or w < self.min_face_size:
            logger.debug("Face crop too small for reliable liveness detection")
            return False, 0.0

        # Resize for consistent analysis
        face = cv2.resize(face_crop, (128, 128))

        # Signal 1: Texture analysis (LBP histogram)
        texture_score = self._analyze_texture(face)

        # Signal 2: Edge density (Laplacian)
        edge_score = self._analyze_edges(face)

        # Signal 3: Color distribution (YCbCr)
        color_score = self._analyze_color(face)

        # Weighted combination
        combined = (
            self.lbp_weight * texture_score
            + self.edge_weight * edge_score
            + self.color_weight * color_score
        )

        is_live = combined >= self.threshold
        return is_live, round(combined, 4)

    def _analyze_texture(self, face: np.ndarray) -> float:
        """
        LBP-based texture analysis (vectorized).
        Real faces have richer micro-texture patterns than flat prints or screens.
        """
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)

        # Vectorized LBP: compare each pixel's 8 neighbors against center
        center = gray[1:-1, 1:-1]
        lbp = (
            ((gray[:-2, :-2] >= center).astype(np.uint8) << 7) |
            ((gray[:-2, 1:-1] >= center).astype(np.uint8) << 6) |
            ((gray[:-2, 2:]  >= center).astype(np.uint8) << 5) |
            ((gray[1:-1, 2:]  >= center).astype(np.uint8) << 4) |
            ((gray[2:, 2:]  >= center).astype(np.uint8) << 3) |
            ((gray[2:, 1:-1] >= center).astype(np.uint8) << 2) |
            ((gray[2:, :-2] >= center).astype(np.uint8) << 1) |
            ((gray[1:-1, :-2] >= center).astype(np.uint8))
        )

        # Histogram entropy as texture richness measure
        hist, _ = np.histogram(lbp.ravel(), bins=256, range=(0, 256))
        hist = hist.astype(np.float64)
        hist = hist / (hist.sum() + 1e-7)
        entropy = -np.sum(hist * np.log2(hist + 1e-7))

        # Normalize entropy to [0, 1] (max entropy for 256 bins is 8)
        normalized = min(entropy / 7.0, 1.0)
        return normalized

    def _analyze_edges(self, face: np.ndarray) -> float:
        """
        Edge density via Laplacian variance.
        Screens produce moiré patterns → higher focused edges in regular patterns.
        Printed photos have less depth variation.
        Real faces have natural, varied edge distributions.
        """
        gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
        laplacian = cv2.Laplacian(gray, cv2.CV_64F)
        variance = laplacian.var()

        # Good range for real faces: 100-800
        # Flat images: <50, Screens: >1000 (moiré)
        if variance < 20:
            return 0.1  # Too flat (likely printed photo)
        elif variance > 1200:
            return 0.3  # Possible screen moiré
        else:
            # Normalize to sweet spot
            if variance < 100:
                return 0.3 + 0.4 * (variance - 20) / 80
            elif variance > 800:
                return 0.7 - 0.3 * (variance - 800) / 400
            else:
                return 0.7 + 0.3 * min((variance - 100) / 700, 1.0)

    def _analyze_color(self, face: np.ndarray) -> float:
        """
        Color analysis in YCbCr space.
        Screens have different chrominance distribution than real skin.
        Real skin has characteristic Cb/Cr ranges.
        """
        ycrcb = cv2.cvtColor(face, cv2.COLOR_BGR2YCrCb)
        y, cr, cb = cv2.split(ycrcb)

        # Real skin Cr range: ~133-173, Cb range: ~77-127
        cr_mean = cr.mean()
        cb_mean = cb.mean()
        cr_std = cr.std()
        cb_std = cb.std()

        # Score based on how close to typical skin distribution
        cr_score = 1.0 - min(abs(cr_mean - 153) / 40, 1.0)
        cb_score = 1.0 - min(abs(cb_mean - 102) / 40, 1.0)

        # Standard deviation check — real faces have more variation
        std_score = min((cr_std + cb_std) / 40, 1.0)

        # Y-channel variation (depth/lighting variation on real faces)
        y_std = y.std()
        y_score = min(y_std / 50, 1.0)

        combined = 0.3 * cr_score + 0.3 * cb_score + 0.2 * std_score + 0.2 * y_score
        return combined
