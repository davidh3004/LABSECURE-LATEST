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
    "system_state": 30,     # Short TTL, but invalidates instantly on emergency trigger
    "schedules": 600,       # Rarely change (10 minutes)
    "permissions": 600,     # Rarely change (10 minutes)
    "users": 600,           # Cache for 10 minutes (invalidates on write)
    "cameras": 600,         # Cache for 10 minutes (invalidates on write)
    "rooms": 600,           # Rarely change (10 minutes)
    "guests": 300,          # Moderate change frequency (5 minutes)
    "admins": 600,          # Rarely change (10 minutes)
    "events_query": 60,     # Prevent excessive event query spam from polling (1 minute)
}
