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
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER)),
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
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER)),
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
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.ADMIN, UserRole.MANAGER)),
):
    """
    Get demand vs actuals per employee for a given period.
    Optionally filter by cost center and/or project.
    Accessible to: Finance, Director, Admin, RO (view only)
    """
    service = FinanceService(db, current_user)
    return service.get_employee_stats(year, month, cost_center_id, project_id)


@router.get("/consolidated-costs/detail", response_model=List[ConsolidatedCostDetail])
async def consolidated_cost_detail(
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    project_id: Optional[str] = Query(None),
    cost_center_id: Optional[str] = Query(None),
    cost_center_code: Optional[str] = Query(None),
    scope: str = Query("default", description="'pm' bypasses Manager resource scoping for Manager+PM users only."),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM,
        UserRole.MANAGER,
    )),
):
    """
    Return per-line detail (demand, actuals, externals, equipment) for one project or cost center.
    When year+month are provided, returns detail for that single period.
    When both are omitted, returns detail for all open periods.
    Provide exactly one of: project_id, cost_center_id, or cost_center_code.
    cost_center_code aggregates all CCs sharing that code (family drill-down).
    When both cost_center_id and cost_center_code are provided, cost_center_id takes precedence.
    PM role is restricted to their own projects (403 otherwise).
    scope="pm": Manager+PM users receive PM-project-scoped data instead of Manager-resource-scoped data.
    Accessible to: Admin, Finance, PM, Director, RO
    """
    cc_identifier_count = sum([bool(project_id), bool(cost_center_id), bool(cost_center_code)])
    if cc_identifier_count == 0:
        raise HTTPException(status_code=422, detail="Provide one of: project_id, cost_center_id, or cost_center_code.")
    if project_id and (cost_center_id or cost_center_code):
        raise HTTPException(status_code=422, detail="Provide only one of project_id or a cost-center identifier.")
    # cost_center_id takes precedence over cost_center_code
    if cost_center_id and cost_center_code:
        cost_center_code = None
    service = FinanceService(db, current_user)
    return service.get_consolidated_cost_detail_multi(
        year, month,
        project_id=project_id,
        cost_center_id=cost_center_id,
        cost_center_code=cost_center_code,
        scope=scope,
    )


@router.get("/consolidated-costs", response_model=ConsolidatedCostResponse)
async def consolidated_costs(
    project_id: Optional[str] = Query(None),
    cost_center_id: Optional[str] = Query(None),
    year: Optional[int] = Query(None),
    month: Optional[int] = Query(None),
    group_by: str = Query("id"),
    scope: str = Query("default", description="'pm' bypasses Manager resource scoping for Manager+PM users only."),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM,
        UserRole.MANAGER,
    )),
):
    """
    Aggregate planned labor, actual labor, external contractor, and equipment costs
    per project per period. Filterable by project and/or cost center.
    When year+month are provided, returns data for that specific period regardless of lock status.
    group_by=id (default): one row per cost center UUID.
    group_by=code: rows merged by cost_center.code; cost_center_name returns the code.
    PM role is restricted to their own projects.
    scope="pm": Manager+PM users receive PM-project-scoped data instead of Manager-resource-scoped data.
    Accessible to: Admin, Finance, PM, Director, RO
    """
    if group_by not in ("id", "code"):
        raise HTTPException(status_code=400, detail='group_by must be "id" or "code".')
    service = FinanceService(db, current_user)
    return service.get_consolidated_costs(project_id, cost_center_id, year=year, month=month, group_by=group_by, scope=scope)


@router.get("/settings/{key}", response_model=FinanceSettingResponse)
async def get_finance_setting(
    key: str,
    period_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.ADMIN)),
):
    """
    Get a finance setting by key. Returns the default value if not yet configured.
    Accessible to: Finance, Admin
    """
    service = FinanceService(db, current_user)
    return service.get_setting(key, period_id=period_id)


@router.put("/settings/{key}", response_model=FinanceSettingResponse)
async def update_finance_setting(
    key: str,
    body: FinanceSettingUpdate,
    period_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.ADMIN)),
):
    """
    Create or update a finance setting.
    Accessible to: Finance, Admin only
    """
    service = FinanceService(db, current_user)
    effective_period_id = body.period_id or period_id
    return service.upsert_setting(key, body.setting_value, period_id=effective_period_id)
