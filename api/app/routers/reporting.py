"""Reporting hierarchy endpoints - manager overrides and cache sync (Admin only)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import require_roles, CurrentUser, get_current_user
from api.app.models.core import UserRole
from api.app.services.reporting import ReportingService
from api.app.schemas.reporting import (
    ManagerOverrideCreate,
    ManagerOverridePatch,
    ManagerOverrideResponse,
    ReportingChainEntry,
    SyncResult,
)

router = APIRouter(prefix="/admin/reporting", tags=["Reporting"])

_ADMIN_ROLES = (UserRole.ADMIN,)


@router.post("/sync-cache", response_model=SyncResult)
async def sync_reporting_cache(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ADMIN_ROLES)),
):
    """
    Rebuild the reporting_cache table from User.manager_object_id values
    already stored in the DB. Safe to call at any time; does NOT require
    Graph to be reachable (uses cached manager data).
    """
    rows = ReportingService.rebuild_cache_for_tenant(current_user.tenant_id, db)
    return SyncResult(
        rows_written=rows,
        message=f"Reporting cache rebuilt: {rows} hierarchy rows written.",
    )


@router.get("/chain/{manager_object_id}", response_model=list[ReportingChainEntry])
async def get_reporting_chain(
    manager_object_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ADMIN_ROLES)),
):
    """Preview all subordinates (any depth) for a given manager Entra object ID."""
    svc = ReportingService(db, current_user)
    return svc.get_reporting_chain(manager_object_id)


# ── Manager Overrides ───────────────────────────────────────────────────────

@router.get("/overrides", response_model=list[ManagerOverrideResponse])
async def list_overrides(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ADMIN_ROLES)),
):
    """List all manual manager overrides for this tenant."""
    return ReportingService(db, current_user).list_overrides()


@router.post("/overrides", response_model=ManagerOverrideResponse, status_code=201)
async def create_override(
    body: ManagerOverrideCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ADMIN_ROLES)),
):
    """Create a manual manager → employee override."""
    return ReportingService(db, current_user).create_override(
        employee_object_id=body.employee_object_id,
        manager_object_id=body.manager_object_id,
        note=body.note,
    )


@router.patch("/overrides/{override_id}", response_model=ManagerOverrideResponse)
async def patch_override(
    override_id: str,
    body: ManagerOverridePatch,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ADMIN_ROLES)),
):
    """Enable/disable or update the note on an override."""
    return ReportingService(db, current_user).patch_override(
        override_id=override_id,
        is_active=body.is_active,
        note=body.note,
    )


@router.delete("/overrides/{override_id}", status_code=204)
async def delete_override(
    override_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*_ADMIN_ROLES)),
):
    """Permanently delete an override."""
    ReportingService(db, current_user).delete_override(override_id)
