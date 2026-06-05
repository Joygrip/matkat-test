"""Authentication dependencies."""
from typing import Optional

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, SecurityScopes
from fastapi_azure_auth import SingleTenantAzureAuthorizationCodeBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from api.app.config import get_settings
from api.app.db.engine import get_db
from api.app.models.core import User, UserRole
from api.app.services.user_sync import sync_user_from_graph

# HTTP Bearer scheme for token extraction
security = HTTPBearer(auto_error=False)

# Lazily-initialised Azure scheme (avoids import-time settings resolution)
_azure_scheme: Optional[SingleTenantAzureAuthorizationCodeBearer] = None


def _get_azure_scheme() -> SingleTenantAzureAuthorizationCodeBearer:
    """Return the configured Azure auth scheme, creating it once on first call."""
    global _azure_scheme
    if _azure_scheme is None:
        s = get_settings()
        _azure_scheme = SingleTenantAzureAuthorizationCodeBearer(
            app_client_id=s.api_app_client_id,
            tenant_id=s.azure_tenant_id,
            auto_error=True,
            scopes={
                f"api://{s.api_app_client_id}/access_as_user": "Access as user",
            },
        )
    return _azure_scheme


class CurrentUser(BaseModel):
    """Current authenticated user context."""
    id: str
    tenant_id: str
    object_id: str
    email: str
    display_name: str
    role: UserRole
    secondary_role: Optional[str] = None

    @property
    def is_reader(self) -> bool:
        return self.secondary_role == UserRole.READER.value

    @property
    def is_manager_reader(self) -> bool:
        return self.role == UserRole.MANAGER and self.secondary_role == UserRole.READER.value

    def has_role(self, *roles: UserRole) -> bool:
        """Check if user has any of the specified roles (primary or secondary)."""
        return (
            self.role in roles or
            (self.secondary_role is not None and self.secondary_role in [r.value for r in roles])
        )

    def require_role(self, *roles: UserRole) -> None:
        """Raise 403 if user doesn't have any of the specified roles."""
        if not self.has_role(*roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_ROLE",
                    "message": f"This action requires one of: {[r.value for r in roles]}",
                },
            )


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """
    Get current user from JWT token or dev bypass headers.

    Production: validates the Entra JWT, then looks up the user's role in the DB
    by object_id. Returns 403 USER_NOT_FOUND if the user is not yet provisioned.

    Dev mode (ENV=dev AND DEV_AUTH_BYPASS=true): accepts X-Dev-* headers directly.
    """
    settings = get_settings()

    # ------------------------------------------------------------------
    # Dev bypass mode (only active when ENV=dev AND DEV_AUTH_BYPASS=true)
    # ------------------------------------------------------------------
    if settings.dev_auth_bypass and settings.is_dev:
        dev_role = request.headers.get("X-Dev-Role", "Employee")
        dev_tenant = request.headers.get("X-Dev-Tenant", "dev-tenant-001")
        dev_user_id = request.headers.get("X-Dev-User-Id", "dev-user-001")
        dev_email = request.headers.get("X-Dev-Email", "dev@example.com")
        dev_name = request.headers.get("X-Dev-Name", "Dev User")
        # Optional header for test fixtures: set secondary_role directly without DB admin call.
        # Empty string clears secondary_role; omitting the header leaves the existing DB value.
        dev_secondary_role_header = request.headers.get("X-Dev-Secondary-Role", None)

        try:
            role = UserRole(dev_role)
        except ValueError:
            role = UserRole.EMPLOYEE

        from sqlalchemy import and_
        db_user = db.query(User).filter(
            and_(
                User.tenant_id == dev_tenant,
                User.object_id == dev_user_id,
            )
        ).first()
        if db_user:
            db_user.email = dev_email
            db_user.display_name = dev_name
            db_user.role = role
            db_user.is_active = True
            if dev_secondary_role_header is not None:
                db_user.secondary_role = dev_secondary_role_header or None
            db.commit()
        else:
            db_user = User(
                tenant_id=dev_tenant,
                object_id=dev_user_id,
                email=dev_email,
                display_name=dev_name,
                role=role,
                secondary_role=dev_secondary_role_header or None,
                is_active=True,
            )
            db.add(db_user)
            db.commit()

        return CurrentUser(
            id=db_user.id,
            tenant_id=dev_tenant,
            object_id=dev_user_id,
            email=dev_email,
            display_name=dev_name,
            role=role,
            secondary_role=db_user.secondary_role,
        )

    # ------------------------------------------------------------------
    # Production: validate Bearer JWT via Entra
    # ------------------------------------------------------------------
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHORIZED",
                "message": "Authentication required",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Validate token – raises 401 automatically on failure (auto_error=True)
    azure_user = await _get_azure_scheme()(request, SecurityScopes())

    # Extract standard claims
    claims = azure_user.claims if hasattr(azure_user, "claims") else {}
    object_id: str = claims.get("oid") or claims.get("sub", "")
    tenant_id: str = claims.get("tid", "")
    email: str = (
        claims.get("preferred_username")
        or claims.get("upn")
        or claims.get("email")
        or ""
    )
    display_name: str = claims.get("name", email)

    if not object_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "INVALID_TOKEN",
                "message": "Token is missing the 'oid' claim.",
            },
        )

    # Upsert user from JWT claims + best-effort Graph sync
    db_user = await sync_user_from_graph(
        db=db,
        settings=settings,
        user_access_token=credentials.credentials,
        tenant_id=tenant_id,
        object_id=object_id,
        email=email,
        display_name=display_name,
    )

    return CurrentUser(
        id=db_user.id,
        tenant_id=db_user.tenant_id,
        object_id=object_id,
        email=db_user.email,
        display_name=db_user.display_name,
        role=db_user.role,
        secondary_role=db_user.secondary_role,
    )


def require_roles(*roles: UserRole):
    """Dependency factory to require specific roles."""
    async def role_checker(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        current_user.require_role(*roles)
        return current_user
    return role_checker


# Common role dependencies
require_admin = require_roles(UserRole.ADMIN)
require_finance = require_roles(UserRole.ADMIN, UserRole.FINANCE)
require_pm = require_roles(UserRole.ADMIN, UserRole.PM)
require_manager = require_roles(UserRole.ADMIN, UserRole.MANAGER)