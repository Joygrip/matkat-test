"""
Dashboard analytics service: aggregate demand/supply by cost center and project for all open periods.
"""
from sqlalchemy.orm import Session
from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.core import CostCenter, Project, PeriodStatus, Period
from collections import defaultdict
from typing import Dict, Tuple, Optional
from api.app.schemas.dashboard import DemandSupplyAggregationResponse, DemandSupplyByCostCenter, DemandSupplyByProject

def get_demand_supply_aggregation(db: Session, user) -> DemandSupplyAggregationResponse:
    # Get all open periods
    open_periods = db.query(Period).filter(Period.status == PeriodStatus.OPEN).all()
    period_ids = [p.id for p in open_periods]
    period_map = {p.id: {'year': p.year, 'month': p.month} for p in open_periods}

    # Aggregate demand lines
    demand_lines = db.query(DemandLine).filter(DemandLine.period_id.in_(period_ids)).all()
    # Aggregate supply lines
    supply_lines = db.query(SupplyLine).filter(SupplyLine.period_id.in_(period_ids)).all()

    # By cost center
    cc_agg: Dict[Tuple[Optional[str], int, int], DemandSupplyByCostCenter] = {}
    # By project
    proj_agg: Dict[Tuple[Optional[str], int, int], DemandSupplyByProject] = {}

    # Demand by cost center
    for d in demand_lines:
        cc_id = getattr(d.project, 'cost_center_id', None) if d.project else None
        cc_name = getattr(getattr(d.project, 'cost_center', None), 'name', None) if d.project and getattr(d.project, 'cost_center', None) else None
        period = period_map.get(d.period_id, {})
        year = int(period.get('year', 0) or 0)
        month = int(period.get('month', 0) or 0)
        key = (cc_id, year, month)
        if cc_id:
            if key not in cc_agg:
                cc_agg[key] = DemandSupplyByCostCenter(
                    cost_center_id=cc_id,
                    cost_center_name=cc_name,
                    year=year,
                    month=month,
                    demand_fte=0,
                    supply_fte=0,
                )
            cc_agg[key].demand_fte += float(d.fte_percent or 0)
    # Supply by cost center
    for s in supply_lines:
        cc_id = getattr(s.resource, 'cost_center_id', None) if s.resource else None
        cc_name = getattr(getattr(s.resource, 'cost_center', None), 'name', None) if s.resource and getattr(s.resource, 'cost_center', None) else None
        period = period_map.get(s.period_id, {})
        year = int(period.get('year', 0) or 0)
        month = int(period.get('month', 0) or 0)
        key = (cc_id, year, month)
        if cc_id:
            if key not in cc_agg:
                cc_agg[key] = DemandSupplyByCostCenter(
                    cost_center_id=cc_id,
                    cost_center_name=cc_name,
                    year=year,
                    month=month,
                    demand_fte=0,
                    supply_fte=0,
                )
            cc_agg[key].supply_fte += float(s.fte_percent or 0)

    # Demand by project
    for d in demand_lines:
        proj_id = d.project_id
        proj_name = getattr(d.project, 'name', None) if d.project else None
        period = period_map.get(d.period_id, {})
        year = int(period.get('year', 0) or 0)
        month = int(period.get('month', 0) or 0)
        key = (proj_id, year, month)
        if proj_id:
            if key not in proj_agg:
                proj_agg[key] = DemandSupplyByProject(
                    project_id=proj_id,
                    project_name=proj_name,
                    year=year,
                    month=month,
                    demand_fte=0,
                    supply_fte=0,
                )
            proj_agg[key].demand_fte += float(d.fte_percent or 0)
    # Supply by project
    for s in supply_lines:
        proj_id = s.project_id
        proj_name = getattr(s.project, 'name', None) if s.project else None
        period = period_map.get(s.period_id, {})
        year = int(period.get('year', 0) or 0)
        month = int(period.get('month', 0) or 0)
        key = (proj_id, year, month)
        if proj_id:
            if key not in proj_agg:
                proj_agg[key] = DemandSupplyByProject(
                    project_id=proj_id,
                    project_name=proj_name,
                    year=year,
                    month=month,
                    demand_fte=0,
                    supply_fte=0,
                )
            proj_agg[key].supply_fte += float(s.fte_percent or 0)

    return DemandSupplyAggregationResponse(
        by_cost_center=list(cc_agg.values()),
        by_project=list(proj_agg.values()),
    )
