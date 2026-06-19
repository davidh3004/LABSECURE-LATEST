"""
LabSecure AI v2 — Firebase Client
Initializes Firebase Admin SDK and provides Firestore/Storage singletons.
"""

import os
from pathlib import Path
from typing import Optional

import firebase_admin
from firebase_admin import credentials, firestore, storage

from backend.config import get_config


_app: Optional[firebase_admin.App] = None
_db = None
_bucket = None


def init_firebase(credentials_path: Optional[str] = None, project_id: Optional[str] = None):
    """
    Initialize Firebase Admin SDK.
    
    Args:
        credentials_path: Path to service account JSON. Falls back to config/env.
        project_id: Firebase project ID. Falls back to config/env.
    """
    global _app, _db, _bucket

    if _app is not None:
        return

    fb_config = get_config("firebase")
    cred_path = credentials_path or fb_config.get("credentials_path", "")
    proj_id = project_id or fb_config.get("project_id", "")
    bucket_name = fb_config.get("storage_bucket", "")

    if not cred_path or cred_path.startswith("${"):
        cred_path = os.environ.get("FIREBASE_CREDENTIALS_PATH", "")

    if not proj_id or proj_id.startswith("${"):
        proj_id = os.environ.get("FIREBASE_PROJECT_ID", "")

    if not bucket_name or bucket_name.startswith("${"):
        bucket_name = os.environ.get("FIREBASE_STORAGE_BUCKET", "")

    if cred_path and Path(cred_path).exists():
        cred = credentials.Certificate(cred_path)
    else:
        # Use Application Default Credentials
        cred = credentials.ApplicationDefault()

    options = {}
    if proj_id:
        options["projectId"] = proj_id
    if bucket_name:
        options["storageBucket"] = bucket_name

    _app = firebase_admin.initialize_app(cred, options)
    _db = firestore.client()
    if bucket_name:
        _bucket = storage.bucket()


def get_firestore():
    """Get the Firestore client. Initializes Firebase if needed."""
    global _db
    if _db is None:
        init_firebase()
    return _db


def get_storage_bucket():
    """Get the Firebase Storage bucket. Initializes Firebase if needed."""
    global _bucket
    if _bucket is None:
        init_firebase()
    return _bucket


def get_app() -> firebase_admin.App:
    """Get the Firebase App instance."""
    global _app
    if _app is None:
        init_firebase()
    return _app
