"""
LabSecure AI v2 — Biometric Data Retention Service
Automatically purges biometric face templates and photos for expired guests.
"""

import logging
from datetime import datetime, timezone
from backend.db.firebase_client import get_firestore, get_storage_bucket

logger = logging.getLogger(__name__)


def purge_expired_guest_biometrics():
    """Finds all guests where valid_until has passed, and wipes their face templates & photos."""
    db = get_firestore()
    now = datetime.now(timezone.utc)
    
    # Stream all guest records to check validity
    guests_ref = db.collection("guests").stream()
    bucket = get_storage_bucket()
    
    purged_count = 0
    for doc in guests_ref:
        data = doc.to_dict()
        valid_until = data.get("valid_until")
        if not valid_until:
            continue
            
        # Parse firestore datetime vs native datetime
        if isinstance(valid_until, datetime):
            expired = valid_until < now
        else:
            try:
                # Handle string format if stored as ISO string
                expired = datetime.fromisoformat(str(valid_until).replace("Z", "+00:00")) < now
            except Exception:
                expired = False
                
        if expired and (data.get("face_encoding_ref") or "face_descriptor" in data or "face_descriptor_encrypted" in data):
            logger.info(f"Purging expired biometric data for guest: {data.get('name')} (ID: {doc.id})")
            
            # 1. Delete raw image file from Cloud Storage
            photo_ref = data.get("face_encoding_ref")
            if photo_ref and bucket:
                try:
                    blob = bucket.blob(photo_ref)
                    if blob.exists():
                        blob.delete()
                        logger.info(f"Deleted photo blob: {photo_ref}")
                except Exception as e:
                    logger.error(f"Failed to delete photo storage for {doc.id}: {e}")
            
            # 2. Update Firestore record to wipe fields
            from google.cloud import firestore
            db.collection("guests").document(doc.id).update({
                "face_descriptor": firestore.DELETE_FIELD,
                "face_descriptor_encrypted": firestore.DELETE_FIELD,
                "face_encoding_ref": firestore.DELETE_FIELD,
                "purged_at": now
            })
            purged_count += 1
            
    if purged_count > 0:
        logger.info(f"Successfully purged {purged_count} expired guest biometric records.")
