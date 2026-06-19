"""
LabSecure AI v2 — Permission Matrix API
Manage role and user-level access permissions.
"""

from fastapi import APIRouter, HTTPException

from backend.db.schemas import PermissionModel, PermissionCreate, PermissionUpdate, EventCreate, EventType, EventSeverity
from backend.db.repositories import PermissionRepository, EventRepository

router = APIRouter(prefix="/api/permissions", tags=["Permissions"])


@router.get("/", response_model=list[PermissionModel])
def list_permissions():
    """List all permission entries."""
    return PermissionRepository.get_all()


@router.get("/{perm_id}", response_model=PermissionModel)
def get_permission(perm_id: str):
    """Get a single permission by ID."""
    perm = PermissionRepository.get_by_id(perm_id)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")
    return perm


@router.get("/user/{user_id}", response_model=list[PermissionModel])
def get_user_permissions(user_id: str):
    """Get all permissions for a specific user."""
    return PermissionRepository.get_for_user(user_id)


@router.get("/role/{role}", response_model=list[PermissionModel])
def get_role_permissions(role: str):
    """Get all permissions for a specific role."""
    return PermissionRepository.get_for_role(role)


@router.post("/", response_model=PermissionModel, status_code=201)
def create_permission(data: PermissionCreate):
    """Create a new permission entry."""
    perm = PermissionRepository.create(data)

    EventRepository.create(EventCreate(
        type=EventType.PERMISSION_GRANTED,
        user_id=data.user_id or "",
        details={
            "role": data.role.value if data.role else None,
            "schedule_ids": data.schedule_ids,
            "can_unlock": data.can_unlock,
            "can_access_outside_schedule": data.can_access_outside_schedule,
            "granted_by": data.granted_by,
        },
        severity=EventSeverity.INFO,
    ))

    return perm


@router.put("/{perm_id}", response_model=PermissionModel)
def update_permission(perm_id: str, data: PermissionUpdate):
    """Update a permission."""
    perm = PermissionRepository.update(perm_id, data)
    if not perm:
        raise HTTPException(status_code=404, detail="Permission not found")

    EventRepository.create(EventCreate(
        type=EventType.PERMISSION_UPDATED,
        user_id=perm.user_id or "",
        details={
            "permission_id": perm_id,
            "can_unlock": data.can_unlock,
            "can_access_outside_schedule": data.can_access_outside_schedule,
        },
        severity=EventSeverity.INFO,
    ))

    return perm


@router.delete("/{perm_id}")
def delete_permission(perm_id: str):
    """Delete a permission entry."""
    if not PermissionRepository.delete(perm_id):
        raise HTTPException(status_code=404, detail="Permission not found")

    EventRepository.create(EventCreate(
        type=EventType.PERMISSION_REVOKED,
        details={"permission_id": perm_id},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "deleted", "permission_id": perm_id}
