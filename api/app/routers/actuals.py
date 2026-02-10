"""Actuals endpoints - time entry and signing."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.schemas.actuals import (
    ActualLineCreate, ActualLineUpdate, ActualLineResponse,
    SignRequest, ProxySignRequest,
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


@router.get("", response_model=list[ActualLineResponse])
async def list_actuals(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    resource_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.RO
    )),
):
    """
    List all actuals (for RO/Finance/Admin).
    
    Accessible to: Admin, Finance, RO
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
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Actual line not found"})
    return _to_response(line)


@router.post("", response_model=ActualLineResponse)
async def create_actual(
    data: ActualLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.EMPLOYEE, UserRole.RO
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
    )
    return _to_response(line)


@router.patch("/{actual_id}", response_model=ActualLineResponse)
async def update_actual(
    actual_id: str,
    data: ActualLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.EMPLOYEE, UserRole.RO
    )),
):
    """
    Update an actual line's FTE.
    
    Cannot edit signed actuals.
    
    Accessible to: Admin, Employee (own), RO
    """
    service = ActualsService(db, current_user)
    line = service.update(actual_id, data.actual_fte_percent)
    return _to_response(line)


@router.delete("/{actual_id}")
async def delete_actual(
    actual_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.EMPLOYEE, UserRole.RO
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
        UserRole.ADMIN, UserRole.EMPLOYEE
    )),
):
    """
    Employee signs their actuals.
    
    Accessible to: Admin, Employee
    """
    service = ActualsService(db, current_user)
    line = service.sign(actual_id)
    return _to_response(line)


@router.post("/{actual_id}/proxy-sign", response_model=ActualLineResponse)
async def proxy_sign_actual(
    actual_id: str,
    data: ProxySignRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.RO
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
