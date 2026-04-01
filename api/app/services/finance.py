from datetime import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from api.app.auth.dependencies import CurrentUser
from api.app.models.actuals import ActualLine
from sqlalchemy import exists as sa_exists
from api.app.models.core import User, Project, ProjectPM, Resource, CostCenter
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
from api.app.models.finance import FinanceSetting
from api.app.schemas.finance import (
    FinanceActualsDashboardResponse,
    FinanceCostCenterStatsResponse,
    FinanceEmployeeStatsResponse,
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

    def _get_manager_cost_center_id(self) -> Optional[str]:
        """Return the cost_center_id for the current Manager user, or None if not found."""
        manager_user = self.db.query(User).filter(
            User.tenant_id == self.current_user.tenant_id,
            User.object_id == self.current_user.object_id,
        ).first()
        return manager_user.cost_center_id if manager_user else None

    def get_actuals_dashboard(
        self,
        year: Optional[int] = None,
        month: Optional[int] = None,
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
        approval_status: Optional[str] = None,
    ) -> List[FinanceActualsDashboardResponse]:
        # Manager restriction: scope to their own cost center only
        if self.current_user.role == "Manager":
            manager_cc_id = self._get_manager_cost_center_id()
            if manager_cc_id:
                cost_center_id = manager_cc_id
            else:
                return []

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

        # Manager restriction: scope to their own cost center only
        if self.current_user.role == "Manager":
            manager_cc_id = self._get_manager_cost_center_id()
            if manager_cc_id:
                cost_center_id = manager_cc_id
            else:
                return []

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

        # Manager restriction: scope to their own cost center only
        if self.current_user.role == "Manager":
            manager_cc_id = self._get_manager_cost_center_id()
            if manager_cc_id:
                cost_center_id = manager_cc_id
            else:
                return []

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

    def get_consolidated_cost_detail(
        self,
        year: int,
        month: int,
        project_id: Optional[str] = None,
        cost_center_id: Optional[str] = None,
    ) -> ConsolidatedCostDetail:
        """Return per-line detail for one project or cost center + period."""
        from api.app.models.planning import DemandLine
        from api.app.models.actuals import ActualLine
        from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine
        from api.app.models.core import Period, Project, Resource, CostCenter
        from fastapi import HTTPException

        # Resolve period UUID
        period = (
            self.db.query(Period)
            .filter(
                Period.tenant_id == self.current_user.tenant_id,
                Period.year == year,
                Period.month == month,
            )
            .first()
        )
        if period is None:
            raise HTTPException(status_code=404, detail="Period not found.")

        setting = self.get_setting("monthly_fte_cost")
        monthly_fte_cost = int(setting.setting_value)

        if cost_center_id:
            # CC mode — load all projects in this cost center
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

            projects_q = self.db.query(Project).filter(
                Project.tenant_id == self.current_user.tenant_id,
                Project.cost_center_id == cost_center_id,
            )
            if self.current_user.role == "PM":
                pm_user = self.db.query(User).filter(
                    User.tenant_id == self.current_user.tenant_id,
                    User.object_id == self.current_user.object_id,
                ).first()
                if pm_user:
                    projects_q = projects_q.filter(
                        sa_exists().where(
                            and_(ProjectPM.project_id == Project.id, ProjectPM.user_id == pm_user.id)
                        )
                    )
                else:
                    projects_q = projects_q.filter(False)
            projects = projects_q.all()
            project_map = {p.id: p.name for p in projects}
            project_ids = list(project_map.keys())

            demand_lines: list[DemandLineDetail] = []
            actual_lines: list[ActualLineDetail] = []
            external_lines: list[ExternalLineDetail] = []
            equipment_lines: list[EquipmentLineDetail] = []

            if project_ids:
                demand_rows = (
                    self.db.query(DemandLine, Resource)
                    .join(Resource, DemandLine.resource_id == Resource.id)
                    .filter(
                        DemandLine.tenant_id == self.current_user.tenant_id,
                        DemandLine.project_id.in_(project_ids),
                        DemandLine.period_id == period.id,
                        DemandLine.resource_id.isnot(None),
                    )
                    .all()
                )
                demand_lines = [
                    DemandLineDetail(
                        resource_name=resource.display_name,
                        fte_percent=line.fte_percent,
                        cost=int(line.fte_percent * monthly_fte_cost // 100),
                        project_name=project_map.get(line.project_id),
                    )
                    for line, resource in demand_rows
                ]

                actual_rows = (
                    self.db.query(ActualLine, Resource)
                    .join(Resource, ActualLine.resource_id == Resource.id)
                    .filter(
                        ActualLine.tenant_id == self.current_user.tenant_id,
                        ActualLine.project_id.in_(project_ids),
                        ActualLine.period_id == period.id,
                    )
                    .all()
                )
                actual_lines = [
                    ActualLineDetail(
                        resource_name=resource.display_name,
                        fte_percent=line.actual_fte_percent,
                        cost=int(line.actual_fte_percent * monthly_fte_cost // 100),
                        project_name=project_map.get(line.project_id),
                    )
                    for line, resource in actual_rows
                ]

                ext_rows = (
                    self.db.query(ProjectExternalLine, Resource)
                    .outerjoin(Resource, ProjectExternalLine.resource_id == Resource.id)
                    .filter(
                        ProjectExternalLine.tenant_id == self.current_user.tenant_id,
                        ProjectExternalLine.project_id.in_(project_ids),
                        ProjectExternalLine.period_id == period.id,
                    )
                    .all()
                )
                external_lines = [
                    ExternalLineDetail(
                        resource_name=resource.display_name if resource else None,
                        notes=line.description,
                        hours=line.hours,
                        rate=line.rate,
                        total_cost=line.total_cost,
                        project_name=project_map.get(line.project_id),
                    )
                    for line, resource in ext_rows
                ]

                equip_rows = (
                    self.db.query(ProjectEquipmentLine)
                    .filter(
                        ProjectEquipmentLine.tenant_id == self.current_user.tenant_id,
                        ProjectEquipmentLine.project_id.in_(project_ids),
                        ProjectEquipmentLine.period_id == period.id,
                    )
                    .all()
                )
                equipment_lines = [
                    EquipmentLineDetail(
                        description=line.description,
                        cost=line.cost,
                        project_name=project_map.get(line.project_id),
                    )
                    for line in equip_rows
                ]

            return ConsolidatedCostDetail(
                cost_center_id=cc.id,
                cost_center_name=cc.name,
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

        # Demand lines (planned labor) — skip placeholders
        demand_rows = (
            self.db.query(DemandLine, Resource)
            .join(Resource, DemandLine.resource_id == Resource.id)
            .filter(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.project_id == project_id,
                DemandLine.period_id == period.id,
                DemandLine.resource_id.isnot(None),
            )
            .all()
        )
        demand_lines = [
            DemandLineDetail(
                resource_name=resource.display_name,
                fte_percent=line.fte_percent,
                cost=int(line.fte_percent * monthly_fte_cost // 100),
            )
            for line, resource in demand_rows
        ]

        # Actual lines
        actual_rows = (
            self.db.query(ActualLine, Resource)
            .join(Resource, ActualLine.resource_id == Resource.id)
            .filter(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.project_id == project_id,
                ActualLine.period_id == period.id,
            )
            .all()
        )
        actual_lines = [
            ActualLineDetail(
                resource_name=resource.display_name,
                fte_percent=line.actual_fte_percent,
                cost=int(line.actual_fte_percent * monthly_fte_cost // 100),
            )
            for line, resource in actual_rows
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
                notes=line.description,
                hours=line.hours,
                rate=line.rate,
                total_cost=line.total_cost,
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

    def get_setting(self, key: str) -> FinanceSettingResponse:
        """Return a finance setting by key, or a default if not yet configured."""
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
    ) -> ConsolidatedCostResponse:
        """Aggregate planned labor, actual labor, externals, and equipment costs per project/period."""
        from collections import defaultdict
        from api.app.models.planning import DemandLine
        from api.app.models.actuals import ActualLine
        from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine
        from api.app.models.core import Period, Project

        # 1. Resolve monthly FTE cost setting
        setting = self.get_setting("monthly_fte_cost")
        monthly_fte_cost = int(setting.setting_value)

        # 2. Load all periods for this tenant (open and locked)
        all_periods = (
            self.db.query(Period)
            .filter(Period.tenant_id == self.current_user.tenant_id)
            .all()
        )
        period_ids = [p.id for p in all_periods]
        period_map = {p.id: (p.year, p.month) for p in all_periods}

        if not period_ids:
            return ConsolidatedCostResponse(data=[], monthly_fte_cost=monthly_fte_cost)

        # 3. If cost_center_id given, resolve to project IDs
        allowed_project_ids: Optional[set] = None
        if cost_center_id:
            proj_rows = (
                self.db.query(Project.id)
                .filter(
                    Project.tenant_id == self.current_user.tenant_id,
                    Project.cost_center_id == cost_center_id,
                )
                .all()
            )
            allowed_project_ids = {row.id for row in proj_rows}
            if not allowed_project_ids:
                return ConsolidatedCostResponse(data=[], monthly_fte_cost=monthly_fte_cost)

        # 4. PM role restriction — only their own projects
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

        # 5. Build project name lookup
        project_name_map = {
            row.id: row.name
            for row in self.db.query(Project.id, Project.name)
            .filter(Project.tenant_id == self.current_user.tenant_id)
            .all()
        }

        # 6. Accumulator: (project_id, year, month) → cost buckets
        agg: dict = defaultdict(lambda: {"demand_cost": 0, "actuals_cost": 0, "externals_cost": 0, "equipment_cost": 0})

        def _allowed(proj_id: str) -> bool:
            if allowed_project_ids is not None and proj_id not in allowed_project_ids:
                return False
            if pm_project_ids is not None and proj_id not in pm_project_ids:
                return False
            return True

        # 7. Demand lines → planned labor cost
        demand_q = self.db.query(DemandLine).filter(
            DemandLine.tenant_id == self.current_user.tenant_id,
            DemandLine.period_id.in_(period_ids),
            DemandLine.resource_id.isnot(None),
        )
        if project_id:
            demand_q = demand_q.filter(DemandLine.project_id == project_id)
        for line in demand_q.all():
            if not _allowed(line.project_id):
                continue
            year, month = period_map[line.period_id]
            agg[(line.project_id, year, month)]["demand_cost"] += int(line.fte_percent * monthly_fte_cost // 100)

        # 8. Actual lines → actual labor cost
        actuals_q = self.db.query(ActualLine).filter(
            ActualLine.tenant_id == self.current_user.tenant_id,
            ActualLine.period_id.in_(period_ids),
        )
        if project_id:
            actuals_q = actuals_q.filter(ActualLine.project_id == project_id)
        for line in actuals_q.all():
            if not _allowed(line.project_id):
                continue
            year, month = period_map[line.period_id]
            agg[(line.project_id, year, month)]["actuals_cost"] += int(line.actual_fte_percent * monthly_fte_cost // 100)

        # 9. External lines → contractor cost
        ext_q = self.db.query(ProjectExternalLine).filter(
            ProjectExternalLine.tenant_id == self.current_user.tenant_id,
            ProjectExternalLine.period_id.in_(period_ids),
        )
        if project_id:
            ext_q = ext_q.filter(ProjectExternalLine.project_id == project_id)
        for line in ext_q.all():
            if not _allowed(line.project_id):
                continue
            year, month = period_map[line.period_id]
            agg[(line.project_id, year, month)]["externals_cost"] += line.total_cost

        # 10. Equipment lines → equipment cost
        equip_q = self.db.query(ProjectEquipmentLine).filter(
            ProjectEquipmentLine.tenant_id == self.current_user.tenant_id,
            ProjectEquipmentLine.period_id.in_(period_ids),
        )
        if project_id:
            equip_q = equip_q.filter(ProjectEquipmentLine.project_id == project_id)
        for line in equip_q.all():
            if not _allowed(line.project_id):
                continue
            year, month = period_map[line.period_id]
            agg[(line.project_id, year, month)]["equipment_cost"] += line.cost

        # 11. Build response
        data = [
            ConsolidatedCostByProject(
                project_id=proj_id,
                project_name=project_name_map.get(proj_id, proj_id),
                year=year,
                month=month,
                demand_cost=costs["demand_cost"],
                actuals_cost=costs["actuals_cost"],
                externals_cost=costs["externals_cost"],
                equipment_cost=costs["equipment_cost"],
            )
            for (proj_id, year, month), costs in agg.items()
        ]
        return ConsolidatedCostResponse(data=data, monthly_fte_cost=monthly_fte_cost)

    def upsert_setting(self, key: str, value: str) -> FinanceSettingResponse:
        """Create or update a finance setting."""
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
