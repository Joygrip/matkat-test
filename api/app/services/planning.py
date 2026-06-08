"""Planning services - Demand and Supply line management."""
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_

from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.core import Period, Project, ProjectPM, Resource, Placeholder, User, PeriodStatus, UserRole
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.services.period import PeriodService
from api.app.schemas.common import ErrorCode

_SCOPED_ROLES = (UserRole.MANAGER,)


def get_4mfc_boundary() -> tuple[int, int]:
    """
    Get the boundary date for 4MFC (4 Month Forward Commitment).
    Returns (year, month) of the first month where placeholders are allowed.
    """
    now = datetime.now(timezone.utc)
    boundary = now + relativedelta(months=4)
    return boundary.year, boundary.month


def is_within_4mfc(year: int, month: int) -> bool:
    """Check if a given year/month is within the 4MFC window."""
    boundary_year, boundary_month = get_4mfc_boundary()

    # Convert to comparable values (year * 12 + month)
    target = year * 12 + month
    boundary = boundary_year * 12 + boundary_month

    return target < boundary


def _build_demand_line_ctx(demand: "DemandLine", project=None, resource=None, placeholder=None) -> dict:
    """Build enriched audit context for a DemandLine action (write-time denormalization)."""
    ctx: dict = {
        "demand_line_id": demand.id,
        "year": demand.year,
        "month": demand.month,
        "fte_percent": demand.fte_percent,
    }
    prj = project or demand.project
    if prj:
        ctx["project_name"] = prj.name
        ctx["project_id"] = prj.id
    res = resource or demand.resource
    if res:
        ctx["resource_name"] = res.display_name
        ctx["resource_email"] = res.email
        ctx["resource_id"] = res.id
        if res.cost_center:
            ctx["cost_center_name"] = res.cost_center.name
            ctx["cost_center_id"] = res.cost_center_id
    ph = placeholder or demand.placeholder
    if ph:
        ctx["placeholder_name"] = ph.name
        ctx["placeholder_id"] = ph.id
    return ctx


