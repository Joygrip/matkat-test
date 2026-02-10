"""Current user endpoints."""
from fastapi import APIRouter, Depends

from api.app.auth.dependencies import get_current_user, CurrentUser
from api.app.schemas.user import MeResponse
from api.app.models.core import UserRole

router = APIRouter(tags=["User"])


def get_permissions_for_role(role: UserRole) -> list[str]:
    """Get permission list for a role."""
    base_permissions = ["read:self"]
    
    role_permissions = {
        UserRole.ADMIN: [
            "admin:*",
            "read:*",
            "write:*",
            "manage:users",
            "manage:departments",
            "manage:cost_centers",
            "manage:projects",
            "manage:resources",
            "manage:placeholders",
            "manage:holidays",
            "manage:settings",
        ],
        UserRole.FINANCE: [
            "read:all_data",
            "manage:periods",
            "read:consolidation",
            "publish:consolidation",
            "read:approvals",
        ],
        UserRole.PM: [
            "read:projects",
            "write:demand",
            "read:supply",
            "read:actuals",
        ],
        UserRole.RO: [
            "read:cost_center",
            "write:supply",
            "read:demand",
            "read:actuals",
            "approve:actuals",
            "proxy_sign:actuals",
        ],
        UserRole.DIRECTOR: [
            "read:department",
            "approve:actuals",
            "read:consolidation",
        ],
        UserRole.EMPLOYEE: [
            "read:own_actuals",
            "write:own_actuals",
            "sign:own_actuals",
        ],
    }
    
    return base_permissions + role_permissions.get(role, [])


@router.get("/me", response_model=MeResponse)
async def get_me(current_user: CurrentUser = Depends(get_current_user)):
    """
    Get current authenticated user information.
    """
    return MeResponse(
        tenant_id=current_user.tenant_id,
        object_id=current_user.object_id,
        email=current_user.email,
        display_name=current_user.display_name,
        role=current_user.role.value,
        permissions=get_permissions_for_role(current_user.role),
    )
