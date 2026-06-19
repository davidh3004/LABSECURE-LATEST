"""
LabSecure AI v2 — Camera Health Monitor Service
Pings cameras and switch ports to report network health.
"""

import time
import threading
import logging
import subprocess
import platform
from typing import Optional

from backend.config import get_config

logger = logging.getLogger(__name__)


class CameraMonitor:
    """
    Monitors camera and switch connectivity via ICMP ping.
    Runs in a background thread and exposes health status.
    """

    def __init__(self):
        net_config = get_config("network")
        cam_config = get_config("cameras")

        self.switch_ip = net_config.get("switch_ip", "192.168.1.1")
        self.ping_interval = net_config.get("ping_interval_seconds", 30)
        self.ping_timeout = net_config.get("ping_timeout_seconds", 2)

        # Build IP target list
        self._targets: dict[str, str] = {}  # id -> IP
        for cam in cam_config:
            if cam.get("type") == "ip" and cam.get("static_ip"):
                self._targets[cam["id"]] = cam["static_ip"]

        self._targets["switch"] = self.switch_ip

        # Health state
        self._health: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._running = False
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Start the background monitoring thread."""
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self._thread.start()
        logger.info("Camera health monitor started")

    def stop(self):
        """Stop the monitoring thread."""
        self._running = False
        if self._thread:
            self._thread.join(timeout=10)
        logger.info("Camera health monitor stopped")

    def get_health(self) -> dict[str, dict]:
        """Get current health status for all targets."""
        with self._lock:
            return dict(self._health)

    def _monitor_loop(self):
        """Background monitoring loop."""
        while self._running:
            for target_id, ip in self._targets.items():
                result = self._ping(ip)
                with self._lock:
                    self._health[target_id] = {
                        "id": target_id,
                        "ip": ip,
                        "reachable": result["reachable"],
                        "latency_ms": result["latency_ms"],
                        "last_check": time.time(),
                    }

            time.sleep(self.ping_interval)

    def _ping(self, host: str) -> dict:
        """
        Cross-platform ICMP ping.
        Returns: {"reachable": bool, "latency_ms": float | None}
        """
        try:
            # Build platform-appropriate ping command
            sys_platform = platform.system().lower()
            if sys_platform == "windows":
                cmd = ["ping", "-n", "1", "-w", str(self.ping_timeout * 1000), host]
            else:
                cmd = ["ping", "-c", "1", "-W", str(self.ping_timeout), host]

            start = time.time()
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.ping_timeout + 2,
            )
            elapsed = (time.time() - start) * 1000  # ms

            reachable = result.returncode == 0
            return {
                "reachable": reachable,
                "latency_ms": round(elapsed, 1) if reachable else None,
            }

        except (subprocess.TimeoutExpired, Exception) as e:
            logger.debug(f"Ping failed for {host}: {e}")
            return {"reachable": False, "latency_ms": None}