class DemandService:
    """Service for demand line operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user
    
    def _check_period_open(self, year: int, month: int) -> Period:
        """Check if the period exists and is open."""
        period = PeriodService(self.db, self.current_user).get_by_year_month(year, month)
        
        if not period:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "NOT_FOUND",
                    "message": f"Period {year}-{month:02d} does not exist. Finance must create it first.",
                }
            )
        
        if period.status == PeriodStatus.LOCKED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": ErrorCode.PERIOD_LOCKED,
                    "message": f"Period {year}-{month:02d} is locked. No edits allowed.",
                }
            )
        
        return period
    
    def _check_pm_authorized(self, project: Project) -> None:
        """Raise 403 if the current user is a PM but not an assigned PM for this project.

        Only enforced when the project has assigned PMs.
        If no PMs are assigned, any PM-role user may manage demand.
        """
        if self.current_user.role != UserRole.PM:
            return
        if not project.pm_users:
            return  # No PMs assigned — any PM can manage demand

        assigned_oids = {u.object_id for u in project.pm_users}
        if self.current_user.object_id not in assigned_oids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "PM_NOT_AUTHORIZED",
                    "message": "Only an assigned project manager can manage demand for this project",
                },
            )

    def _get_scoped_resource_ids(self, for_write: bool = False) -> Optional[list[str]]:
        """Return the list of resource IDs the current user may access, or None for full access.
        Includes resources accessible via active delegation grants.
        Manager+Reader bypasses CC scoping for reads; for_write=True preserves write guards.
        """
        if self.current_user.role not in _SCOPED_ROLES:
            return None
        if not for_write and self.current_user.is_manager_reader:
            return None
        from api.app.services.reporting import ReportingService
        svc = ReportingService(self.db, self.current_user)
        ids = list(svc.get_accessible_resource_ids())
        user = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()
        if user:
            for rid in svc.get_delegated_resource_ids(user.id):
                if rid not in ids:
                    ids.append(rid)
        return ids

    def get_all(self, year: Optional[int] = None, month: Optional[int] = None, project_id: Optional[str] = None, resource_id: Optional[str] = None, *, period_id: Optional[str] = None, open_periods_only: bool = False, cost_center_id: Optional[str] = None) -> list[DemandLine]:
        """Get all demand lines, optionally filtered by period/year/month/project/resource/cost_center."""
        query = self.db.query(DemandLine).filter(
            DemandLine.tenant_id == self.current_user.tenant_id
        ).options(
            joinedload(DemandLine.resource).joinedload(Resource.cost_center),
            joinedload(DemandLine.placeholder).joinedload(Placeholder.cost_center),
            joinedload(DemandLine.project),
        )
        if open_periods_only:
            query = query.join(Period, DemandLine.period_id == Period.id).filter(
                Period.status == PeriodStatus.OPEN
            )
        if period_id:
            query = query.filter(DemandLine.period_id == period_id)
        if year:
            query = query.filter(DemandLine.year == year)
        if month:
            query = query.filter(DemandLine.month == month)
        if project_id:
            query = query.filter(DemandLine.project_id == project_id)
        if resource_id:
            query = query.filter(DemandLine.resource_id == resource_id)
        if cost_center_id:
            query = query.filter(or_(
                DemandLine.resource_id.in_(
                    self.db.query(Resource.id).filter(Resource.cost_center_id == cost_center_id)
                ),
                DemandLine.placeholder_id.in_(
                    self.db.query(Placeholder.id).filter(Placeholder.cost_center_id == cost_center_id)
                ),
            ))

        # RO/Director: restrict to resources within their reporting line
        scoped_ids = self._get_scoped_resource_ids()
        if scoped_ids is not None:
            query = query.filter(DemandLine.resource_id.in_(scoped_ids))

        # PM: restrict to projects they are assigned to
        if self.current_user.role == UserRole.PM:
            pm_user = self.db.query(User).filter(
                and_(
                    User.tenant_id == self.current_user.tenant_id,
                    User.object_id == self.current_user.object_id,
                )
            ).first()
            if pm_user:
                pm_project_ids = [
                    r.project_id
                    for r in self.db.query(ProjectPM.project_id)
                    .filter(ProjectPM.user_id == pm_user.id)
                    .all()
                ]
                query = query.filter(DemandLine.project_id.in_(pm_project_ids))
            else:
                query = query.filter(False)

        return query.all()

    def get_by_id(self, demand_id: str) -> Optional[DemandLine]:
        """Get a demand line by ID."""
        demand = self.db.query(DemandLine).filter(
            and_(
                DemandLine.id == demand_id,
                DemandLine.tenant_id == self.current_user.tenant_id,
            )
        ).options(
            joinedload(DemandLine.resource).joinedload(Resource.cost_center),
            joinedload(DemandLine.placeholder).joinedload(Placeholder.cost_center),
            joinedload(DemandLine.project),
        ).first()

        if demand and demand.resource_id:
            scoped_ids = self._get_scoped_resource_ids()
            if scoped_ids is not None and demand.resource_id not in scoped_ids:
                return None  # Treat as not found to avoid leaking existence

        return demand
    
    def create(
        self,
        project_id: str,
        year: int,
        month: int,
        fte_percent: int,
        resource_id: Optional[str] = None,
        placeholder_id: Optional[str] = None,
    ) -> DemandLine:
        """Create a new demand line."""
        # Validate period is open
        period = self._check_period_open(year, month)
        
        # Validate XOR constraint
        if resource_id and placeholder_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.DEMAND_XOR,
                    "message": "Cannot specify both resource_id and placeholder_id",
                }
            )
        
        if not resource_id and not placeholder_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.DEMAND_XOR,
                    "message": "Must specify either resource_id or placeholder_id",
                }
            )
        
        # Validate 4MFC rule for placeholders
        if placeholder_id and is_within_4mfc(year, month):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.PLACEHOLDER_BLOCKED_4MFC,
                    "message": f"Placeholders are not allowed within the 4-month forward commitment window. "
                               f"Use named resources for {year}-{month:02d}.",
                }
            )
        
        # Validate FTE
        if fte_percent < 5 or fte_percent > 100 or fte_percent % 5 != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be between 5 and 100 in steps of 5",
                }
            )
        
        # Validate project exists
        project = self.db.query(Project).filter(
            and_(
                Project.id == project_id,
                Project.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Project not found"}
            )

        # PM can only manage demand for projects they are assigned to
        self._check_pm_authorized(project)

        # Validate resource/placeholder exists
        resource = None
        placeholder = None
        if resource_id:
            resource = self.db.query(Resource).filter(
                and_(
                    Resource.id == resource_id,
                    Resource.tenant_id == self.current_user.tenant_id,
                )
            ).first()
            if not resource:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "Resource not found"}
                )
            if not resource.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "RESOURCE_INACTIVE",
                        "message": "Cannot assign demand to an inactive resource. This person has left the organisation.",
                    },
                )

        if placeholder_id:
            placeholder = self.db.query(Placeholder).filter(
                and_(
                    Placeholder.id == placeholder_id,
                    Placeholder.tenant_id == self.current_user.tenant_id,
                )
            ).first()
            if not placeholder:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "Placeholder not found"}
                )
        
        # Check for duplicate
        existing_query = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.project_id == project_id,
                DemandLine.year == year,
                DemandLine.month == month,
            )
        )
        
        if resource_id:
            existing = existing_query.filter(DemandLine.resource_id == resource_id).first()
        else:
            existing = existing_query.filter(DemandLine.placeholder_id == placeholder_id).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONFLICT",
                    "message": "A demand line already exists for this project/resource/month combination",
                }
            )
        
        # Create demand line
        demand = DemandLine(
            tenant_id=self.current_user.tenant_id,
            period_id=period.id,
            project_id=project_id,
            resource_id=resource_id,
            placeholder_id=placeholder_id,
            year=year,
            month=month,
            fte_percent=fte_percent,
            created_by=self.current_user.object_id,
        )
        self.db.add(demand)
        self.db.commit()
        self.db.refresh(demand)
        
        log_audit(
            self.db, self.current_user,
            action="create",
            entity_type="DemandLine",
            entity_id=demand.id,
            new_values={
                "project_id": project_id,
                "resource_id": resource_id,
                "placeholder_id": placeholder_id,
                "year": year,
                "month": month,
                "fte_percent": fte_percent,
            },
            details=_build_demand_line_ctx(demand, project=project, resource=resource, placeholder=placeholder),
        )

        return demand
    
    def update(self, demand_id: str, fte_percent: int, resource_id: str | None = None, placeholder_id: str | None = None) -> DemandLine:
        """Update a demand line's FTE and optionally swap resource/placeholder."""
        demand = self.get_by_id(demand_id)
        if not demand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Demand line not found"}
            )

        # PM can only manage demand for their assigned project
        self._check_pm_authorized(demand.project)

        # Check period is open
        self._check_period_open(demand.year, demand.month)

        # Validate FTE
        if fte_percent < 5 or fte_percent > 100 or fte_percent % 5 != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be between 5 and 100 in steps of 5",
                }
            )

        # Determine effective resource/placeholder (use existing values if not provided)
        new_resource_id = resource_id if (resource_id is not None or placeholder_id is not None) else demand.resource_id
        new_placeholder_id = placeholder_id if (resource_id is not None or placeholder_id is not None) else demand.placeholder_id

        changing_assignment = (resource_id is not None or placeholder_id is not None)
        if changing_assignment:
            # XOR validation
            if new_resource_id and new_placeholder_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": ErrorCode.DEMAND_XOR, "message": "Cannot specify both resource_id and placeholder_id"},
                )
            if not new_resource_id and not new_placeholder_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": ErrorCode.DEMAND_XOR, "message": "Must specify either resource_id or placeholder_id"},
                )

            # 4MFC check for placeholders
            if new_placeholder_id and is_within_4mfc(demand.year, demand.month):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": ErrorCode.PLACEHOLDER_BLOCKED_4MFC,
                        "message": f"Placeholders are not allowed within the 4-month forward commitment window. "
                                   f"Use named resources for {demand.year}-{demand.month:02d}.",
                    },
                )

            # Validate resource/placeholder exists
            if new_resource_id:
                resource = self.db.query(Resource).filter(
                    and_(Resource.id == new_resource_id, Resource.tenant_id == self.current_user.tenant_id)
                ).first()
                if not resource:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": "Resource not found"})
                if not resource.is_active:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "code": "RESOURCE_INACTIVE",
                            "message": "Cannot assign demand to an inactive resource. This person has left the organisation.",
                        },
                    )
            if new_placeholder_id:
                placeholder = self.db.query(Placeholder).filter(
                    and_(Placeholder.id == new_placeholder_id, Placeholder.tenant_id == self.current_user.tenant_id)
                ).first()
                if not placeholder:
                    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": "Placeholder not found"})

            # Duplicate check (exclude current demand line)
            dup_query = self.db.query(DemandLine).filter(
                and_(
                    DemandLine.tenant_id == self.current_user.tenant_id,
                    DemandLine.project_id == demand.project_id,
                    DemandLine.year == demand.year,
                    DemandLine.month == demand.month,
                    DemandLine.id != demand_id,
                )
            )
            existing = dup_query.filter(DemandLine.resource_id == new_resource_id).first() if new_resource_id else dup_query.filter(DemandLine.placeholder_id == new_placeholder_id).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "CONFLICT", "message": "A demand line already exists for this project/resource/month combination"},
                )

        old_values = {"fte_percent": demand.fte_percent, "resource_id": demand.resource_id, "placeholder_id": demand.placeholder_id}
        demand.fte_percent = fte_percent
        if changing_assignment:
            demand.resource_id = new_resource_id
            demand.placeholder_id = new_placeholder_id
        self.db.commit()
        self.db.refresh(demand)

        log_audit(
            self.db, self.current_user,
            action="update",
            entity_type="DemandLine",
            entity_id=demand.id,
            old_values=old_values,
            new_values={"fte_percent": fte_percent, "resource_id": demand.resource_id, "placeholder_id": demand.placeholder_id},
            details=_build_demand_line_ctx(demand),
        )

        return demand
    
    def delete(self, demand_id: str) -> None:
        """Delete a demand line."""
        demand = self.get_by_id(demand_id)
        if not demand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Demand line not found"}
            )

        # PM can only manage demand for their assigned project
        self._check_pm_authorized(demand.project)

        # Check period is open
        self._check_period_open(demand.year, demand.month)

        self.db.delete(demand)
        self.db.commit()

        log_audit(
            self.db, self.current_user,
            action="delete",
            entity_type="DemandLine",
            entity_id=demand_id,
        )

    def delete_group(
        self,
        project_id: str,
        period_ids: list[str],
        resource_id: Optional[str] = None,
        placeholder_id: Optional[str] = None,
    ) -> int:
        """Delete all demand lines for a resource/placeholder + project across the given periods.

        Validates all periods are open before deleting any row (all-or-nothing).
        Returns the count of deleted rows.
        """
        # Validate project exists within tenant
        project = self.db.query(Project).filter(
            and_(
                Project.id == project_id,
                Project.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Project not found"},
            )

        # PM can only manage demand for their assigned project
        self._check_pm_authorized(project)

        # Validate all period_ids belong to current tenant
        periods = self.db.query(Period).filter(
            and_(
                Period.id.in_(period_ids),
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).all()

        period_map = {p.id: p for p in periods}
        for pid in period_ids:
            if pid not in period_map:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": f"Period {pid} not found"},
                )

        # Check ALL periods are open before touching any row (all-or-nothing)
        for period in periods:
            if period.status == PeriodStatus.LOCKED:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": ErrorCode.PERIOD_LOCKED,
                        "message": f"Period {period.year}-{period.month:02d} is locked. No edits allowed.",
                    },
                )

        # Fetch matching demand lines
        query = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.project_id == project_id,
                DemandLine.period_id.in_(period_ids),
            )
        )
        if resource_id:
            query = query.filter(DemandLine.resource_id == resource_id)
        else:
            query = query.filter(DemandLine.placeholder_id == placeholder_id)

        lines = query.all()

        for line in lines:
            log_audit(
                self.db, self.current_user,
                action="delete",
                entity_type="DemandLine",
                entity_id=line.id,
            )
            self.db.delete(line)

        self.db.commit()
        return len(lines)

    def move_group(
        self,
        project_id: str,
        to_project_id: str,
        period_ids: list[str],
        from_resource_id: Optional[str] = None,
        from_placeholder_id: Optional[str] = None,
        to_resource_id: Optional[str] = None,
        to_placeholder_id: Optional[str] = None,
        confirm_cap: bool = False,
    ) -> int:
        """Move all demand lines for a source resource/placeholder + project to a target.

        Validates all periods are open and checks for conflicts on the target before
        updating any row (all-or-nothing). Returns the count of moved rows.
        """
        _MONTH_NAMES = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ]

        # Validate project exists within tenant
        project = self.db.query(Project).filter(
            and_(
                Project.id == project_id,
                Project.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Project not found"},
            )

        # PM authorization for source project
        self._check_pm_authorized(project)

        # Validate target project exists and PM is authorized for it
        target_project = self.db.query(Project).filter(
            and_(
                Project.id == to_project_id,
                Project.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not target_project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Target project not found"},
            )
        self._check_pm_authorized(target_project)

        # Validate all period_ids belong to current tenant
        periods = self.db.query(Period).filter(
            and_(
                Period.id.in_(period_ids),
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).all()
        period_map = {p.id: p for p in periods}
        for pid in period_ids:
            if pid not in period_map:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": f"Period {pid} not found"},
                )

        # Check all periods are open (all-or-nothing)
        for period in periods:
            if period.status == PeriodStatus.LOCKED:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": ErrorCode.PERIOD_LOCKED,
                        "message": f"Period {period.year}-{period.month:02d} is locked. No edits allowed.",
                    },
                )

        # 4MFC check when moving to a placeholder
        if to_placeholder_id:
            for period in periods:
                if is_within_4mfc(period.year, period.month):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail={
                            "code": ErrorCode.PLACEHOLDER_BLOCKED_4MFC,
                            "message": (
                                f"Placeholders are not allowed within the 4-month forward commitment window. "
                                f"Use named resources for {period.year}-{period.month:02d}."
                            ),
                        },
                    )

        # Validate target resource/placeholder exists and is active
        target_name: str
        if to_resource_id:
            target_resource = self.db.query(Resource).filter(
                and_(
                    Resource.id == to_resource_id,
                    Resource.tenant_id == self.current_user.tenant_id,
                )
            ).first()
            if not target_resource:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "Target resource not found"},
                )
            if not target_resource.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "RESOURCE_INACTIVE",
                        "message": "Cannot move demand to an inactive resource. This person has left the organisation.",
                    },
                )
            target_name = target_resource.display_name
        else:
            target_placeholder = self.db.query(Placeholder).filter(
                and_(
                    Placeholder.id == to_placeholder_id,
                    Placeholder.tenant_id == self.current_user.tenant_id,
                )
            ).first()
            if not target_placeholder:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "Target placeholder not found"},
                )
            if not target_placeholder.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "RESOURCE_INACTIVE",
                        "message": "Cannot move demand to an inactive placeholder.",
                    },
                )
            target_name = target_placeholder.name

        # Build year/month lookup structures for the requested periods
        year_month_pairs = [(p.year, p.month) for p in periods]
        period_ym_map = {(p.year, p.month): p for p in periods}

        # Fetch source demand lines
        source_query = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.project_id == project_id,
                DemandLine.period_id.in_(period_ids),
            )
        )
        if from_resource_id:
            source_query = source_query.filter(DemandLine.resource_id == from_resource_id)
        else:
            source_query = source_query.filter(DemandLine.placeholder_id == from_placeholder_id)
        source_lines = source_query.all()
        source_map = {(l.year, l.month): l for l in source_lines}

        # Fetch matching target demand lines for the same year/month pairs
        ym_filter = or_(*[
            and_(DemandLine.year == y, DemandLine.month == m)
            for y, m in year_month_pairs
        ])
        target_query = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.project_id == to_project_id,
                ym_filter,
            )
        )
        if to_resource_id:
            target_query = target_query.filter(DemandLine.resource_id == to_resource_id)
        else:
            target_query = target_query.filter(DemandLine.placeholder_id == to_placeholder_id)
        target_lines = target_query.all()
        target_map = {(l.year, l.month): l for l in target_lines}

        # Determine periods that would exceed 100% after merge
        cap_details = []
        for y, m in year_month_pairs:
            source_line = source_map.get((y, m))
            if not source_line:
                continue
            target_line = target_map.get((y, m))
            target_fte = target_line.fte_percent if target_line else 0
            raw_sum = source_line.fte_percent + target_fte
            if raw_sum > 100:
                period = period_ym_map[(y, m)]
                cap_details.append({
                    "period_id": period.id,
                    "label": f"{_MONTH_NAMES[m - 1]} {y}",
                    "existing_fte": target_fte,
                    "moved_fte": source_line.fte_percent,
                    "raw_total": raw_sum,
                    "capped_total": 100,
                })

        if cap_details and not confirm_cap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "MOVE_REQUIRES_CAP_CONFIRMATION",
                    "message": "Some target periods would exceed 100% demand after this move.",
                    "periods": cap_details,
                }
            )

        # Perform additive merge/move (all-or-nothing within this transaction)
        moved_count = 0
        for y, m in year_month_pairs:
            source_line = source_map.get((y, m))
            if not source_line:
                continue
            target_line = target_map.get((y, m))
            source_fte = source_line.fte_percent
            target_fte = target_line.fte_percent if target_line else 0
            capped_value = min(source_fte + target_fte, 100)

            if target_line:
                # Merge: update target FTE and delete source line
                log_audit(
                    self.db, self.current_user,
                    action="update",
                    entity_type="DemandLine",
                    entity_id=target_line.id,
                    old_values={
                        "resource_id": target_line.resource_id,
                        "placeholder_id": target_line.placeholder_id,
                        "project_id": target_line.project_id,
                        "fte_percent": target_line.fte_percent,
                    },
                    new_values={
                        "fte_percent": capped_value,
                        "merged_from": source_line.id,
                        "moved_fte": source_fte,
                        "capped": capped_value < source_fte + target_fte,
                    },
                )
                target_line.fte_percent = capped_value
                log_audit(
                    self.db, self.current_user,
                    action="delete",
                    entity_type="DemandLine",
                    entity_id=source_line.id,
                    old_values={
                        "resource_id": source_line.resource_id,
                        "placeholder_id": source_line.placeholder_id,
                        "project_id": source_line.project_id,
                        "fte_percent": source_fte,
                        "reason": "merged into target demand line",
                    },
                )
                self.db.delete(source_line)
            else:
                # Simple move: reassign source line to target resource/placeholder/project
                old_values = {
                    "resource_id": source_line.resource_id,
                    "placeholder_id": source_line.placeholder_id,
                    "project_id": source_line.project_id,
                }
                source_line.resource_id = to_resource_id
                source_line.placeholder_id = to_placeholder_id
                source_line.project_id = to_project_id
                log_audit(
                    self.db, self.current_user,
                    action="update",
                    entity_type="DemandLine",
                    entity_id=source_line.id,
                    old_values=old_values,
                    new_values={
                        "resource_id": to_resource_id,
                        "placeholder_id": to_placeholder_id,
                        "project_id": to_project_id,
                    },
                )
            moved_count += 1

        self.db.commit()
        return moved_count


