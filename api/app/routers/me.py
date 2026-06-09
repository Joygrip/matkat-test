"""Current user endpoints.

Finance role: Can manage all master data and planning lines (demand/supply), same as Admin for these areas.
"""
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
            # Master data management (same as Admin for these entities):
            "manage:cost_centers",
            "manage:projects",
            "manage:resources",
            "manage:placeholders",
            "manage:holidays",
            # Planning line write access:
            "write:demand",
            "write:supply",
            "read:projects",
            "read:supply",
            "read:demand",
            "read:actuals",
        ],
        UserRole.PM: [
            "read:projects",
            "write:demand",
            "read:supply",
            "read:actuals",
        ],
        UserRole.MANAGER: [
            "read:cost_center",
            "write:supply",
            "read:demand",
            "read:actuals",
            "approve:actuals",
            "proxy_sign:actuals",
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
    is_manager_pm = (
        current_user.role == UserRole.MANAGER
        and current_user.secondary_role == UserRole.PM.value
    )
    is_manager_reader = (
        current_user.role == UserRole.MANAGER
        and current_user.secondary_role == UserRole.READER.value
    )
    can_pm = current_user.role == UserRole.PM or is_manager_pm
    can_manage = current_user.role == UserRole.MANAGER

    permissions = get_permissions_for_role(current_user.role)
    if is_manager_pm:
        pm_permissions = get_permissions_for_role(UserRole.PM)
        permissions = list(dict.fromkeys(permissions + pm_permissions))

    return MeResponse(
        id=current_user.id,
        tenant_id=current_user.tenant_id,
        object_id=current_user.object_id,
        email=current_user.email,
        display_name=current_user.display_name,
        role=current_user.role.value,
        secondary_role=current_user.secondary_role,
        is_manager_pm=is_manager_pm,
        is_manager_reader=is_manager_reader,
        can_pm=can_pm,
        can_manage=can_manage,
        permissions=permissions,
    )
