"""Finance dashboard endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.schemas.finance import (
    FinanceActualsDashboardResponse,
    FinanceCostCenterStatsResponse,
    FinanceEmployeeStatsResponse,
    FinanceSettingResponse,
    FinanceSettingUpdate,
    ConsolidatedCostResponse,
    ConsolidatedCostDetail,
)
from api.app.services.finance import FinanceService

router = APIRouter(tags=["Finance"])

@router.get("/actuals-dashboard", response_model=List[FinanceActualsDashboardResponse])
async def actuals_dashboard(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    project_id: Optional[str] = Query(None),
    cost_center_id: Optional[str] = Query(None),
    approval_status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.DIRECTOR, UserRole.RO)),
):
    """
    List all employee actuals with project, cost center, approval status, and current approval step.
    Filterable by project, cost center, period, approval status.
    Accessible to: Finance, Director, RO (view only)
    """
    service = FinanceService(db, current_user)
    return service.get_actuals_dashboard(year, month, project_id, cost_center_id, approval_status)

@router.get("/actuals-vs-plan", response_model=List[FinanceCostCenterStatsResponse])
async def actuals_vs_plan(
    year: int = Query(...),
    month: int = Query(...),
    cost_center_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.DIRECTOR, UserRole.RO)),
):
    """
    Get demand, supply, and actuals per cost center for a given period.
    Optionally filter to a single cost center.
    Accessible to: Finance, Director, RO (view only)
    """
    service = FinanceService(db, current_user)
    return service.get_cost_center_stats(year, month, cost_center_id)


@router.get("/actuals-vs-plan-by-employee", response_model=List[FinanceEmployeeStatsResponse])
async def actuals_vs_plan_by_employee(
    year: int = Query(...),
    month: int = Query(...),
    cost_center_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.DIRECTOR, UserRole.ADMIN, UserRole.RO)),
):
    """
    Get demand vs actuals per employee for a given period.
    Optionally filter by cost center and/or project.
    Accessible to: Finance, Director, Admin, RO (view only)
    """
    service = FinanceService(db, current_user)
    return service.get_employee_stats(year, month, cost_center_id, project_id)


@router.get("/consolidated-costs/detail", response_model=ConsolidatedCostDetail)
async def consolidated_cost_detail(
    year: int = Query(...),
    month: int = Query(...),
    project_id: Optional[str] = Query(None),
    cost_center_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM,
        UserRole.DIRECTOR, UserRole.RO,
    )),
):
    """
    Return per-line detail (demand, actuals, externals, equipment) for one project or cost center + period.
    Exactly one of project_id or cost_center_id must be provided.
    PM role is restricted to their own projects (403 otherwise).
    Accessible to: Admin, Finance, PM, Director, RO
    """
    from fastapi import HTTPException
    if not project_id and not cost_center_id:
        raise HTTPException(status_code=422, detail="Provide either project_id or cost_center_id.")
    if project_id and cost_center_id:
        raise HTTPException(status_code=422, detail="Provide only one of project_id or cost_center_id.")
    service = FinanceService(db, current_user)
    return service.get_consolidated_cost_detail(year, month, project_id=project_id, cost_center_id=cost_center_id)


@router.get("/consolidated-costs", response_model=ConsolidatedCostResponse)
async def consolidated_costs(
    project_id: Optional[str] = Query(None),
    cost_center_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM,
        UserRole.DIRECTOR, UserRole.RO,
    )),
):
    """
    Aggregate planned labor, actual labor, external contractor, and equipment costs
    per project per period. Filterable by project and/or cost center.
    PM role is restricted to their own projects.
    Accessible to: Admin, Finance, PM, Director, RO
    """
    service = FinanceService(db, current_user)
    return service.get_consolidated_costs(project_id, cost_center_id)


@router.get("/settings/{key}", response_model=FinanceSettingResponse)
async def get_finance_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.ADMIN)),
):
    """
    Get a finance setting by key. Returns the default value if not yet configured.
    Accessible to: Finance, Admin
    """
    service = FinanceService(db, current_user)
    return service.get_setting(key)


@router.put("/settings/{key}", response_model=FinanceSettingResponse)
async def update_finance_setting(
    key: str,
    body: FinanceSettingUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.ADMIN)),
):
    """
    Create or update a finance setting.
    Accessible to: Finance, Admin only
    """
    service = FinanceService(db, current_user)
    return service.upsert_setting(key, body.setting_value)
