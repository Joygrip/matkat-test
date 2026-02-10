from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from api.app.auth.dependencies import CurrentUser
from api.app.models.actuals import ActualLine
from api.app.models.core import User, Project, Resource, CostCenter
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
from api.app.schemas.finance import FinanceActualsDashboardResponse

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
