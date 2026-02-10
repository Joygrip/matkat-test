"""Finance dashboard endpoints."""
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.schemas.finance import FinanceActualsDashboardResponse
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
    current_user: CurrentUser = Depends(require_roles(UserRole.FINANCE)),
):
    """
    List all employee actuals with project, cost center, approval status, and current approval step.
    Filterable by project, cost center, period, approval status.
    Accessible to: Finance
    """
    service = FinanceService(db, current_user)
    return service.get_actuals_dashboard(year, month, project_id, cost_center_id, approval_status)
