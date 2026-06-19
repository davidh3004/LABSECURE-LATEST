"""
LabSecure AI v2 — Dependency Injection
Shared dependencies for FastAPI endpoints.
"""

from typing import Any, Optional


# Global singletons (initialized in main.py lifespan)
# Typed as Any to avoid importing heavy ML modules at module level
vision_pipeline: Optional[Any] = None
access_controller: Optional[Any] = None
anomaly_detector: Optional[Any] = None
camera_monitor: Optional[Any] = None
