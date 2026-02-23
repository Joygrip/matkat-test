"""
Dashboard analytics schemas for demand/supply aggregation by cost center and project.
"""
from pydantic import BaseModel
from typing import List, Optional

class DemandSupplyByCostCenter(BaseModel):
    cost_center_id: str
    cost_center_name: Optional[str]
    year: int
    month: int
    demand_fte: float
    supply_fte: float

class DemandSupplyByProject(BaseModel):
    project_id: str
    project_name: Optional[str]
    year: int
    month: int
    demand_fte: float
    supply_fte: float

class DemandSupplyAggregationResponse(BaseModel):
    by_cost_center: List[DemandSupplyByCostCenter]
    by_project: List[DemandSupplyByProject]