class SupplyService:
    """Service for supply line operations."""

    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user

    def _get_scoped_resource_ids(self, for_write: bool = False) -> Optional[list[str]]:
        """Return cost-center-scoped resource IDs for Manager, or None for full access.
        Includes resources accessible via active delegation grants.
        Manager+Reader bypasses CC scoping for reads; for_write=True preserves write guards.
        """
        if self.current_user.role not in _SCOPED_ROLES:
            return None
        if not for_write and self.current_user.is_manager_reader:
            return None
        from api.app.services.reporting import ReportingService
        svc = ReportingService(self.db, self.current_user)
        ids = list(svc.get_cost_center_resource_ids())
        user = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()
        if user:
            for rid in svc.get_delegated_resource_ids(user.id):
                if rid not in ids:
                    ids.append(rid)
        return ids

    def _check_ro_resource_authorized(self, resource_id: str) -> None:
        """Raise 403 if the current user is a Manager but the resource is outside their cost center."""
        if self.current_user.role != UserRole.MANAGER:
            return
        scoped_ids = self._get_scoped_resource_ids(for_write=True)
        if scoped_ids is not None and resource_id not in scoped_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "MANAGER_NOT_AUTHORIZED",
                    "message": "You may only manage supply lines for resources in your reporting line",
                },
            )

    def _check_period_open(self, year: int, month: int) -> Period:
        """Check if the period exists and is open."""
        period = PeriodService(self.db, self.current_user).get_by_year_month(year, month)
        
        if not period:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "NOT_FOUND",
                    "message": f"Period {year}-{month:02d} does not exist. Finance must create it first.",
                }
            )
        
        if period.status == PeriodStatus.LOCKED:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": ErrorCode.PERIOD_LOCKED,
                    "message": f"Period {year}-{month:02d} is locked. No edits allowed.",
                }
            )
        
        return period
    
    def get_all(self, year: Optional[int] = None, month: Optional[int] = None, project_id: Optional[str] = None, resource_id: Optional[str] = None, *, period_id: Optional[str] = None, open_periods_only: bool = False, cost_center_id: Optional[str] = None) -> list[SupplyLine]:
        """Get all supply lines, optionally filtered by period/year/month/resource/cost_center."""
        query = self.db.query(SupplyLine).filter(
            SupplyLine.tenant_id == self.current_user.tenant_id
        ).options(
            joinedload(SupplyLine.resource).joinedload(Resource.cost_center),
            joinedload(SupplyLine.project),
        )
        if open_periods_only:
            query = query.join(Period, SupplyLine.period_id == Period.id).filter(
                Period.status == PeriodStatus.OPEN
            )
        if period_id:
            query = query.filter(SupplyLine.period_id == period_id)
        if year:
            query = query.filter(SupplyLine.year == year)
        if month:
            query = query.filter(SupplyLine.month == month)
        if resource_id:
            query = query.filter(SupplyLine.resource_id == resource_id)
        if cost_center_id:
            query = query.filter(
                SupplyLine.resource_id.in_(
                    self.db.query(Resource.id).filter(Resource.cost_center_id == cost_center_id)
                )
            )

        # RO/Director: restrict to resources within their reporting line
        scoped_ids = self._get_scoped_resource_ids()
        if scoped_ids is not None:
            query = query.filter(SupplyLine.resource_id.in_(scoped_ids))

        return query.all()

    def get_by_id(self, supply_id: str) -> Optional[SupplyLine]:
        """Get a supply line by ID."""
        supply = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.id == supply_id,
                SupplyLine.tenant_id == self.current_user.tenant_id,
            )
        ).options(
            joinedload(SupplyLine.resource).joinedload(Resource.cost_center),
            joinedload(SupplyLine.project),
        ).first()

        if supply:
            scoped_ids = self._get_scoped_resource_ids()
            if scoped_ids is not None and supply.resource_id not in scoped_ids:
                return None

        return supply

    def _check_supply_100_percent_limit(
        self,
        resource_id: str,
        year: int,
        month: int,
        new_fte: int,
        exclude_supply_id: Optional[str] = None,
    ) -> None:
        """Check that total supply for a resource/month does not exceed 100%."""
        query = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.resource_id == resource_id,
                SupplyLine.year == year,
                SupplyLine.month == month,
            )
        )
        if exclude_supply_id:
            query = query.filter(SupplyLine.id != exclude_supply_id)

        existing_total = sum(line.fte_percent for line in query.all())
        new_total = existing_total + new_fte

        if new_total > 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.SUPPLY_OVER_100,
                    "message": f"Total supply would be {new_total}%, which exceeds the 100% limit.",
                    "total_percent": new_total,
                    "resource_id": resource_id,
                    "year": year,
                    "month": month,
                }
            )

    def create(
        self,
        resource_id: str,
        year: int,
        month: int,
        fte_percent: int,
        project_id: Optional[str] = None,
    ) -> SupplyLine:
        """Create a new supply line."""
        # Validate period is open
        period = self._check_period_open(year, month)
        
        # Validate FTE
        if fte_percent < 5 or fte_percent > 100 or fte_percent % 5 != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be between 5 and 100 in steps of 5",
                }
            )
        
        # Validate resource exists
        resource = self.db.query(Resource).filter(
            and_(
                Resource.id == resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Resource not found"}
            )
        if not resource.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "RESOURCE_INACTIVE",
                    "message": "Cannot assign supply to an inactive resource. This person has left the organisation.",
                },
            )

        # Enforce RO scope: RO can only create supply for their own resources
        self._check_ro_resource_authorized(resource_id)

        # Validate project exists (if provided)
        if project_id:
            project = self.db.query(Project).filter(
                and_(
                    Project.id == project_id,
                    Project.tenant_id == self.current_user.tenant_id,
                )
            ).first()
            if not project:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "Project not found"}
                )
        
        # Check for duplicate (resource + project + month)
        dup_filters = [
            SupplyLine.tenant_id == self.current_user.tenant_id,
            SupplyLine.resource_id == resource_id,
            SupplyLine.year == year,
            SupplyLine.month == month,
        ]
        if project_id:
            dup_filters.append(SupplyLine.project_id == project_id)
        else:
            dup_filters.append(SupplyLine.project_id.is_(None))
        
        existing = self.db.query(SupplyLine).filter(and_(*dup_filters)).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONFLICT",
                    "message": "A supply line already exists for this resource/project/month combination",
                }
            )

        # Check total supply does not exceed 100%
        self._check_supply_100_percent_limit(resource_id, year, month, fte_percent)

        # Create supply line
        supply = SupplyLine(
            tenant_id=self.current_user.tenant_id,
            period_id=period.id,
            resource_id=resource_id,
            project_id=project_id or None,
            year=year,
            month=month,
            fte_percent=fte_percent,
            created_by=self.current_user.object_id,
        )
        self.db.add(supply)
        self.db.commit()
        self.db.refresh(supply)
        
        log_audit(
            self.db, self.current_user,
            action="create",
            entity_type="SupplyLine",
            entity_id=supply.id,
            new_values={
                "resource_id": resource_id,
                "project_id": project_id,
                "year": year,
                "month": month,
                "fte_percent": fte_percent,
            }
        )
        
        return supply
    
    def update(self, supply_id: str, fte_percent: int, resource_id: str | None = None, project_id: str | None = None) -> SupplyLine:
        """Update a supply line's FTE and optionally change resource/project."""
        supply = self.get_by_id(supply_id)
        if not supply:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Supply line not found"}
            )

        # Enforce manager scope on existing resource before any mutation (covers FTE-only updates)
        self._check_ro_resource_authorized(supply.resource_id)

        # Check period is open
        self._check_period_open(supply.year, supply.month)

        # Validate FTE
        if fte_percent < 5 or fte_percent > 100 or fte_percent % 5 != 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be between 5 and 100 in steps of 5",
                }
            )

        new_resource_id = resource_id if resource_id is not None else supply.resource_id
        # project_id=None is a valid "clear project" value, so detect explicit send via sentinel
        changing_resource = resource_id is not None
        new_project_id = project_id if resource_id is not None else supply.project_id

        if changing_resource:
            # Validate new resource exists
            resource = self.db.query(Resource).filter(
                and_(Resource.id == new_resource_id, Resource.tenant_id == self.current_user.tenant_id)
            ).first()
            if not resource:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND", "message": "Resource not found"})
            if not resource.is_active:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "RESOURCE_INACTIVE",
                        "message": "Cannot assign supply to an inactive resource. This person has left the organisation.",
                    },
                )

            # Enforce manager scope on new resource
            self._check_ro_resource_authorized(new_resource_id)

            # Duplicate check (exclude current line)
            dup_filters = [
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.resource_id == new_resource_id,
                SupplyLine.year == supply.year,
                SupplyLine.month == supply.month,
                SupplyLine.id != supply_id,
            ]
            dup_filters.append(SupplyLine.project_id == new_project_id if new_project_id else SupplyLine.project_id.is_(None))
            if self.db.query(SupplyLine).filter(and_(*dup_filters)).first():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "CONFLICT", "message": "A supply line already exists for this resource/project/month combination"},
                )

        # Check total supply does not exceed 100% (use new resource, exclude current line)
        self._check_supply_100_percent_limit(
            new_resource_id, supply.year, supply.month, fte_percent, exclude_supply_id=supply_id
        )

        old_values = {"fte_percent": supply.fte_percent, "resource_id": supply.resource_id, "project_id": supply.project_id}
        supply.fte_percent = fte_percent
        if changing_resource:
            supply.resource_id = new_resource_id
            supply.project_id = new_project_id
        self.db.commit()
        self.db.refresh(supply)

        log_audit(
            self.db, self.current_user,
            action="update",
            entity_type="SupplyLine",
            entity_id=supply.id,
            old_values=old_values,
            new_values={"fte_percent": fte_percent, "resource_id": supply.resource_id, "project_id": supply.project_id},
        )

        return supply
    
    def delete(self, supply_id: str) -> None:
        """Delete a supply line."""
        supply = self.get_by_id(supply_id)
        if not supply:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Supply line not found"}
            )

        # Enforce write-scope regardless of read-expanded role (e.g. Manager+Reader).
        # get_by_id uses read-scope (for_write=False) and can surface out-of-scope rows
        # for Manager+Reader; this explicit check closes that gap for single-delete.
        self._check_ro_resource_authorized(supply.resource_id)

        # Check period is open
        self._check_period_open(supply.year, supply.month)

        self.db.delete(supply)
        self.db.commit()

        log_audit(
            self.db, self.current_user,
            action="delete",
            entity_type="SupplyLine",
            entity_id=supply_id,
        )

    def delete_group(
        self,
        resource_id: str,
        project_id: str,
        period_ids: list[str],
    ) -> int:
        """Delete all supply lines for a resource + project across the given periods.

        Validates all periods are open before deleting any row (all-or-nothing).
        Returns the count of deleted rows.
        """
        # Validate resource exists within tenant
        resource = self.db.query(Resource).filter(
            and_(
                Resource.id == resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Resource not found"},
            )

        # Validate project exists within tenant
        project = self.db.query(Project).filter(
            and_(
                Project.id == project_id,
                Project.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Project not found"},
            )

        # Manager: only manage supply for resources in their cost center scope
        self._check_ro_resource_authorized(resource_id)

        # Validate all period_ids belong to current tenant
        periods = self.db.query(Period).filter(
            and_(
                Period.id.in_(period_ids),
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).all()

        period_map = {p.id: p for p in periods}
        for pid in period_ids:
            if pid not in period_map:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": f"Period {pid} not found"},
                )

        # Check ALL periods are open before touching any row (all-or-nothing)
        for period in periods:
            if period.status == PeriodStatus.LOCKED:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": ErrorCode.PERIOD_LOCKED,
                        "message": f"Period {period.year}-{period.month:02d} is locked. No edits allowed.",
                    },
                )

        # Fetch matching supply lines
        lines = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.resource_id == resource_id,
                SupplyLine.project_id == project_id,
                SupplyLine.period_id.in_(period_ids),
            )
        ).all()

        for line in lines:
            log_audit(
                self.db, self.current_user,
                action="delete",
                entity_type="SupplyLine",
                entity_id=line.id,
            )
            self.db.delete(line)

        self.db.commit()
        return len(lines)

    def move_group(
        self,
        from_resource_id: str,
        to_resource_id: str,
        project_id: str | None,
        to_project_id: str,
        period_ids: list[str],
        confirm_cap: bool = False,
    ) -> int:
        """Move all supply lines for a source resource + project to a target resource/project.

        project_id may be None for supply lines that were created without a project assignment.
        Validates all periods are open and checks for conflicts before updating any row
        (all-or-nothing). Returns the count of moved rows.
        """
        _MONTH_NAMES = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December',
        ]

        # Validate source project exists within tenant (skip when source has no project)
        if project_id:
            project = self.db.query(Project).filter(
                and_(
                    Project.id == project_id,
                    Project.tenant_id == self.current_user.tenant_id,
                )
            ).first()
            if not project:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": "Project not found"},
                )

        # Validate target project exists within tenant
        target_project = self.db.query(Project).filter(
            and_(
                Project.id == to_project_id,
                Project.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not target_project:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Target project not found"},
            )

        # Validate source resource exists within tenant
        source_resource = self.db.query(Resource).filter(
            and_(
                Resource.id == from_resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not source_resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Source resource not found"},
            )

        # Validate target resource exists, belongs to tenant, and is active
        target_resource = self.db.query(Resource).filter(
            and_(
                Resource.id == to_resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not target_resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Target resource not found"},
            )
        if not target_resource.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "RESOURCE_INACTIVE",
                    "message": "Cannot move supply to an inactive resource. This person has left the organisation.",
                },
            )

        # Manager: must be authorized to write supply for both source and target
        self._check_ro_resource_authorized(from_resource_id)
        self._check_ro_resource_authorized(to_resource_id)

        # Validate all period_ids belong to current tenant
        db_periods = self.db.query(Period).filter(
            and_(
                Period.id.in_(period_ids),
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).all()
        period_map = {p.id: p for p in db_periods}
        for pid in period_ids:
            if pid not in period_map:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"code": "NOT_FOUND", "message": f"Period {pid} not found"},
                )

        # Check all periods are open (all-or-nothing)
        for period in db_periods:
            if period.status == PeriodStatus.LOCKED:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": ErrorCode.PERIOD_LOCKED,
                        "message": f"Period {period.year}-{period.month:02d} is locked. No edits allowed.",
                    },
                )

        # Build year/month lookup structures for the requested periods
        year_month_pairs = [(p.year, p.month) for p in db_periods]
        period_ym_map = {(p.year, p.month): p for p in db_periods}

        # Fetch source supply lines — filter by IS NULL when project_id is None
        source_project_filter = (
            SupplyLine.project_id.is_(None) if project_id is None
            else SupplyLine.project_id == project_id
        )
        source_lines = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.resource_id == from_resource_id,
                source_project_filter,
                SupplyLine.period_id.in_(period_ids),
            )
        ).all()
        source_map = {(l.year, l.month): l for l in source_lines}

        # Fetch matching target supply lines for the same year/month pairs
        ym_filter = or_(*[
            and_(SupplyLine.year == y, SupplyLine.month == m)
            for y, m in year_month_pairs
        ])
        target_lines = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.resource_id == to_resource_id,
                SupplyLine.project_id == to_project_id,
                ym_filter,
            )
        ).all()
        target_map = {(l.year, l.month): l for l in target_lines}

        # Determine periods that would exceed 100% after merge
        cap_details = []
        for y, m in year_month_pairs:
            source_line = source_map.get((y, m))
            if not source_line:
                continue
            target_line = target_map.get((y, m))
            target_fte = target_line.fte_percent if target_line else 0
            raw_sum = source_line.fte_percent + target_fte
            if raw_sum > 100:
                period = period_ym_map[(y, m)]
                cap_details.append({
                    "period_id": period.id,
                    "label": f"{_MONTH_NAMES[m - 1]} {y}",
                    "existing_fte": target_fte,
                    "moved_fte": source_line.fte_percent,
                    "raw_total": raw_sum,
                    "capped_total": 100,
                })

        if cap_details and not confirm_cap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "MOVE_REQUIRES_CAP_CONFIRMATION",
                    "message": "Some target periods would exceed 100% supply after this move.",
                    "periods": cap_details,
                }
            )

        # Perform additive merge/move (all-or-nothing within this transaction)
        moved_count = 0
        for y, m in year_month_pairs:
            source_line = source_map.get((y, m))
            if not source_line:
                continue
            target_line = target_map.get((y, m))
            source_fte = source_line.fte_percent
            target_fte = target_line.fte_percent if target_line else 0
            capped_value = min(source_fte + target_fte, 100)

            if target_line:
                # Merge: update target FTE and delete source line
                log_audit(
                    self.db, self.current_user,
                    action="update",
                    entity_type="SupplyLine",
                    entity_id=target_line.id,
                    old_values={
                        "resource_id": target_line.resource_id,
                        "project_id": target_line.project_id,
                        "fte_percent": target_line.fte_percent,
                    },
                    new_values={
                        "fte_percent": capped_value,
                        "merged_from": source_line.id,
                        "moved_fte": source_fte,
                        "capped": capped_value < source_fte + target_fte,
                    },
                )
                target_line.fte_percent = capped_value
                log_audit(
                    self.db, self.current_user,
                    action="delete",
                    entity_type="SupplyLine",
                    entity_id=source_line.id,
                    old_values={
                        "resource_id": source_line.resource_id,
                        "project_id": source_line.project_id,
                        "fte_percent": source_fte,
                        "reason": "merged into target supply line",
                    },
                )
                self.db.delete(source_line)
            else:
                # Simple move: reassign source line to target resource/project
                log_audit(
                    self.db, self.current_user,
                    action="update",
                    entity_type="SupplyLine",
                    entity_id=source_line.id,
                    old_values={"resource_id": source_line.resource_id, "project_id": source_line.project_id},
                    new_values={"resource_id": to_resource_id, "project_id": to_project_id},
                )
                source_line.resource_id = to_resource_id
                source_line.project_id = to_project_id
            moved_count += 1

        self.db.commit()
        return moved_count
