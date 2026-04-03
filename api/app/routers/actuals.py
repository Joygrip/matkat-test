"""Actuals endpoints - time entry and signing."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import (
    get_current_user, require_roles, CurrentUser,
)
from api.app.models.core import UserRole
from api.app.schemas.actuals import (
    ActualLineCreate, ActualLineUpdate, ActualLineResponse,
    ProxySignRequest,
)
from api.app.services.actuals import ActualsService

router = APIRouter(prefix="/actuals", tags=["Actuals"])


def _to_response(line) -> ActualLineResponse:
    """Convert ActualLine to response."""
    return ActualLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        period_id=line.period_id,
        resource_id=line.resource_id,
        project_id=line.project_id,
        year=line.year,
        month=line.month,
        planned_fte_percent=line.planned_fte_percent,
        actual_fte_percent=line.actual_fte_percent,
        employee_signed_at=line.employee_signed_at,
        employee_signed_by=line.employee_signed_by,
        is_proxy_signed=bool(line.is_proxy_signed),
        proxy_sign_reason=line.proxy_sign_reason,
        ro_approved_at=line.ro_approved_at,
        ro_approved_by=line.ro_approved_by,
        created_by=line.created_by,
        created_at=line.created_at,
        updated_at=line.updated_at,
        resource_name=line.resource.display_name if line.resource else None,
        project_name=line.project.name if line.project else None,
    )


@router.get("/my", response_model=list[ActualLineResponse])
async def get_my_actuals(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get actuals for the current user's resource.
    
    Accessible to: All authenticated users (for their own data)
    """
    service = ActualsService(db, current_user)
    lines = service.get_my_actuals(year, month)
    return [_to_response(line) for line in lines]


@router.get("/my-resource")
async def get_my_resource(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get the resource id linked to the current user (for Employees).
    Returns null if the user has no linked resource.
    """
    service = ActualsService(db, current_user)
    resource_id = service.get_my_resource_id()
    return {"resource_id": resource_id}


@router.get("/my/approval-statuses")
async def get_my_approval_statuses(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get approval status for the current user's signed actuals.

    Returns a mapping of actual_line_id -> { approval_id, status, rejection_comment }.

    Accessible to: All authenticated users (own data only)
    """
    service = ActualsService(db, current_user)
    return {"statuses": service.get_my_approval_statuses(year, month)}


@router.get("/approval-statuses")
async def get_approval_statuses(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get approval statuses for all actuals visible to the current user.

    Employees receive their own actuals' statuses; managers and admins receive
    statuses for all actuals within their visible scope.

    Returns a mapping of actual_line_id -> { approval_id, status, rejection_comment }.
    """
    service = ActualsService(db, current_user)
    return {"statuses": service.get_approval_statuses(year, month)}


@router.get("", response_model=list[ActualLineResponse])
async def list_actuals(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    resource_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER
    )),
):
    """
    List all actuals (for RO/Finance/Admin/Director).

    Accessible to: Admin, Finance, RO, Director
    """
    service = ActualsService(db, current_user)
    lines = service.get_all(year, month, resource_id)
    return [_to_response(line) for line in lines]


@router.get("/{actual_id}", response_model=ActualLineResponse)
async def get_actual(
    actual_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Get a specific actual line."""
    service = ActualsService(db, current_user)
    line = service.get_by_id(actual_id)
    if not line:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=404,
            detail={"code": "NOT_FOUND", "message": "Actual line not found"},
        )
    return _to_response(line)


@router.post("", response_model=ActualLineResponse)
async def create_actual(
    data: ActualLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.EMPLOYEE, UserRole.MANAGER
    )),
):
    """
    Create a new actual line.
    
    Rules:
    - Total per resource per month cannot exceed 100%
    - FTE must be 0 or 5-100 in steps of 5
    - Period must be open
    
    Accessible to: Admin, Employee (own), RO
    """
    service = ActualsService(db, current_user)
    line = service.create(
        resource_id=data.resource_id,
        project_id=data.project_id,
        year=data.year,
        month=data.month,
        actual_fte_percent=data.actual_fte_percent,
        planned_fte_percent=data.planned_fte_percent,
        proxy_sign_reason=data.proxy_sign_reason,
    )
    return _to_response(line)


@router.patch("/{actual_id}", response_model=ActualLineResponse)
async def update_actual(
    actual_id: str,
    data: ActualLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.EMPLOYEE, UserRole.MANAGER
    )),
):
    """
    Update an actual line's editable fields before signing.
    Cannot edit signed actuals.
    Accessible to: Admin, Employee (own), RO
    """
    service = ActualsService(db, current_user)
    line = service.update(actual_id, data.model_dump(exclude_unset=True))
    return _to_response(line)


@router.delete("/{actual_id}")
async def delete_actual(
    actual_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.EMPLOYEE, UserRole.MANAGER
    )),
):
    """
    Delete an actual line.
    
    Cannot delete signed actuals.
    
    Accessible to: Admin, Employee (own), RO
    """
    service = ActualsService(db, current_user)
    service.delete(actual_id)
    return {"message": "Actual line deleted"}


@router.post("/{actual_id}/sign", response_model=ActualLineResponse)
async def sign_actual(
    actual_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.EMPLOYEE, UserRole.MANAGER
    )),
):
    """
    Employee or Manager (own resource) signs their actuals.

    Accessible to: Admin, Employee, Manager (own resource only)
    """
    service = ActualsService(db, current_user)
    line = service.sign(actual_id)
    return _to_response(line)


@router.delete("/{actual_id}/sign", response_model=ActualLineResponse)
async def unsign_actual(
    actual_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.EMPLOYEE
    )),
):
    """
    Remove an employee's signature from a rejected actual, allowing re-editing and re-submission.

    Only permitted when the associated approval was rejected and the period is still open.

    Accessible to: Admin, Employee (own)
    """
    service = ActualsService(db, current_user)
    line = service.unsign(actual_id)
    return _to_response(line)


@router.post("/{actual_id}/proxy-sign", response_model=ActualLineResponse)
async def proxy_sign_actual(
    actual_id: str,
    data: ProxySignRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.MANAGER
    )),
):
    """
    RO signs on behalf of absent employee.
    
    Requires a reason for proxy signing.
    
    Accessible to: Admin, RO
    """
    service = ActualsService(db, current_user)
    line = service.proxy_sign(actual_id, data.reason)
    return _to_response(line)


@router.get("/resource/{resource_id}/total", response_model=dict)
async def get_resource_monthly_total(
    resource_id: str,
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Get total FTE for a resource in a given month.
    
    Useful for displaying remaining capacity.
    """
    service = ActualsService(db, current_user)
    total = service.get_resource_monthly_total(resource_id, year, month)
    return {
        "resource_id": resource_id,
        "year": year,
        "month": month,
        "total_percent": total,
        "remaining_percent": 100 - total,
    }
