"""
LabSecure AI v2 — In-Memory TTL Cache
Reduces Firestore read operations by caching frequently-accessed data.
"""

import time
import threading
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


class TTLCache:
    """
    Thread-safe in-memory cache with per-key TTL expiration.
    
    Usage:
        cache = TTLCache()
        cache.set("users:all", user_list, ttl=30)
        result = cache.get("users:all")  # returns cached value or None
        cache.invalidate("users:all")    # remove specific key
        cache.invalidate_prefix("users") # remove all keys starting with "users"
    """

    def __init__(self):
        self._store: dict[str, tuple[Any, float]] = {}  # key -> (value, expiry_time)
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        """Get a cached value. Returns None if missing or expired."""
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expiry = entry
            if time.time() > expiry:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: float):
        """Cache a value with a TTL in seconds."""
        with self._lock:
            self._store[key] = (value, time.time() + ttl)

    def invalidate(self, key: str):
        """Remove a specific key from the cache."""
        with self._lock:
            self._store.pop(key, None)

    def invalidate_prefix(self, prefix: str):
        """Remove all keys that start with the given prefix."""
        with self._lock:
            keys_to_remove = [k for k in self._store if k.startswith(prefix)]
            for k in keys_to_remove:
                del self._store[k]

    def clear(self):
        """Clear the entire cache."""
        with self._lock:
            self._store.clear()


# ── Singleton cache instance ──────────────────────────────
_cache = TTLCache()


def get_cache() -> TTLCache:
    """Get the global cache instance."""
    return _cache


# ── Default TTLs (seconds) ────────────────────────────────
CACHE_TTL = {
    "system_state": 10,     # Emergency lockdown needs fast detection
    "schedules": 60,        # Rarely change
    "permissions": 60,      # Rarely change
    "users": 30,            # Moderate change frequency
    "cameras": 30,          # Moderate change frequency
    "rooms": 60,            # Rarely change
    "guests": 30,           # Moderate change frequency
    "admins": 60,           # Rarely change
    "events_query": 10,     # Short TTL for event queries (auto-refresh pages)
}
