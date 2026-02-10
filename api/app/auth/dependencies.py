"""Authentication dependencies."""
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel

from api.app.config import get_settings
from api.app.models.core import UserRole

# HTTP Bearer scheme for token extraction
security = HTTPBearer(auto_error=False)


class CurrentUser(BaseModel):
    """Current authenticated user context."""
    tenant_id: str
    object_id: str
    email: str
    display_name: str
    role: UserRole
    
    def has_role(self, *roles: UserRole) -> bool:
        """Check if user has any of the specified roles."""
        return self.role in roles
    
    def require_role(self, *roles: UserRole) -> None:
        """Raise 403 if user doesn't have any of the specified roles."""
        if not self.has_role(*roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_ROLE",
                    "message": f"This action requires one of: {[r.value for r in roles]}",
                }
            )


async def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> CurrentUser:
    """
    Get current user from JWT token or dev bypass headers.
    
    In production: validates JWT via Azure AD.
    In dev mode with DEV_AUTH_BYPASS=true: accepts X-Dev-Role and X-Dev-Tenant headers.
    """
    settings = get_settings()
    
    # Dev bypass mode
    if settings.dev_auth_bypass and settings.is_dev:
        dev_role = request.headers.get("X-Dev-Role", "Employee")
        dev_tenant = request.headers.get("X-Dev-Tenant", "dev-tenant-001")
        dev_user_id = request.headers.get("X-Dev-User-Id", "dev-user-001")
        dev_email = request.headers.get("X-Dev-Email", "dev@example.com")
        dev_name = request.headers.get("X-Dev-Name", "Dev User")
        
        try:
            role = UserRole(dev_role)
        except ValueError:
            role = UserRole.EMPLOYEE
        
        return CurrentUser(
            tenant_id=dev_tenant,
            object_id=dev_user_id,
            email=dev_email,
            display_name=dev_name,
            role=role,
        )
    
    # Production: require token
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "code": "UNAUTHORIZED",
                "message": "Authentication required",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # TODO: Implement real JWT validation with fastapi-azure-auth
    # For now, in non-bypass mode without proper token, reject
    # This will be replaced with azure_scheme dependency
    
    token = credentials.credentials
    
    # Placeholder for real token validation
    # In production, use fastapi_azure_auth.SingleTenantAzureAuthorizationCodeBearer
    # or MultiTenantAzureAuthorizationCodeBearer
    
    raise HTTPException(
        status_code=status.HTTP_501_NOT_IMPLEMENTED,
        detail={
            "code": "AUTH_NOT_CONFIGURED",
            "message": "Azure AD authentication not configured. Enable DEV_AUTH_BYPASS for development.",
        }
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
require_ro = require_roles(UserRole.ADMIN, UserRole.RO)
require_director = require_roles(UserRole.ADMIN, UserRole.DIRECTOR)
