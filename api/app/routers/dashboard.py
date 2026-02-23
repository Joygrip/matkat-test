"""
Dashboard analytics endpoints for demand/supply by cost center and project for all open periods.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, CurrentUser
from api.app.models.core import UserRole
from api.app.services.dashboard import get_demand_supply_aggregation
from api.app.schemas.dashboard import DemandSupplyAggregationResponse

router = APIRouter(tags=["Dashboard"])

@router.get("/dashboard/aggregation", response_model=DemandSupplyAggregationResponse)
def demand_supply_aggregation(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    """
    Aggregate demand and supply by cost center and project for all open periods.
    """
    return get_demand_supply_aggregation(db, user)
