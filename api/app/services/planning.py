"""Planning services - Demand and Supply line management."""
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_

from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.core import Period, Project, Resource, Placeholder, User, PeriodStatus, UserRole
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
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


class DemandService:
    """Service for demand line operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user
    
    def _check_period_open(self, year: int, month: int) -> Period:
        """Check if the period exists and is open."""
        period = self.db.query(Period).filter(
            and_(
                Period.tenant_id == self.current_user.tenant_id,
                Period.year == year,
                Period.month == month,
            )
        ).first()
        
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

    def _get_scoped_resource_ids(self) -> Optional[list[str]]:
        """
        Return the list of resource IDs the current user may access, or None
        if the user has unscoped (full-tenant) access.
        Includes resources accessible via active delegation grants.
        """
        if self.current_user.role not in _SCOPED_ROLES:
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

    def get_all(self, year: Optional[int] = None, month: Optional[int] = None, project_id: Optional[str] = None, resource_id: Optional[str] = None, *, period_id: Optional[str] = None, open_periods_only: bool = False) -> list[DemandLine]:
        """Get all demand lines, optionally filtered by period/year/month/project/resource."""
        query = self.db.query(DemandLine).filter(
            DemandLine.tenant_id == self.current_user.tenant_id
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

        # RO/Director: restrict to resources within their reporting line
        scoped_ids = self._get_scoped_resource_ids()
        if scoped_ids is not None:
            query = query.filter(DemandLine.resource_id.in_(scoped_ids))

        return query.all()

    def get_by_id(self, demand_id: str) -> Optional[DemandLine]:
        """Get a demand line by ID."""
        demand = self.db.query(DemandLine).filter(
            and_(
                DemandLine.id == demand_id,
                DemandLine.tenant_id == self.current_user.tenant_id,
            )
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
            }
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


class SupplyService:
    """Service for supply line operations."""

    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user

    def _get_scoped_resource_ids(self) -> Optional[list[str]]:
        """Return cost-center-scoped resource IDs for Manager, or None for full access.
        Includes resources accessible via active delegation grants.
        """
        if self.current_user.role not in _SCOPED_ROLES:
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
        scoped_ids = self._get_scoped_resource_ids()
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
        period = self.db.query(Period).filter(
            and_(
                Period.tenant_id == self.current_user.tenant_id,
                Period.year == year,
                Period.month == month,
            )
        ).first()
        
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
    
    def get_all(self, year: Optional[int] = None, month: Optional[int] = None, project_id: Optional[str] = None, resource_id: Optional[str] = None, *, period_id: Optional[str] = None, open_periods_only: bool = False) -> list[SupplyLine]:
        """Get all supply lines, optionally filtered by period/year/month/resource."""
        query = self.db.query(SupplyLine).filter(
            SupplyLine.tenant_id == self.current_user.tenant_id
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
