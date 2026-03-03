"""Finance dashboard endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.schemas.finance import FinanceActualsDashboardResponse, FinanceCostCenterStatsResponse, FinanceEmployeeStatsResponse
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
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.DIRECTOR)),
):
    """
    List all employee actuals with project, cost center, approval status, and current approval step.
    Filterable by project, cost center, period, approval status.
    Accessible to: Finance, Director
    """
    service = FinanceService(db, current_user)
    return service.get_actuals_dashboard(year, month, project_id, cost_center_id, approval_status)

@router.get("/actuals-vs-plan", response_model=List[FinanceCostCenterStatsResponse])
async def actuals_vs_plan(
    year: int = Query(...),
    month: int = Query(...),
    cost_center_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.DIRECTOR)),
):
    """
    Get demand, supply, and actuals per cost center for a given period.
    Optionally filter to a single cost center.
    Accessible to: Finance, Director
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
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE, UserRole.DIRECTOR)),
):
    """
    Get demand and actuals FTE per employee for a given period.
    Filterable by cost center and project.
    Accessible to: Finance, Director
    """
    service = FinanceService(db, current_user)
    return service.get_employee_stats(year, month, cost_center_id, project_id)
