"""
LabSecure AI v2 — Configuration Loader
Loads YAML config with environment variable interpolation.
"""

import os
import re
import yaml
from pathlib import Path
from typing import Any


_CONFIG_CACHE: dict | None = None
_CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


def _interpolate_env(value: Any) -> Any:
    """Replace ${ENV_VAR} placeholders with environment variable values."""
    if isinstance(value, str):
        pattern = re.compile(r"\$\{(\w+)\}")
        def replacer(match):
            env_var = match.group(1)
            return os.environ.get(env_var, match.group(0))
        return pattern.sub(replacer, value)
    elif isinstance(value, dict):
        return {k: _interpolate_env(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [_interpolate_env(item) for item in value]
    return value


def load_config(config_path: str | Path | None = None) -> dict:
    """Load and cache the YAML configuration."""
    global _CONFIG_CACHE
    if _CONFIG_CACHE is not None:
        return _CONFIG_CACHE

    path = Path(config_path) if config_path else _CONFIG_PATH
    if not path.exists():
        raise FileNotFoundError(f"Configuration file not found: {path}")

    with open(path, "r") as f:
        raw = yaml.safe_load(f)

    _CONFIG_CACHE = _interpolate_env(raw)
    return _CONFIG_CACHE


def get_config(section: str | None = None) -> dict:
    """Get config or a specific section."""
    cfg = load_config()
    if section:
        return cfg.get(section, {})
    return cfg


def reload_config(config_path: str | Path | None = None) -> dict:
    """Force reload the configuration."""
    global _CONFIG_CACHE
    _CONFIG_CACHE = None
    return load_config(config_path)
