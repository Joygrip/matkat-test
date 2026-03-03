from typing import Optional
from pydantic import BaseModel

class FinanceActualsDashboardResponse(BaseModel):
    actual_id: str
    employee_name: str
    employee_email: Optional[str] = None
    project_id: str
    project_name: str
    cost_center_id: str
    cost_center_name: str
    year: int
    month: int
    fte_percent: int
    approval_status: str
    current_approval_step: Optional[str]
    current_approver_name: Optional[str]

class FinanceCostCenterStatsResponse(BaseModel):
    cost_center_id: str
    cost_center_name: str
    demand_fte: float
    supply_fte: float
    actuals_fte: float


class FinanceEmployeeStatsResponse(BaseModel):
    resource_id: str
    employee_name: str
    demand_fte: float
    actuals_fte: float
