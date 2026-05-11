from typing import Optional, List
from pydantic import BaseModel


class FinanceActualsDashboardResponse(BaseModel):
    actual_id: str
    employee_name: str
    employee_email: Optional[str] = None
    employee_initials: Optional[str] = None
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
    approval_instance_id: Optional[str] = None
    current_step_id: Optional[str] = None
    current_approver_object_id: Optional[str] = None
    can_action: bool = False
    can_proxy_approve_step1: bool = False
    step1_id: Optional[str] = None
    is_delegated: bool = False
    delegated_for: Optional[str] = None

class FinanceCostCenterStatsResponse(BaseModel):
    cost_center_id: str
    cost_center_name: str
    demand_fte: float
    supply_fte: float
    actuals_fte: float


class ProjectBreakdownItem(BaseModel):
    project_id: str
    project_name: str
    demand_fte: float
    supply_fte: float = 0.0
    actuals_fte: float


class FinanceEmployeeStatsResponse(BaseModel):
    resource_id: str
    employee_name: str
    demand_fte: float
    supply_fte: float
    actuals_fte: float
    projects: List[ProjectBreakdownItem] = []


class FinanceSettingResponse(BaseModel):
    setting_key: str
    setting_value: str  # caller parses to int/float as needed
    updated_at: Optional[str] = None


class FinanceSettingUpdate(BaseModel):
    setting_value: str


class ConsolidatedCostByProject(BaseModel):
    project_id: str
    project_name: str
    cost_center_id: Optional[str] = None
    cost_center_name: Optional[str] = None
    year: int
    month: int
    demand_cost: int       # planned labor cost in cents
    actuals_cost: int      # actual labor cost in cents
    externals_cost: int    # external contractor cost in cents
    equipment_cost: int    # equipment cost in cents


class ConsolidatedCostResponse(BaseModel):
    data: List[ConsolidatedCostByProject]
    monthly_fte_cost: int  # cents, so frontend can display rate context


class DemandLineDetail(BaseModel):
    resource_name: str
    fte_percent: int
    cost: int  # cents
    project_name: Optional[str] = None  # populated when drilling from cost center


class ActualLineDetail(BaseModel):
    resource_name: str
    fte_percent: int  # actual_fte_percent
    cost: int  # cents
    project_name: Optional[str] = None


class ExternalLineDetail(BaseModel):
    resource_name: Optional[str]
    description: Optional[str]
    notes: Optional[str]
    hours: int
    rate: int       # cents/hr
    total_cost: int  # cents
    project_name: Optional[str] = None


class EquipmentLineDetail(BaseModel):
    description: Optional[str]
    cost: int  # cents
    project_name: Optional[str] = None


class ConsolidatedCostDetail(BaseModel):
    # One of project_id or cost_center_id will be set depending on drill-down mode
    project_id: Optional[str] = None
    project_name: Optional[str] = None
    cost_center_id: Optional[str] = None
    cost_center_name: Optional[str] = None
    year: int
    month: int
    monthly_fte_cost: int
    demand_lines: List[DemandLineDetail]
    actual_lines: List[ActualLineDetail]
    external_lines: List[ExternalLineDetail]
    equipment_lines: List[EquipmentLineDetail]
