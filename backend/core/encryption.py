"""
LabSecure AI v2 — AES-256-GCM Encryption Utility
Encrypts and decrypts biometric face encodings for secure storage in Firestore.
"""

import os
import sys
import base64
import hashlib
import hmac
from typing import Optional

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes


def _load_key_from_windows_registry() -> Optional[str]:
    """
    Fallback for Windows: read LABSECURE_MASTER_KEY from the user's registry
    (HKCU\\Environment). Needed because processes launched from a terminal that
    predates `setx` / SetEnvironmentVariable won't have the var in os.environ.
    """
    if sys.platform != "win32":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            value, _ = winreg.QueryValueEx(key, "LABSECURE_MASTER_KEY")
            return value or None
    except OSError:
        return None


class BiometricEncryptor:
    """
    AES-256-GCM encryption for biometric data.
    
    Usage:
        encryptor = BiometricEncryptor()
        payload = encryptor.encrypt(face_embedding_bytes)
        # payload is a dict safe for Firestore storage
        
        original = encryptor.decrypt(payload)
    """

    NONCE_SIZE = 12   # 96-bit nonce (recommended for GCM)
    KEY_SIZE = 32     # 256-bit key
    TAG_SIZE = 16     # 128-bit authentication tag

    def __init__(self, master_key: Optional[bytes] = None):
        """
        Initialize with a master key.
        
        Args:
            master_key: 32-byte key. If None, reads from LABSECURE_MASTER_KEY env var (hex encoded).
        """
        if master_key:
            self._master_key = master_key
        else:
            key_hex = os.environ.get("LABSECURE_MASTER_KEY") or _load_key_from_windows_registry()
            if not key_hex:
                raise ValueError(
                    "No encryption key provided. Set LABSECURE_MASTER_KEY environment variable "
                    "with a 64-character hex string (32 bytes)."
                )
            self._master_key = bytes.fromhex(key_hex)

        if len(self._master_key) != self.KEY_SIZE:
            raise ValueError(f"Master key must be exactly {self.KEY_SIZE} bytes (got {len(self._master_key)})")

    def _derive_key(self, salt: bytes) -> bytes:
        """Derive an encryption key from master key using HKDF-like construction."""
        # HKDF-Extract
        prk = hmac.new(salt, self._master_key, hashlib.sha256).digest()
        # HKDF-Expand (single block, 32 bytes)
        okm = hmac.new(prk, b"labsecure-biometric-v2\x01", hashlib.sha256).digest()
        return okm

    def encrypt(self, plaintext: bytes) -> dict:
        """
        Encrypt data using AES-256-GCM.
        
        Args:
            plaintext: Raw bytes to encrypt (e.g., serialized face embedding).
            
        Returns:
            dict with base64-encoded fields safe for Firestore:
            {
                "ciphertext": str,
                "nonce": str,
                "tag": str,
                "salt": str,
                "version": int
            }
        """
        salt = get_random_bytes(16)
        key = self._derive_key(salt)
        nonce = get_random_bytes(self.NONCE_SIZE)

        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        ciphertext, tag = cipher.encrypt_and_digest(plaintext)

        return {
            "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
            "nonce": base64.b64encode(nonce).decode("utf-8"),
            "tag": base64.b64encode(tag).decode("utf-8"),
            "salt": base64.b64encode(salt).decode("utf-8"),
            "version": 1,
        }

    def decrypt(self, payload: dict) -> bytes:
        """
        Decrypt an AES-256-GCM encrypted payload.
        
        Args:
            payload: dict with base64-encoded ciphertext, nonce, tag, salt.
            
        Returns:
            Decrypted plaintext bytes.
            
        Raises:
            ValueError: If decryption fails (tampered data, wrong key).
        """
        try:
            ciphertext = base64.b64decode(payload["ciphertext"])
            nonce = base64.b64decode(payload["nonce"])
            tag = base64.b64decode(payload["tag"])
            salt = base64.b64decode(payload["salt"])
        except (KeyError, Exception) as e:
            raise ValueError(f"Invalid encryption payload format: {e}")

        key = self._derive_key(salt)
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)

        try:
            plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        except (ValueError, KeyError) as e:
            raise ValueError(f"Decryption failed — data may be tampered or key is incorrect: {e}")

        return plaintext

    @staticmethod
    def generate_master_key() -> str:
        """Generate a new random 256-bit master key as a hex string."""
        return get_random_bytes(32).hex()

    @staticmethod
    def serialize_embedding(embedding) -> bytes:
        """Serialize a numpy face embedding to bytes for encryption."""
        import numpy as np
        if isinstance(embedding, np.ndarray):
            return embedding.tobytes()
        raise TypeError(f"Expected numpy ndarray, got {type(embedding)}")

    @staticmethod
    def deserialize_embedding(data: bytes, dtype="float32", dim: int = 512):
        """Deserialize bytes back to a numpy face embedding."""
        import numpy as np
        return np.frombuffer(data, dtype=dtype).reshape(dim)
