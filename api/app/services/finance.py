from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from api.app.auth.dependencies import CurrentUser
from api.app.models.actuals import ActualLine
from sqlalchemy import exists as sa_exists
from fastapi import HTTPException
from api.app.models.core import User, Project, ProjectPM, Resource, CostCenter, Period, PeriodStatus
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
from api.app.models.finance import FinanceSetting
from api.app.services.period import PeriodService
from api.app.schemas.finance import (
    FinanceActualsDashboardResponse,
    FinanceCostCenterStatsResponse,
    FinanceEmployeeStatsResponse,
    ProjectBreakdownItem,
    FinanceSettingResponse,
    ConsolidatedCostByProject,
    ConsolidatedCostResponse,
    DemandLineDetail,
    ActualLineDetail,
    ExternalLineDetail,
    EquipmentLineDetail,
    ConsolidatedCostDetail,
)

DEFAULT_MONTHLY_FTE_COST = "99000"

class FinanceService:
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user

    def _get_global_monthly_fte_cost_value(self) -> int:
        """Read tenant-level fallback rate from finance_settings or default."""
        row = (
            self.db.query(FinanceSetting)
            .filter(
                FinanceSetting.tenant_id == self.current_user.tenant_id,
                FinanceSetting.setting_key == "monthly_fte_cost",
            )
            .first()
        )
        if row is None:
            return int(DEFAULT_MONTHLY_FTE_COST)
        try:
            parsed = int(row.setting_value)
            return parsed if parsed > 0 else int(DEFAULT_MONTHLY_FTE_COST)
        except (TypeError, ValueError):
            return int(DEFAULT_MONTHLY_FTE_COST)

    def _get_monthly_fte_cost_for_period(self, period_id: str) -> int:
        """Resolve monthly FTE cost for one period with transition fallback."""
        period = (
            self.db.query(Period)
            .filter(
                Period.tenant_id == self.current_user.tenant_id,
                Period.id == period_id,
            )
            .first()
        )
        if period is None:
            raise HTTPException(status_code=404, detail="Period not found.")

        if period.monthly_fte_cost is not None:
            return int(period.monthly_fte_cost)
        return self._get_global_monthly_fte_cost_value()

    def _get_monthly_fte_costs_by_period(self, period_ids: set[str]) -> dict[str, int]:
        """Resolve monthly FTE cost per period for multi-period cost calculations."""
        if not period_ids:
            return {}

        rows = (
            self.db.query(Period.id, Period.monthly_fte_cost)
            .filter(
                Period.tenant_id == self.current_user.tenant_id,
                Period.id.in_(list(period_ids)),
            )
            .all()
        )

        fallback = self._get_global_monthly_fte_cost_value()
        rate_by_period: dict[str, int] = {}
        for pid, rate in rows:
            rate_by_period[pid] = int(rate) if rate is not None else fallback
        return rate_by_period

    def _approved_actual_ids_subq(self):
        """
        Subquery returning ActualLine.id values whose latest ApprovalInstance
        has status == APPROVED. Actuals with no instance (unsigned/pending/rejected)
        are excluded — only fully approved actuals are included in cost calculations.
        """
        latest_subq = (
            self.db.query(
                ApprovalInstance.subject_id.label("actual_id"),
                func.max(ApprovalInstance.created_at).label("max_created"),
            )
            .filter(
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
            )
            .group_by(ApprovalInstance.subject_id)
            .subquery()
        )
        return (
            self.db.query(ApprovalInstance.subject_id)
            .join(
                latest_subq,
                and_(
                    ApprovalInstance.subject_id == latest_subq.c.actual_id,
                    ApprovalInstance.created_at == latest_subq.c.max_created,
                    ApprovalInstance.subject_type == "actuals",
                ),
            )
            .filter(ApprovalInstance.status == ApprovalStatus.APPROVED)
            .subquery()
        )

    def get_actuals_dashboard(
        self,
        year: Optional[int] = None,
        month: Optional[int] = None,
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
        approval_status: Optional[str] = None,
    ) -> List[FinanceActualsDashboardResponse]:
        # Manager restriction: scope to accessible resources via reporting hierarchy
        # (same logic as ActualsService — uses reporting_cache + overrides, falls back to cost center RO/Director)
        # Also includes resources accessible via active delegation grants.
        scoped_resource_ids: Optional[list] = None
        if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
            from api.app.services.reporting import ReportingService
            _rs = ReportingService(self.db, self.current_user)
            _ids = list(_rs.get_accessible_resource_ids())
            _cur_user = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            if _cur_user:
                for _rid in _rs.get_delegated_resource_ids(_cur_user.id):
                    if _rid not in _ids:
                        _ids.append(_rid)
            scoped_resource_ids = _ids
            if not scoped_resource_ids:
                return []

        # Subquery: latest approval instance per actual (handles re-submissions)
        latest_approval_subq = (
            self.db.query(
                ApprovalInstance.subject_id.label("actual_id"),
                func.max(ApprovalInstance.created_at).label("max_created_at"),
            )
            .filter(ApprovalInstance.subject_type == "actuals")
            .group_by(ApprovalInstance.subject_id)
            .subquery()
        )

        query = self.db.query(ActualLine, Resource, Project, CostCenter, ApprovalInstance)
        query = query.join(Resource, ActualLine.resource_id == Resource.id)
        query = query.join(Project, ActualLine.project_id == Project.id)
        query = query.join(CostCenter, Resource.cost_center_id == CostCenter.id)
        query = query.outerjoin(
            latest_approval_subq,
            latest_approval_subq.c.actual_id == ActualLine.id,
        )
        query = query.outerjoin(
            ApprovalInstance,
            and_(
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id == ActualLine.id,
                ApprovalInstance.created_at == latest_approval_subq.c.max_created_at,
            )
        )
        filters = [ActualLine.tenant_id == self.current_user.tenant_id]
        if scoped_resource_ids is not None:
            filters.append(ActualLine.resource_id.in_(scoped_resource_ids))
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

        rows = query.all()

        # Batch-load approver User.object_id to avoid N+1 queries
        # Also collect step 2 approver IDs for proxy-approve-step1 checks
        approver_ids = set()
        step2_approver_ids = set()
        for actual, resource, project, cost_center, approval in rows:
            if approval and approval.status == ApprovalStatus.PENDING:
                sorted_steps = sorted(approval.steps, key=lambda s: s.step_order)
                current_pending = next((s for s in sorted_steps if s.status == StepStatus.PENDING), None)
                if current_pending and current_pending.approver_id:
                    approver_ids.add(current_pending.approver_id)
                # Collect step 2 approver for proxy-approve-step1 eligibility
                step2 = next((s for s in sorted_steps if s.step_order == 2), None)
                if step2 and step2.approver_id:
                    step2_approver_ids.add(step2.approver_id)

        all_approver_ids = approver_ids | step2_approver_ids
        approver_object_id_map: dict = {}
        if all_approver_ids:
            approver_users = (
                self.db.query(User.id, User.object_id, User.display_name)
                .filter(User.id.in_(all_approver_ids))
                .all()
            )
            for uid, oid, name in approver_users:
                approver_object_id_map[uid] = (oid, name)

        # Resolve current user's User.id for can_action check (direct approver or delegate)
        from api.app.models.core import ApprovalDelegate
        current_db_user = self.db.query(User).filter(
            User.tenant_id == self.current_user.tenant_id,
            User.object_id == self.current_user.object_id,
        ).first()
        current_db_user_id = current_db_user.id if current_db_user else None

        # Build map of approver_ids for which current user is an active delegate
        # Maps delegator_id -> delegator_display_name for audit attribution
        delegate_for: dict[str, str] = {}
        if current_db_user_id and all_approver_ids:
            delegate_rows = self.db.query(
                ApprovalDelegate.delegator_id, User.display_name
            ).join(User, User.id == ApprovalDelegate.delegator_id).filter(
                ApprovalDelegate.tenant_id == self.current_user.tenant_id,
                ApprovalDelegate.delegate_id == current_db_user_id,
                ApprovalDelegate.delegator_id.in_(all_approver_ids),
                ApprovalDelegate.is_active == True,
            ).all()
            delegate_for = {row.delegator_id: row.display_name for row in delegate_rows}

        results = []
        for actual, resource, project, cost_center, approval in rows:
            # Find current pending approval step
            current_step_name = None
            current_approver_name = None
            current_step_id = None
            approval_instance_id = None
            current_approver_object_id = None
            can_action = False
            can_proxy_approve_step1 = False
            step1_id = None
            is_delegated = False
            delegated_for_name: Optional[str] = None

            if approval and approval.status == ApprovalStatus.PENDING:
                approval_instance_id = approval.id
                sorted_steps = sorted(approval.steps, key=lambda s: s.step_order)
                for step in sorted_steps:
                    if step.status == StepStatus.PENDING:
                        current_step_name = step.step_name
                        current_step_id = step.id
                        if step.approver_id and step.approver_id in approver_object_id_map:
                            oid, name = approver_object_id_map[step.approver_id]
                            current_approver_name = name
                            current_approver_object_id = oid
                        # can_action: current user is direct approver or active delegate
                        if step.approver_id and current_db_user_id:
                            is_direct = step.approver_id == current_db_user_id
                            delegate_name = delegate_for.get(step.approver_id)
                            can_action = is_direct or delegate_name is not None
                            if can_action and not is_direct and delegate_name:
                                is_delegated = True
                                delegated_for_name = delegate_name
                        break

                # can_proxy_approve_step1: current user is step 2 approver (or delegate)
                # and step 1 is still pending
                step1 = next((s for s in sorted_steps if s.step_order == 1), None)
                step2 = next((s for s in sorted_steps if s.step_order == 2), None)
                if (step1 and step1.status == StepStatus.PENDING
                        and step2 and step2.status == StepStatus.PENDING
                        and step2.approver_id and current_db_user_id):
                    can_proxy_approve_step1 = (
                        step2.approver_id == current_db_user_id
                        or step2.approver_id in delegate_for
                    )
                    if can_proxy_approve_step1:
                        step1_id = step1.id

            results.append(FinanceActualsDashboardResponse(
                actual_id=actual.id,
                employee_name=resource.display_name,
                employee_email=resource.email or "",
                employee_initials=resource.initials,
                project_id=project.id,
                project_name=project.name,
                cost_center_id=cost_center.id,
                cost_center_name=cost_center.name,
                year=actual.year,
                month=actual.month,
                fte_percent=actual.actual_fte_percent,
                approval_status=approval.status if approval else "N/A",
                current_approval_step=current_step_name,
                current_approver_name=current_approver_name,
                approval_instance_id=approval_instance_id,
                current_step_id=current_step_id,
                current_approver_object_id=current_approver_object_id,
                can_action=can_action,
                can_proxy_approve_step1=can_proxy_approve_step1,
                is_delegated=is_delegated,
                delegated_for=delegated_for_name,
                step1_id=step1_id,
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

        # Manager restriction: scope to accessible resources via reporting hierarchy
        # Also includes resources accessible via active delegation grants.
        scoped_resource_ids_cc: Optional[list] = None
        if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
            from api.app.services.reporting import ReportingService
            _rs2 = ReportingService(self.db, self.current_user)
            _ids2 = list(_rs2.get_accessible_resource_ids())
            _cur_user2 = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            if _cur_user2:
                for _rid2 in _rs2.get_delegated_resource_ids(_cur_user2.id):
                    if _rid2 not in _ids2:
                        _ids2.append(_rid2)
            scoped_resource_ids_cc = _ids2
            if not scoped_resource_ids_cc:
                return []

        from api.app.models.core import User
        resource_filters = [Resource.tenant_id == self.current_user.tenant_id]
        if scoped_resource_ids_cc is not None:
            resource_filters.append(Resource.id.in_(scoped_resource_ids_cc))
        elif cost_center_id:
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
        approved_subq = self._approved_actual_ids_subq()
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
                ActualLine.id.in_(approved_subq),
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
        from collections import defaultdict
        from api.app.models.planning import DemandLine, SupplyLine
        from api.app.models.core import Resource, Project as ProjectModel, CostCenter
        from sqlalchemy import func

        # Manager restriction: scope to accessible resources via reporting hierarchy
        # Also includes resources accessible via active delegation grants.
        scoped_resource_ids_emp: Optional[list] = None
        if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
            from api.app.services.reporting import ReportingService
            _rs = ReportingService(self.db, self.current_user)
            _ids = list(_rs.get_accessible_resource_ids())
            _cur_user = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            if _cur_user:
                for _rid in _rs.get_delegated_resource_ids(_cur_user.id):
                    if _rid not in _ids:
                        _ids.append(_rid)
            scoped_resource_ids_emp = _ids
            if not scoped_resource_ids_emp:
                return []

        resource_filters = [Resource.tenant_id == self.current_user.tenant_id]
        if scoped_resource_ids_emp is not None:
            resource_filters.append(Resource.id.in_(scoped_resource_ids_emp))
        elif cost_center_id:
            resource_filters.append(Resource.cost_center_id == cost_center_id)

        demand_filters = [
            DemandLine.tenant_id == self.current_user.tenant_id,
            DemandLine.year == year,
            DemandLine.month == month,
            DemandLine.resource_id.isnot(None),
        ]
        if project_id:
            demand_filters.append(DemandLine.project_id == project_id)

        approved_subq_emp = self._approved_actual_ids_subq()
        actuals_filters = [
            ActualLine.tenant_id == self.current_user.tenant_id,
            ActualLine.year == year,
            ActualLine.month == month,
        ]
        if project_id:
            actuals_filters.append(ActualLine.project_id == project_id)

        supply_filters = [
            SupplyLine.tenant_id == self.current_user.tenant_id,
            SupplyLine.year == year,
            SupplyLine.month == month,
        ]
        if scoped_resource_ids_emp is not None:
            supply_filters.append(SupplyLine.resource_id.in_(scoped_resource_ids_emp))

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
        supply_subq = (
            self.db.query(
                SupplyLine.resource_id.label("resource_id"),
                func.sum(SupplyLine.fte_percent).label("supply_fte"),
            )
            .filter(*supply_filters)
            .group_by(SupplyLine.resource_id)
            .subquery()
        )

        q = (
            self.db.query(
                Resource.id.label("resource_id"),
                Resource.display_name.label("employee_name"),
                Resource.email.label("employee_email"),
                Resource.cost_center_id.label("cost_center_id"),
                CostCenter.name.label("cost_center_name"),
                Resource.initials.label("initials"),
                func.coalesce(demand_subq.c.demand_fte, 0).label("demand_fte"),
                func.coalesce(supply_subq.c.supply_fte, 0).label("supply_fte"),
                func.coalesce(actuals_subq.c.actuals_fte, 0).label("actuals_fte"),
            )
            .outerjoin(CostCenter, Resource.cost_center_id == CostCenter.id)
            .outerjoin(demand_subq, Resource.id == demand_subq.c.resource_id)
            .outerjoin(supply_subq, Resource.id == supply_subq.c.resource_id)
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

        # Per-project breakdown — scope to only the resources in the result
        result_resource_ids = [r.resource_id for r in rows]
        proj_map: dict = defaultdict(list)

        if result_resource_ids:
            proj_demand_filters = [
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.year == year,
                DemandLine.month == month,
                DemandLine.resource_id.isnot(None),
                DemandLine.resource_id.in_(result_resource_ids),
            ]
            if project_id:
                proj_demand_filters.append(DemandLine.project_id == project_id)

            proj_actuals_filters = [
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.year == year,
                ActualLine.month == month,
                ActualLine.resource_id.in_(result_resource_ids),
            ]
            if project_id:
                proj_actuals_filters.append(ActualLine.project_id == project_id)

            proj_demand_rows = (
                self.db.query(
                    DemandLine.resource_id.label("resource_id"),
                    DemandLine.project_id.label("project_id"),
                    ProjectModel.name.label("project_name"),
                    func.sum(DemandLine.fte_percent).label("demand_fte"),
                )
                .join(ProjectModel, DemandLine.project_id == ProjectModel.id)
                .filter(*proj_demand_filters)
                .group_by(DemandLine.resource_id, DemandLine.project_id, ProjectModel.name)
                .all()
            )

            proj_actuals_rows = (
                self.db.query(
                    ActualLine.resource_id.label("resource_id"),
                    ActualLine.project_id.label("project_id"),
                    func.sum(ActualLine.actual_fte_percent).label("actuals_fte"),
                )
                .filter(*proj_actuals_filters)
                .group_by(ActualLine.resource_id, ActualLine.project_id)
                .all()
            )

            proj_actuals_by = {
                (r.resource_id, r.project_id): float(r.actuals_fte or 0)
                for r in proj_actuals_rows
            }

            proj_supply_filters = [
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.year == year,
                SupplyLine.month == month,
                SupplyLine.resource_id.in_(result_resource_ids),
                SupplyLine.project_id.isnot(None),
            ]
            proj_supply_rows = (
                self.db.query(
                    SupplyLine.resource_id.label("resource_id"),
                    SupplyLine.project_id.label("project_id"),
                    func.sum(SupplyLine.fte_percent).label("supply_fte"),
                )
                .filter(*proj_supply_filters)
                .group_by(SupplyLine.resource_id, SupplyLine.project_id)
                .all()
            )
            proj_supply_by = {
                (r.resource_id, r.project_id): float(r.supply_fte or 0)
                for r in proj_supply_rows
            }

            for r in proj_demand_rows:
                proj_map[r.resource_id].append(
                    ProjectBreakdownItem(
                        project_id=r.project_id,
                        project_name=r.project_name,
                        demand_fte=float(r.demand_fte or 0),
                        supply_fte=proj_supply_by.get((r.resource_id, r.project_id), 0.0),
                        actuals_fte=proj_actuals_by.get((r.resource_id, r.project_id), 0.0),
                    )
                )

        return [
            FinanceEmployeeStatsResponse(
                resource_id=row.resource_id,
                employee_name=row.employee_name,
                employee_email=row.employee_email or '',
                cost_center_id=row.cost_center_id,
                cost_center_name=row.cost_center_name,
                employee_initials=row.initials,
                demand_fte=float(row.demand_fte or 0),
                supply_fte=float(row.supply_fte or 0),
                actuals_fte=float(row.actuals_fte or 0),
                projects=proj_map.get(row.resource_id, []),
            )
            for row in rows
        ]

    def get_consolidated_cost_detail(
        self,
        year: int,
        month: int,
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
        cost_center_code: Optional[str] = None,
    ) -> ConsolidatedCostDetail:
        """Return per-line detail for one project or cost center + period."""
        from api.app.models.planning import DemandLine
        from api.app.models.actuals import ActualLine
        from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine
        from api.app.models.core import Project, Resource, CostCenter
        from fastapi import HTTPException

        # Resolve period UUID
        period = PeriodService(self.db, self.current_user).get_by_year_month(year, month)
        if period is None:
            raise HTTPException(status_code=404, detail="Period not found.")

        monthly_fte_cost = self._get_monthly_fte_cost_for_period(period.id)

        if cost_center_id or cost_center_code:
            # CC mode — filter lines by Resource.cost_center_id.
            # Resolve the list of CC IDs and display fields up front.
            if cost_center_code and not cost_center_id:
                # Code-grouped mode: collect all CCs that share this code.
                cc_id_list = [
                    row.id for row in
                    self.db.query(CostCenter.id)
                    .filter(
                        CostCenter.tenant_id == self.current_user.tenant_id,
                        CostCenter.code == cost_center_code,
                    )
                    .all()
                ]
                if not cc_id_list:
                    raise HTTPException(status_code=404, detail="No cost centers found for that code.")
                display_id: Optional[str] = None
                display_name: str = cost_center_code
            else:
                cc = (
                    self.db.query(CostCenter)
                    .filter(
                        CostCenter.tenant_id == self.current_user.tenant_id,
                        CostCenter.id == cost_center_id,
                    )
                    .first()
                )
                if cc is None:
                    raise HTTPException(status_code=404, detail="Cost center not found.")
                cc_id_list = [cost_center_id]
                display_id = cc.id
                display_name = cc.name

            # PM restriction: collect allowed project IDs up front
            cc_pm_project_ids: Optional[list] = None
            if self.current_user.role == "PM":
                pm_user = self.db.query(User).filter(
                    User.tenant_id == self.current_user.tenant_id,
                    User.object_id == self.current_user.object_id,
                ).first()
                if pm_user:
                    cc_pm_project_ids = [
                        r.project_id
                        for r in self.db.query(ProjectPM.project_id)
                        .filter(ProjectPM.user_id == pm_user.id)
                        .all()
                    ]
                else:
                    cc_pm_project_ids = []

            # Manager restriction (non-Reader): scope to accessible resources only
            cc_manager_resource_ids: Optional[list] = None
            if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
                from api.app.services.reporting import ReportingService
                _rs = ReportingService(self.db, self.current_user)
                _ids = list(_rs.get_accessible_resource_ids())
                _cur = self.db.query(User).filter(
                    User.tenant_id == self.current_user.tenant_id,
                    User.object_id == self.current_user.object_id,
                ).first()
                if _cur:
                    for _rid in _rs.get_delegated_resource_ids(_cur.id):
                        if _rid not in _ids:
                            _ids.append(_rid)
                cc_manager_resource_ids = _ids

            demand_lines: list[DemandLineDetail] = []
            actual_lines: list[ActualLineDetail] = []
            external_lines: list[ExternalLineDetail] = []
            equipment_lines: list[EquipmentLineDetail] = []

            # Demand lines — join Resource, filter by Resource.cost_center_id
            demand_q = (
                self.db.query(DemandLine, Resource)
                .join(Resource, DemandLine.resource_id == Resource.id)
                .filter(
                    DemandLine.tenant_id == self.current_user.tenant_id,
                    DemandLine.period_id == period.id,
                    DemandLine.resource_id.isnot(None),
                    Resource.cost_center_id.in_(cc_id_list),
                )
            )
            if cc_pm_project_ids is not None:
                demand_q = demand_q.filter(DemandLine.project_id.in_(cc_pm_project_ids))
            if cc_manager_resource_ids is not None:
                demand_q = demand_q.filter(Resource.id.in_(cc_manager_resource_ids))
            demand_rows = demand_q.all()

            # Actual lines — join Resource, filter by Resource.cost_center_id
            approved_subq_cc = self._approved_actual_ids_subq()
            actual_q = (
                self.db.query(ActualLine, Resource)
                .join(Resource, ActualLine.resource_id == Resource.id)
                .filter(
                    ActualLine.tenant_id == self.current_user.tenant_id,
                    ActualLine.period_id == period.id,
                    ActualLine.id.in_(approved_subq_cc),
                    Resource.cost_center_id.in_(cc_id_list),
                )
            )
            if cc_pm_project_ids is not None:
                actual_q = actual_q.filter(ActualLine.project_id.in_(cc_pm_project_ids))
            if cc_manager_resource_ids is not None:
                actual_q = actual_q.filter(Resource.id.in_(cc_manager_resource_ids))
            actual_rows = actual_q.all()

            # External lines — outerjoin Resource, filter by Resource.cost_center_id
            ext_q = (
                self.db.query(ProjectExternalLine, Resource)
                .outerjoin(Resource, ProjectExternalLine.resource_id == Resource.id)
                .filter(
                    ProjectExternalLine.tenant_id == self.current_user.tenant_id,
                    ProjectExternalLine.period_id == period.id,
                    Resource.cost_center_id.in_(cc_id_list),
                )
            )
            if cc_pm_project_ids is not None:
                ext_q = ext_q.filter(ProjectExternalLine.project_id.in_(cc_pm_project_ids))
            if cc_manager_resource_ids is not None:
                ext_q = ext_q.filter(Resource.id.in_(cc_manager_resource_ids))
            ext_rows = ext_q.all()

            # Equipment lines — no resource FK, cannot filter by cost center; skip in CC mode
            # (matches get_consolidated_costs behaviour)

            # Load project names from all collected project IDs
            cc_all_project_ids = (
                {line.project_id for line, _ in demand_rows}
                | {line.project_id for line, _ in actual_rows}
                | {line.project_id for line, _ in ext_rows}
            )
            project_map = {}
            if cc_all_project_ids:
                project_map = {
                    r.id: r.name
                    for r in self.db.query(Project.id, Project.name)
                    .filter(Project.id.in_(list(cc_all_project_ids)))
                    .all()
                }

            demand_lines = [
                DemandLineDetail(
                    resource_name=resource.display_name,
                    fte_percent=line.fte_percent,
                    cost=int(line.fte_percent * monthly_fte_cost // 100),
                    project_name=project_map.get(line.project_id),
                )
                for line, resource in demand_rows
            ]
            actual_lines = [
                ActualLineDetail(
                    resource_name=resource.display_name,
                    fte_percent=line.actual_fte_percent,
                    cost=int(line.actual_fte_percent * monthly_fte_cost // 100),
                    project_name=project_map.get(line.project_id),
                )
                for line, resource in actual_rows
            ]
            external_lines = [
                ExternalLineDetail(
                    resource_name=resource.display_name if resource else None,
                    description=line.description,
                    notes=line.notes,
                    hours=0,
                    rate=0,
                    total_cost=line.cost,
                    project_name=project_map.get(line.project_id),
                )
                for line, resource in ext_rows
            ]

            return ConsolidatedCostDetail(
                cost_center_id=display_id,
                cost_center_name=display_name,
                year=year,
                month=month,
                monthly_fte_cost=monthly_fte_cost,
                demand_lines=demand_lines,
                actual_lines=actual_lines,
                external_lines=external_lines,
                equipment_lines=equipment_lines,
            )

        # Project mode
        if self.current_user.role == "PM":
            pm_user = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            proj = None
            if pm_user:
                proj = (
                    self.db.query(Project)
                    .filter(
                        Project.tenant_id == self.current_user.tenant_id,
                        Project.id == project_id,
                        sa_exists().where(
                            and_(ProjectPM.project_id == Project.id, ProjectPM.user_id == pm_user.id)
                        ),
                    )
                    .first()
                )
            if proj is None:
                raise HTTPException(status_code=403, detail="Access denied to this project.")
        else:
            proj = (
                self.db.query(Project)
                .filter(
                    Project.tenant_id == self.current_user.tenant_id,
                    Project.id == project_id,
                )
                .first()
            )
            if proj is None:
                raise HTTPException(status_code=404, detail="Project not found.")

        # Manager restriction (non-Reader): scope demand/actual to accessible resources
        proj_manager_resource_ids: Optional[list] = None
        if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
            from api.app.services.reporting import ReportingService
            _rs = ReportingService(self.db, self.current_user)
            _ids = list(_rs.get_accessible_resource_ids())
            _cur = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            if _cur:
                for _rid in _rs.get_delegated_resource_ids(_cur.id):
                    if _rid not in _ids:
                        _ids.append(_rid)
            proj_manager_resource_ids = _ids

        # Demand lines (planned labor) — skip placeholders
        demand_q = (
            self.db.query(DemandLine, Resource, CostCenter)
            .join(Resource, DemandLine.resource_id == Resource.id)
            .outerjoin(CostCenter, Resource.cost_center_id == CostCenter.id)
            .filter(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.project_id == project_id,
                DemandLine.period_id == period.id,
                DemandLine.resource_id.isnot(None),
            )
        )
        if proj_manager_resource_ids is not None:
            demand_q = demand_q.filter(Resource.id.in_(proj_manager_resource_ids))
        demand_rows = demand_q.all()
        demand_lines = [
            DemandLineDetail(
                resource_name=resource.display_name,
                fte_percent=line.fte_percent,
                cost=int(line.fte_percent * monthly_fte_cost // 100),
                cost_center_name=cc.name if cc else None,
            )
            for line, resource, cc in demand_rows
        ]

        # Actual lines — approved only
        approved_subq_proj = self._approved_actual_ids_subq()
        actual_q = (
            self.db.query(ActualLine, Resource, CostCenter)
            .join(Resource, ActualLine.resource_id == Resource.id)
            .outerjoin(CostCenter, Resource.cost_center_id == CostCenter.id)
            .filter(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.project_id == project_id,
                ActualLine.period_id == period.id,
                ActualLine.id.in_(approved_subq_proj),
            )
        )
        if proj_manager_resource_ids is not None:
            actual_q = actual_q.filter(Resource.id.in_(proj_manager_resource_ids))
        actual_rows = actual_q.all()
        actual_lines = [
            ActualLineDetail(
                resource_name=resource.display_name,
                fte_percent=line.actual_fte_percent,
                cost=int(line.actual_fte_percent * monthly_fte_cost // 100),
                cost_center_name=cc.name if cc else None,
            )
            for line, resource, cc in actual_rows
        ]

        # External lines — join Resource for display name, description is the notes field
        ext_rows = (
            self.db.query(ProjectExternalLine, Resource)
            .outerjoin(Resource, ProjectExternalLine.resource_id == Resource.id)
            .filter(
                ProjectExternalLine.tenant_id == self.current_user.tenant_id,
                ProjectExternalLine.project_id == project_id,
                ProjectExternalLine.period_id == period.id,
            )
            .all()
        )
        external_lines = [
            ExternalLineDetail(
                resource_name=resource.display_name if resource else None,
                description=line.description,
                notes=line.notes,
                hours=0,
                        rate=0,
                        total_cost=line.cost,
            )
            for line, resource in ext_rows
        ]

        # Equipment lines
        equip_rows = (
            self.db.query(ProjectEquipmentLine)
            .filter(
                ProjectEquipmentLine.tenant_id == self.current_user.tenant_id,
                ProjectEquipmentLine.project_id == project_id,
                ProjectEquipmentLine.period_id == period.id,
            )
            .all()
        )
        equipment_lines = [
            EquipmentLineDetail(
                description=line.description,
                cost=line.cost,
            )
            for line in equip_rows
        ]

        return ConsolidatedCostDetail(
            project_id=proj.id,
            project_name=proj.name,
            year=year,
            month=month,
            monthly_fte_cost=monthly_fte_cost,
            demand_lines=demand_lines,
            actual_lines=actual_lines,
            external_lines=external_lines,
            equipment_lines=equipment_lines,
        )

    def get_consolidated_cost_detail_multi(
        self,
        year: Optional[int],
        month: Optional[int],
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
        cost_center_code: Optional[str] = None,
    ) -> list:
        """Return detail for a single period (year+month provided) or all open periods."""
        if year is not None and month is not None:
            return [self.get_consolidated_cost_detail(year, month, project_id, cost_center_id, cost_center_code)]
        periods = sorted(
            PeriodService(self.db, self.current_user).list_open(),
            key=lambda p: (p.year, p.month),
        )
        results = []
        for p in periods:
            try:
                results.append(self.get_consolidated_cost_detail(p.year, p.month, project_id, cost_center_id, cost_center_code))
            except Exception:
                pass
        return results

    def get_setting(self, key: str, period_id: Optional[str] = None) -> FinanceSettingResponse:
        """Return a finance setting by key, optionally scoped to a period."""
        if key == "monthly_fte_cost" and period_id:
            period = PeriodService(self.db, self.current_user).get_by_id(period_id)
            if period is None:
                raise HTTPException(status_code=404, detail="Period not found.")

            value = (
                str(period.monthly_fte_cost)
                if period.monthly_fte_cost is not None
                else str(self._get_global_monthly_fte_cost_value())
            )
            return FinanceSettingResponse(
                setting_key=key,
                setting_value=value,
                updated_at=period.updated_at.isoformat() if period.updated_at else None,
            )

        row = (
            self.db.query(FinanceSetting)
            .filter(
                FinanceSetting.tenant_id == self.current_user.tenant_id,
                FinanceSetting.setting_key == key,
            )
            .first()
        )
        if row is None:
            return FinanceSettingResponse(
                setting_key=key,
                setting_value=DEFAULT_MONTHLY_FTE_COST,
            )
        return FinanceSettingResponse(
            setting_key=row.setting_key,
            setting_value=row.setting_value,
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )

    def get_consolidated_costs(
        self,
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
        year: Optional[int] = None,
        month: Optional[int] = None,
        group_by: str = "id",
    ) -> ConsolidatedCostResponse:
        """Aggregate planned labor, actual labor, externals, and equipment costs per project/period."""
        from collections import defaultdict
        from api.app.models.planning import DemandLine
        from api.app.models.actuals import ActualLine
        from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine
        from api.app.models.core import Project

        fallback_monthly_fte_cost = self._get_global_monthly_fte_cost_value()

        # 2. Load periods — specific month when year+month provided (allows locked periods),
        #    otherwise only open periods for the default aggregated view.
        period_svc = PeriodService(self.db, self.current_user)
        if year is not None and month is not None:
            p = period_svc.get_by_year_month(year, month)
            all_periods = [p] if p else []
        else:
            all_periods = period_svc.list_open()
        period_ids = [p.id for p in all_periods]
        period_map = {p.id: (p.year, p.month) for p in all_periods}

        if not period_ids:
            return ConsolidatedCostResponse(data=[], monthly_fte_cost=fallback_monthly_fte_cost)

        monthly_fte_costs_by_period = self._get_monthly_fte_costs_by_period(set(period_ids))

        # 3a. Manager role restriction — scope to accessible resources via reporting hierarchy.
        # Manager+Reader bypasses this and sees all data (same view as Finance).
        scoped_resource_ids: Optional[set] = None
        if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
            from api.app.services.reporting import ReportingService
            rs = ReportingService(self.db, self.current_user)
            ids = list(rs.get_accessible_resource_ids())
            cur_user = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            if cur_user:
                for rid in rs.get_delegated_resource_ids(cur_user.id):
                    if rid not in ids:
                        ids.append(rid)
            if not ids:
                return ConsolidatedCostResponse(data=[], monthly_fte_cost=fallback_monthly_fte_cost)
            scoped_resource_ids = set(ids)

        # 3b. PM role restriction — only their own projects
        pm_project_ids: Optional[set] = None
        if self.current_user.role == "PM":
            pm_user = self.db.query(User).filter(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            ).first()
            if pm_user:
                pm_rows = (
                    self.db.query(ProjectPM.project_id)
                    .filter(ProjectPM.user_id == pm_user.id)
                    .all()
                )
                pm_project_ids = {row.project_id for row in pm_rows}
            else:
                pm_project_ids = set()

        # 4. Build project name lookup and cost center name lookup
        proj_rows = (
            self.db.query(Project.id, Project.name)
            .filter(Project.tenant_id == self.current_user.tenant_id)
            .all()
        )
        project_name_map = {row.id: row.name for row in proj_rows}

        cc_rows = (
            self.db.query(CostCenter.id, CostCenter.name, CostCenter.code)
            .filter(CostCenter.tenant_id == self.current_user.tenant_id)
            .all()
        )
        cc_name_map = {row.id: row.name for row in cc_rows}
        cc_code_map = {row.id: row.code for row in cc_rows}

        # 5. Accumulator: (project_id, cc_key, year, month) → cost buckets
        #    cc_key is cc_id when group_by="id", or cc_code (with fallback to cc_id
        #    for empty-code CCs) when group_by="code".
        agg: dict = defaultdict(lambda: {"demand_cost": 0, "actuals_cost": 0, "externals_cost": 0, "equipment_cost": 0})

        def _pm_allowed(proj_id: str) -> bool:
            if pm_project_ids is not None and proj_id not in pm_project_ids:
                return False
            return True

        def _cc_key(cc_id: Optional[str]) -> Optional[str]:
            """Normalise cost-center identifier for the chosen group_by mode."""
            if cc_id is None:
                return None
            if group_by == "code":
                code = cc_code_map.get(cc_id, "")
                return code if code else cc_id  # fallback to UUID when code is empty
            return cc_id

        # 6. Demand lines → planned labor cost, keyed by Resource.cost_center_id
        demand_q = (
            self.db.query(DemandLine, Resource.cost_center_id)
            .join(Resource, DemandLine.resource_id == Resource.id)
            .filter(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id.in_(period_ids),
                DemandLine.resource_id.isnot(None),
            )
        )
        if project_id:
            demand_q = demand_q.filter(DemandLine.project_id == project_id)
        if cost_center_id:
            demand_q = demand_q.filter(Resource.cost_center_id == cost_center_id)
        if scoped_resource_ids is not None:
            demand_q = demand_q.filter(Resource.id.in_(scoped_resource_ids))
        for line, cc_id in demand_q.all():
            if not _pm_allowed(line.project_id):
                continue
            yr, mo = period_map[line.period_id]
            rate = monthly_fte_costs_by_period.get(line.period_id, fallback_monthly_fte_cost)
            agg[(line.project_id, _cc_key(cc_id), yr, mo)]["demand_cost"] += int(line.fte_percent * rate // 100)

        # 7. Actual lines → actual labor cost (approved only), keyed by Resource.cost_center_id
        approved_subq_cons = self._approved_actual_ids_subq()
        actuals_q = (
            self.db.query(ActualLine, Resource.cost_center_id)
            .join(Resource, ActualLine.resource_id == Resource.id)
            .filter(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.period_id.in_(period_ids),
                ActualLine.id.in_(approved_subq_cons),
            )
        )
        if project_id:
            actuals_q = actuals_q.filter(ActualLine.project_id == project_id)
        if cost_center_id:
            actuals_q = actuals_q.filter(Resource.cost_center_id == cost_center_id)
        if scoped_resource_ids is not None:
            actuals_q = actuals_q.filter(Resource.id.in_(scoped_resource_ids))
        for line, cc_id in actuals_q.all():
            if not _pm_allowed(line.project_id):
                continue
            yr, mo = period_map[line.period_id]
            rate = monthly_fte_costs_by_period.get(line.period_id, fallback_monthly_fte_cost)
            agg[(line.project_id, _cc_key(cc_id), yr, mo)]["actuals_cost"] += int(line.actual_fte_percent * rate // 100)

        # 8. External lines → contractor cost, keyed by Resource.cost_center_id when available
        ext_q = (
            self.db.query(ProjectExternalLine, Resource.cost_center_id)
            .outerjoin(Resource, ProjectExternalLine.resource_id == Resource.id)
            .filter(
                ProjectExternalLine.tenant_id == self.current_user.tenant_id,
                ProjectExternalLine.period_id.in_(period_ids),
            )
        )
        if project_id:
            ext_q = ext_q.filter(ProjectExternalLine.project_id == project_id)
        if cost_center_id:
            ext_q = ext_q.filter(Resource.cost_center_id == cost_center_id)
        if scoped_resource_ids is not None:
            ext_q = ext_q.filter(Resource.id.in_(scoped_resource_ids))
        for line, cc_id in ext_q.all():
            if not _pm_allowed(line.project_id):
                continue
            yr, mo = period_map[line.period_id]
            agg[(line.project_id, _cc_key(cc_id), yr, mo)]["externals_cost"] += line.cost

        # 9. Equipment lines → equipment cost (no resource link, cc_id=None)
        #    Skip when filtering by cost_center_id since there is no resource to filter on.
        if not cost_center_id:
            equip_q = self.db.query(ProjectEquipmentLine).filter(
                ProjectEquipmentLine.tenant_id == self.current_user.tenant_id,
                ProjectEquipmentLine.period_id.in_(period_ids),
            )
            if project_id:
                equip_q = equip_q.filter(ProjectEquipmentLine.project_id == project_id)
            for line in equip_q.all():
                if not _pm_allowed(line.project_id):
                    continue
                yr, mo = period_map[line.period_id]
                agg[(line.project_id, None, yr, mo)]["equipment_cost"] += line.cost

        # 10. Build response
        data = []
        for (proj_id, key_cc, yr, mo), costs in agg.items():
            if group_by == "code":
                data.append(ConsolidatedCostByProject(
                    project_id=proj_id,
                    project_name=project_name_map.get(proj_id, proj_id),
                    cost_center_id=None,
                    cost_center_name=key_cc,   # code string becomes the display label
                    cost_center_code=key_cc,
                    year=yr,
                    month=mo,
                    demand_cost=costs["demand_cost"],
                    actuals_cost=costs["actuals_cost"],
                    externals_cost=costs["externals_cost"],
                    equipment_cost=costs["equipment_cost"],
                ))
            else:
                data.append(ConsolidatedCostByProject(
                    project_id=proj_id,
                    project_name=project_name_map.get(proj_id, proj_id),
                    cost_center_id=key_cc,
                    cost_center_name=cc_name_map.get(key_cc) if key_cc else None,
                    cost_center_code=cc_code_map.get(key_cc) if key_cc else None,
                    year=yr,
                    month=mo,
                    demand_cost=costs["demand_cost"],
                    actuals_cost=costs["actuals_cost"],
                    externals_cost=costs["externals_cost"],
                    equipment_cost=costs["equipment_cost"],
                ))
        monthly_fte_cost_for_response = (
            monthly_fte_costs_by_period.get(period_ids[0], fallback_monthly_fte_cost)
            if period_ids
            else fallback_monthly_fte_cost
        )
        return ConsolidatedCostResponse(data=data, monthly_fte_cost=monthly_fte_cost_for_response)

    def upsert_setting(self, key: str, value: str, period_id: Optional[str] = None) -> FinanceSettingResponse:
        """Create or update a finance setting."""
        if key == "monthly_fte_cost" and period_id:
            period = PeriodService(self.db, self.current_user).get_by_id(period_id)
            if period is None:
                raise HTTPException(status_code=404, detail="Period not found.")
            if period.status == PeriodStatus.LOCKED:
                raise HTTPException(
                    status_code=403,
                    detail={
                        "code": "PERIOD_LOCKED",
                        "message": "Monthly FTE cost is frozen for locked periods.",
                    },
                )

            try:
                parsed = int(value)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="monthly_fte_cost must be a positive integer.")
            if parsed <= 0:
                raise HTTPException(status_code=400, detail="monthly_fte_cost must be a positive integer.")

            period.monthly_fte_cost = parsed
            self.db.commit()
            self.db.refresh(period)
            return FinanceSettingResponse(
                setting_key=key,
                setting_value=str(period.monthly_fte_cost),
                updated_at=period.updated_at.isoformat() if period.updated_at else None,
            )

        row = (
            self.db.query(FinanceSetting)
            .filter(
                FinanceSetting.tenant_id == self.current_user.tenant_id,
                FinanceSetting.setting_key == key,
            )
            .first()
        )
        now = datetime.utcnow()
        if row is None:
            row = FinanceSetting(
                tenant_id=self.current_user.tenant_id,
                setting_key=key,
                setting_value=value,
                updated_by=self.current_user.object_id,
                updated_at=now,
            )
            self.db.add(row)
        else:
            row.setting_value = value
            row.updated_by = self.current_user.object_id
            row.updated_at = now
        self.db.commit()
        self.db.refresh(row)
        return FinanceSettingResponse(
            setting_key=row.setting_key,
            setting_value=row.setting_value,
            updated_at=row.updated_at.isoformat() if row.updated_at else None,
        )



