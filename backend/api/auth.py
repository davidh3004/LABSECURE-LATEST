"""
LabSecure AI v2 — Authentication API
Admin login, token validation, and admin account management.
"""

import jwt
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel

from backend.db.schemas import AdminCreate, AdminModel, EventCreate, EventType, EventSeverity
from backend.db.repositories import AdminRepository, EventRepository
from backend.config import get_config

router = APIRouter(prefix="/api/auth", tags=["Auth"])

# JWT Configuration
JWT_SECRET = get_config("security").get("jwt_secret", "DEV_SECRET_KEY_CHANGE_ME_IN_PROD")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str

class AdminLogin(BaseModel):
    username: str
    password: str

class TokenData(BaseModel):
    username: Optional[str] = None

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_admin(token: str = Depends(oauth2_scheme)) -> AdminModel:
    credentials_exception = HTTPException(
        status_code=401,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except jwt.PyJWTError:
        raise credentials_exception

    admin = AdminRepository.get_by_username(token_data.username)
    if admin is None:
        raise credentials_exception
    return admin


# ── Endpoints ──────────────────────────────────────────

@router.post("/login", response_model=Token)
async def login(credentials: AdminLogin):
    """Authenticate an admin and return a JWT token."""
    admin = AdminRepository.get_by_username(credentials.username)
    if not admin or not AdminRepository.verify_password(credentials.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password")
    
    access_token = create_access_token(data={"sub": admin.username, "role": admin.role})
    return {"access_token": access_token, "token_type": "bearer", "role": admin.role}


@router.get("/me", response_model=AdminModel)
async def get_me(current_admin: AdminModel = Depends(get_current_admin)):
    """Return the currently authenticated admin."""
    return current_admin


@router.get("/admins", response_model=list[AdminModel])
async def list_admins(current_admin: AdminModel = Depends(get_current_admin)):
    """List all admin accounts (requires login)."""
    return AdminRepository.get_all()


@router.post("/admins", response_model=AdminModel, status_code=201)
async def create_admin(data: AdminCreate, current_admin: AdminModel = Depends(get_current_admin)):
    """Create a new admin account (requires login)."""
    existing = AdminRepository.get_by_username(data.username)
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    admin = AdminRepository.create(data)

    EventRepository.create(EventCreate(
        type=EventType.ADMIN_CREATED,
        details={"username": data.username, "created_by": current_admin.username},
        severity=EventSeverity.INFO,
    ))

    return admin


@router.delete("/admins/{admin_id}")
async def delete_admin(admin_id: str, current_admin: AdminModel = Depends(get_current_admin)):
    """Delete an admin account."""
    if current_admin.id == admin_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
        
    admins_list = AdminRepository.get_all()
    admin_to_delete = next((a for a in admins_list if a.id == admin_id), None)
    if not admin_to_delete:
        raise HTTPException(status_code=404, detail="Admin not found")
        
    if not AdminRepository.delete(admin_id):
        raise HTTPException(status_code=404, detail="Admin not found")

    EventRepository.create(EventCreate(
        type=EventType.ADMIN_DELETED,
        details={"admin_id": admin_id, "username": admin_to_delete.username, "deleted_by": current_admin.username},
        severity=EventSeverity.WARNING,
    ))

    return {"status": "deleted", "admin_id": admin_id}
