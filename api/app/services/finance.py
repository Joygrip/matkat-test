from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from api.app.auth.dependencies import CurrentUser
from api.app.models.actuals import ActualLine
from api.app.models.core import User, Project, Resource, CostCenter
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
from api.app.schemas.finance import (
    FinanceActualsDashboardResponse,
    FinanceCostCenterStatsResponse,
    FinanceEmployeeStatsResponse,
)

class FinanceService:
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user

    def get_actuals_dashboard(
        self,
        year: Optional[int] = None,
        month: Optional[int] = None,
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
        approval_status: Optional[str] = None,
    ) -> List[FinanceActualsDashboardResponse]:
        query = self.db.query(ActualLine, Resource, Project, CostCenter, ApprovalInstance)
        query = query.join(Resource, ActualLine.resource_id == Resource.id)
        query = query.join(Project, ActualLine.project_id == Project.id)
        query = query.join(CostCenter, Resource.cost_center_id == CostCenter.id)
        query = query.outerjoin(
            ApprovalInstance,
            (ApprovalInstance.subject_type == "actuals") & (ApprovalInstance.subject_id == ActualLine.id)
        )
        filters = [ActualLine.tenant_id == self.current_user.tenant_id]
        if year:
            filters.append(ActualLine.year == year)
        if month:
            filters.append(ActualLine.month == month)
        if project_id:
            filters.append(Project.id == project_id)
        if cost_center_id:
            filters.append(CostCenter.id == cost_center_id)
        if approval_status:
            filters.append(ApprovalInstance.status == approval_status)
        query = query.filter(and_(*filters))
        results = []
        for actual, resource, project, cost_center, approval in query.all():
            # Find current approval step if pending
            current_step = None
            current_approver_name = None
            if approval and approval.status == ApprovalStatus.PENDING:
                for step in sorted(approval.steps, key=lambda s: s.step_order):
                    if step.status == StepStatus.PENDING:
                        current_step = step.step_name
                        if step.approver_id:
                            approver = self.db.query(User).filter(User.id == step.approver_id).first()
                            if approver:
                                current_approver_name = approver.display_name
                        break
            results.append(FinanceActualsDashboardResponse(
                actual_id=actual.id,
                employee_name=resource.display_name,
                employee_email=resource.email or "",
                project_id=project.id,
                project_name=project.name,
                cost_center_id=cost_center.id,
                cost_center_name=cost_center.name,
                year=actual.year,
                month=actual.month,
                fte_percent=actual.actual_fte_percent,
                approval_status=approval.status if approval else "N/A",
                current_approval_step=current_step,
                current_approver_name=current_approver_name,
            ))
        return results

    def get_cost_center_stats(
        self,
        year: int,
        month: int,
        cost_center_id: Optional[str] = None,
    ) -> List[FinanceCostCenterStatsResponse]:
        from api.app.models.planning import DemandLine, SupplyLine
        from api.app.models.actuals import ActualLine
        from api.app.models.core import CostCenter, Resource
        from sqlalchemy import func

        from api.app.models.core import User
        resource_filters = [Resource.tenant_id == self.current_user.tenant_id]
        if cost_center_id:
            resource_filters.append(Resource.cost_center_id == cost_center_id)

        # Subqueries for demand, supply, actuals
        demand_subq = (
            self.db.query(
                Resource.cost_center_id.label("cost_center_id"),
                func.sum(DemandLine.fte_percent).label("demand_fte")
            )
            .join(Resource, DemandLine.resource_id == Resource.id)
            .join(User, Resource.user_id == User.id)
            .filter(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.year == year,
                DemandLine.month == month,
                *resource_filters
            )
            .group_by(Resource.cost_center_id)
            .subquery()
        )
        supply_subq = (
            self.db.query(
                Resource.cost_center_id.label("cost_center_id"),
                func.sum(SupplyLine.fte_percent).label("supply_fte")
            )
            .join(Resource, SupplyLine.resource_id == Resource.id)
            .join(User, Resource.user_id == User.id)
            .filter(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.year == year,
                SupplyLine.month == month,
                *resource_filters
            )
            .group_by(Resource.cost_center_id)
            .subquery()
        )
        actuals_subq = (
            self.db.query(
                Resource.cost_center_id.label("cost_center_id"),
                func.sum(ActualLine.actual_fte_percent).label("actuals_fte")
            )
            .join(Resource, ActualLine.resource_id == Resource.id)
            .join(User, Resource.user_id == User.id)
            .filter(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.year == year,
                ActualLine.month == month,
                *resource_filters
            )
            .group_by(Resource.cost_center_id)
            .subquery()
        )
        # Join all subqueries on cost_center_id
        q = (
            self.db.query(
                CostCenter.id.label("cost_center_id"),
                CostCenter.name.label("cost_center_name"),
                func.coalesce(demand_subq.c.demand_fte, 0).label("demand_fte"),
                func.coalesce(supply_subq.c.supply_fte, 0).label("supply_fte"),
                func.coalesce(actuals_subq.c.actuals_fte, 0).label("actuals_fte"),
            )
            .outerjoin(demand_subq, CostCenter.id == demand_subq.c.cost_center_id)
            .outerjoin(supply_subq, CostCenter.id == supply_subq.c.cost_center_id)
            .outerjoin(actuals_subq, CostCenter.id == actuals_subq.c.cost_center_id)
            .filter(CostCenter.tenant_id == self.current_user.tenant_id)
        )
        if cost_center_id:
            q = q.filter(CostCenter.id == cost_center_id)
        results = q.all()
        return [
            FinanceCostCenterStatsResponse(
                cost_center_id=row.cost_center_id,
                cost_center_name=row.cost_center_name,
                demand_fte=float(row.demand_fte or 0),
                supply_fte=float(row.supply_fte or 0),
                actuals_fte=float(row.actuals_fte or 0),
            )
            for row in results
        ]

    def get_employee_stats(
        self,
        year: int,
        month: int,
        cost_center_id: Optional[str] = None,
        project_id: Optional[str] = None,
    ) -> List[FinanceEmployeeStatsResponse]:
        """Get demand vs actuals per employee for a given period."""
        from api.app.models.planning import DemandLine
        from api.app.models.core import Resource
        from sqlalchemy import func

        resource_filters = [Resource.tenant_id == self.current_user.tenant_id]
        if cost_center_id:
            resource_filters.append(Resource.cost_center_id == cost_center_id)

        demand_filters = [
            DemandLine.tenant_id == self.current_user.tenant_id,
            DemandLine.year == year,
            DemandLine.month == month,
            DemandLine.resource_id.isnot(None),
        ]
        if project_id:
            demand_filters.append(DemandLine.project_id == project_id)

        actuals_filters = [
            ActualLine.tenant_id == self.current_user.tenant_id,
            ActualLine.year == year,
            ActualLine.month == month,
        ]
        if project_id:
            actuals_filters.append(ActualLine.project_id == project_id)

        demand_subq = (
            self.db.query(
                DemandLine.resource_id.label("resource_id"),
                func.sum(DemandLine.fte_percent).label("demand_fte"),
            )
            .filter(*demand_filters)
            .group_by(DemandLine.resource_id)
            .subquery()
        )
        actuals_subq = (
            self.db.query(
                ActualLine.resource_id.label("resource_id"),
                func.sum(ActualLine.actual_fte_percent).label("actuals_fte"),
            )
            .filter(*actuals_filters)
            .group_by(ActualLine.resource_id)
            .subquery()
        )

        q = (
            self.db.query(
                Resource.id.label("resource_id"),
                Resource.display_name.label("employee_name"),
                func.coalesce(demand_subq.c.demand_fte, 0).label("demand_fte"),
                func.coalesce(actuals_subq.c.actuals_fte, 0).label("actuals_fte"),
            )
            .outerjoin(demand_subq, Resource.id == demand_subq.c.resource_id)
            .outerjoin(actuals_subq, Resource.id == actuals_subq.c.resource_id)
            .filter(*resource_filters)
            .filter(
                or_(
                    demand_subq.c.resource_id.isnot(None),
                    actuals_subq.c.resource_id.isnot(None),
                )
            )
        )
        rows = q.distinct().all()
        return [
            FinanceEmployeeStatsResponse(
                resource_id=row.resource_id,
                employee_name=row.employee_name,
                demand_fte=float(row.demand_fte or 0),
                actuals_fte=float(row.actuals_fte or 0),
            )
            for row in rows
        ]
