"""
LabSecure AI v2 — Centroid Face Tracker
Tracks face identities across frames using centroid distance matching.
Avoids re-running expensive recognition on every frame.
"""

import logging
from collections import OrderedDict
from typing import Optional

import numpy as np
from scipy.spatial import distance as dist

logger = logging.getLogger(__name__)


class CentroidTracker:
    """
    Centroid-based object tracker for maintaining face identities across frames.
    
    When a new centroid appears, it's marked as 'new' (needs recognition).
    Existing tracked centroids maintain their assigned identity.
    """

    def __init__(self, max_disappeared: int = 50, max_distance: float = 75.0):
        """
        Args:
            max_disappeared: Remove a tracked face after this many consecutive frames without detection.
            max_distance: Maximum pixel distance to consider a centroid as the same face.
        """
        self.max_disappeared = max_disappeared
        self.max_distance = max_distance

        self._next_id = 0
        self._objects: OrderedDict[int, np.ndarray] = OrderedDict()  # track_id -> centroid
        self._disappeared: OrderedDict[int, int] = OrderedDict()     # track_id -> frame count
        self._identities: dict[int, dict] = {}                       # track_id -> identity info

    @property
    def tracked_objects(self) -> dict[int, dict]:
        """Get all currently tracked objects with their centroids and identities."""
        result = {}
        for track_id, centroid in self._objects.items():
            result[track_id] = {
                "centroid": centroid.tolist(),
                "identity": self._identities.get(track_id),
            }
        return result

    def register(self, centroid: tuple, identity: Optional[dict] = None) -> int:
        """
        Register a new object with its centroid.
        
        Returns:
            The assigned tracking ID.
        """
        track_id = self._next_id
        self._objects[track_id] = np.array(centroid)
        self._disappeared[track_id] = 0
        if identity:
            self._identities[track_id] = identity
        self._next_id += 1
        return track_id

    def deregister(self, track_id: int):
        """Remove a tracked object."""
        del self._objects[track_id]
        del self._disappeared[track_id]
        self._identities.pop(track_id, None)

    def set_identity(self, track_id: int, identity: dict):
        """Assign or update the identity for a tracked face."""
        self._identities[track_id] = identity

    def get_identity(self, track_id: int) -> Optional[dict]:
        """Get the identity for a tracked face."""
        return self._identities.get(track_id)

    def update(self, centroids: list[tuple]) -> list[tuple[int, tuple, bool]]:
        """
        Update tracker with new frame centroids.
        
        Args:
            centroids: List of (x, y) centroid positions from face detection.
            
        Returns:
            List of (track_id, centroid, is_new) tuples.
            is_new=True means this face needs recognition.
        """
        results = []

        # If no detections, mark all existing objects as disappeared
        if len(centroids) == 0:
            for track_id in list(self._disappeared.keys()):
                self._disappeared[track_id] += 1
                if self._disappeared[track_id] > self.max_disappeared:
                    self.deregister(track_id)
            return results

        input_centroids = np.array(centroids)

        # If no existing objects, register all new centroids
        if len(self._objects) == 0:
            for centroid in centroids:
                track_id = self.register(centroid)
                results.append((track_id, centroid, True))
            return results

        # Compute distance matrix between existing and new centroids
        object_ids = list(self._objects.keys())
        object_centroids = list(self._objects.values())

        D = dist.cdist(np.array(object_centroids), input_centroids)

        # Find min distance assignments (Hungarian-like greedy)
        rows = D.min(axis=1).argsort()
        cols = D.argmin(axis=1)[rows]

        used_rows = set()
        used_cols = set()

        for row, col in zip(rows, cols):
            if row in used_rows or col in used_cols:
                continue

            # Check distance threshold
            if D[row, col] > self.max_distance:
                continue

            track_id = object_ids[row]
            self._objects[track_id] = input_centroids[col]
            self._disappeared[track_id] = 0
            results.append((track_id, tuple(input_centroids[col].tolist()), False))

            used_rows.add(row)
            used_cols.add(col)

        # Handle unmatched existing objects (disappeared)
        unused_rows = set(range(len(object_centroids))) - used_rows
        for row in unused_rows:
            track_id = object_ids[row]
            self._disappeared[track_id] += 1
            if self._disappeared[track_id] > self.max_disappeared:
                self.deregister(track_id)

        # Handle unmatched new centroids (new faces)
        unused_cols = set(range(len(input_centroids))) - used_cols
        for col in unused_cols:
            centroid = tuple(input_centroids[col].tolist())
            track_id = self.register(centroid)
            results.append((track_id, centroid, True))

        return results

    def reset(self):
        """Clear all tracked objects."""
        self._objects.clear()
        self._disappeared.clear()
        self._identities.clear()
        self._next_id = 0
