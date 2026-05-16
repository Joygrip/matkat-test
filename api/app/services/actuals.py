"""Actuals service - time entry and signing."""
from datetime import datetime
from typing import Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, func

from api.app.models.actuals import ActualLine
from api.app.models.approvals import ApprovalInstance, ApprovalAction, ApprovalStep, ApprovalStatus, StepStatus
from api.app.models.core import Period, Project, Resource, PeriodStatus, User, UserRole
from api.app.models.planning import SupplyLine
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.services.period import PeriodService
from api.app.schemas.common import ErrorCode

_SCOPED_ROLES = (UserRole.MANAGER,)


class ActualsService:
    """Service for actuals operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user
    
    def _get_scoped_resource_ids(self, for_write: bool = False) -> "Optional[list[str]]":
        """Return reporting-hierarchy-scoped resource IDs for Manager, or None for full access.

        Always includes the manager's own resource so they can manage their own actuals.
        Also includes resources accessible via active delegation grants.
        Manager+Reader bypasses CC scoping for reads; for_write=True preserves write guards.
        """
        if self.current_user.role not in _SCOPED_ROLES:
            return None
        if not for_write and self.current_user.is_manager_reader:
            return None
        from api.app.services.reporting import ReportingService
        svc = ReportingService(self.db, self.current_user)
        ids = list(svc.get_accessible_resource_ids())
        own_id = self.get_my_resource_id()
        if own_id and own_id not in ids:
            ids.append(own_id)
        # Union with resources accessible via active delegation grants
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

    def _check_manager_resource_access(self, resource_id: str) -> None:
        """Raise 403 if the current user is a Manager but the resource is outside their cost center."""
        if self.current_user.role != UserRole.MANAGER:
            return
        scoped_ids = self._get_scoped_resource_ids(for_write=True)
        if scoped_ids is not None and resource_id not in scoped_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_RESOURCE",
                    "message": "You do not have access to records for this employee.",
                },
            )

    def _check_employee_owns_resource(self, resource_id: str) -> None:
        """
        If the current user is an Employee, verify they own the resource.
        Other roles (RO, Finance, Admin) are not restricted.
        """
        if self.current_user.role != UserRole.EMPLOYEE:
            return

        # Find the user record
        user = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_RESOURCE",
                    "message": "User record not found",
                }
            )

        # Find the resource and check ownership
        resource = self.db.query(Resource).filter(
            and_(
                Resource.id == resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not resource or resource.user_id != user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_RESOURCE",
                    "message": "Employees can only manage their own actuals",
                }
            )

    def _check_period_open(self, year: int, month: int) -> Period:
        """Check if the period exists and is open."""
        period = PeriodService(self.db, self.current_user).get_by_year_month(year, month)
        
        if not period:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "NOT_FOUND",
                    "message": f"Period {year}-{month:02d} does not exist.",
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
    
    def _check_100_percent_limit(
        self,
        resource_id: str,
        year: int,
        month: int,
        new_fte: int,
        exclude_line_id: Optional[str] = None,
    ) -> None:
        """
        Check that total actuals for a resource don't exceed 100%.
        
        Raises HTTPException with ACTUALS_OVER_100 if limit exceeded.
        """
        # Get all actuals for this resource/month
        query = self.db.query(ActualLine).filter(
            and_(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.resource_id == resource_id,
                ActualLine.year == year,
                ActualLine.month == month,
            )
        )
        
        if exclude_line_id:
            query = query.filter(ActualLine.id != exclude_line_id)
        
        existing_lines = query.all()
        existing_total = sum(line.actual_fte_percent for line in existing_lines)
        new_total = existing_total + new_fte
        
        if new_total > 100:
            # Collect offending line IDs
            offending_ids = [line.id for line in existing_lines]
            
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.ACTUALS_OVER_100,
                    "message": f"Total actuals would be {new_total}%, which exceeds the 100% limit.",
                    "total_percent": new_total,
                    "resource_id": resource_id,
                    "year": year,
                    "month": month,
                    "offending_line_ids": offending_ids,
                }
            )
    
    def get_my_actuals(self, year: Optional[int] = None, month: Optional[int] = None) -> list[ActualLine]:
        """Get actuals for the current user's resource."""
        # Find the resource for this user
        user = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()
        
        if not user:
            return []
        
        # Find resource linked to this user
        resource = self.db.query(Resource).filter(
            and_(
                Resource.tenant_id == self.current_user.tenant_id,
                Resource.user_id == user.id,
            )
        ).first()
        
        if not resource:
            return []

        query = self.db.query(ActualLine).filter(
            and_(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.resource_id == resource.id,
            )
        )
        
        if year:
            query = query.filter(ActualLine.year == year)
        if month:
            query = query.filter(ActualLine.month == month)
        
        return query.all()

    def get_my_resource_id(self) -> Optional[str]:
        """Return the resource id linked to the current user, or None."""
        user = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()
        if not user:
            return None
        resource = self.db.query(Resource).filter(
            and_(
                Resource.tenant_id == self.current_user.tenant_id,
                Resource.user_id == user.id,
            )
        ).first()
        return resource.id if resource else None

    def get_all(
        self,
        year: Optional[int] = None,
        month: Optional[int] = None,
        resource_id: Optional[str] = None,
    ) -> list[ActualLine]:
        """Get all actuals (for RO/Finance/Admin). RO/Director see only their reporting line."""
        query = self.db.query(ActualLine).filter(
            ActualLine.tenant_id == self.current_user.tenant_id
        )

        if year:
            query = query.filter(ActualLine.year == year)
        if month:
            query = query.filter(ActualLine.month == month)
        if resource_id:
            query = query.filter(ActualLine.resource_id == resource_id)

        # RO/Director: restrict to resources within their reporting line
        scoped_ids = self._get_scoped_resource_ids()
        if scoped_ids is not None:
            query = query.filter(ActualLine.resource_id.in_(scoped_ids))

        query = query.options(
            joinedload(ActualLine.resource),
            joinedload(ActualLine.project),
        )
        return query.all()
    
    def get_by_id(self, actual_id: str) -> Optional[ActualLine]:
        """Get an actual line by ID. Returns None if Manager lacks cost-center access."""
        line = self.db.query(ActualLine).filter(
            and_(
                ActualLine.id == actual_id,
                ActualLine.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if line and self.current_user.role in _SCOPED_ROLES:
            scoped_ids = self._get_scoped_resource_ids()
            if scoped_ids is not None and line.resource_id not in scoped_ids:
                return None
        return line
    
    def create(
        self,
        resource_id: str,
        project_id: str,
        year: int,
        month: int,
        actual_fte_percent: int,
        planned_fte_percent: Optional[int] = None,
        proxy_sign_reason: Optional[str] = None,
    ) -> ActualLine:
        """Create a new actual line."""
        # Validate period is open
        period = self._check_period_open(year, month)
        
        # Validate FTE
        if actual_fte_percent != 0 and (actual_fte_percent < 5 or actual_fte_percent > 100 or actual_fte_percent % 5 != 0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be 0 or between 5 and 100 in steps of 5",
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
        
        # Employees can only create actuals for their own resource
        self._check_employee_owns_resource(resource_id)
        # Managers can only create actuals for resources in their cost center (or themselves)
        self._check_manager_resource_access(resource_id)

        # For managers entering on behalf of another employee, reason is required
        is_manager_own = False
        if self.current_user.role == UserRole.MANAGER:
            own_id = self.get_my_resource_id()
            is_manager_own = (own_id is not None and resource_id == own_id)
            if not is_manager_own and (not proxy_sign_reason or not proxy_sign_reason.strip()):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "VALIDATION_ERROR",
                        "message": "Reason is required when entering actuals for another employee",
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
        
        # Check for duplicate
        existing = self.db.query(ActualLine).filter(
            and_(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.resource_id == resource_id,
                ActualLine.project_id == project_id,
                ActualLine.year == year,
                ActualLine.month == month,
            )
        ).first()
        
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONFLICT",
                    "message": "An actual line already exists for this resource/project/month",
                }
            )
        
        # Check 100% limit
        self._check_100_percent_limit(resource_id, year, month, actual_fte_percent)

        # Auto-populate planned_fte_percent from supply line if not provided
        if planned_fte_percent is None:
            supply = self.db.query(SupplyLine).filter(
                and_(
                    SupplyLine.tenant_id == self.current_user.tenant_id,
                    SupplyLine.resource_id == resource_id,
                    SupplyLine.project_id == project_id,
                    SupplyLine.year == year,
                    SupplyLine.month == month,
                )
            ).first()
            if supply is None:
                # Fall back to general supply (no specific project)
                supply = self.db.query(SupplyLine).filter(
                    and_(
                        SupplyLine.tenant_id == self.current_user.tenant_id,
                        SupplyLine.resource_id == resource_id,
                        SupplyLine.project_id == None,
                        SupplyLine.year == year,
                        SupplyLine.month == month,
                    )
                ).first()
            if supply:
                planned_fte_percent = supply.fte_percent

        # Create actual line
        actual = ActualLine(
            tenant_id=self.current_user.tenant_id,
            period_id=period.id,
            resource_id=resource_id,
            project_id=project_id,
            year=year,
            month=month,
            actual_fte_percent=actual_fte_percent,
            planned_fte_percent=planned_fte_percent,
            created_by=self.current_user.object_id,
        )
        self.db.add(actual)
        self.db.commit()
        self.db.refresh(actual)

        # Auto-sign on create
        if self.current_user.role == UserRole.EMPLOYEE:
            # Employee entering their own actuals
            actual.employee_signed_at = datetime.utcnow()
            actual.employee_signed_by = self.current_user.object_id
            actual.is_proxy_signed = False
            self.db.commit()
            self.db.refresh(actual)
            self._ensure_approval_instance(actual)
        elif self.current_user.role == UserRole.MANAGER:
            actual.employee_signed_at = datetime.utcnow()
            actual.employee_signed_by = self.current_user.object_id
            if is_manager_own:
                # Manager entering their own actuals - sign as self
                actual.is_proxy_signed = False
            else:
                # Manager entering on behalf of an employee - proxy sign with reason
                actual.is_proxy_signed = True
                actual.proxy_sign_reason = proxy_sign_reason.strip()  # type: ignore[union-attr]
            self.db.commit()
            self.db.refresh(actual)
            self._ensure_approval_instance(actual)

        log_audit(
            self.db, self.current_user,
            action="create",
            entity_type="ActualLine",
            entity_id=actual.id,
            new_values={
                "resource_id": resource_id,
                "project_id": project_id,
                "year": year,
                "month": month,
                "actual_fte_percent": actual_fte_percent,
                **({"employee_signed_at": str(actual.employee_signed_at)} if actual.employee_signed_at else {}),
            }
        )

        return actual
    
    def update(self, actual_id: str, data: dict) -> ActualLine:
        """Update an actual line's editable fields before signing."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )
        
        # Employees can only update their own actuals
        self._check_employee_owns_resource(actual.resource_id)
        # Managers can only update actuals for resources in their cost center
        self._check_manager_resource_access(actual.resource_id)

        # Block edit once approved; pending approval can still be edited
        if actual.employee_signed_at:
            instance = self.db.query(ApprovalInstance).filter(
                and_(
                    ApprovalInstance.tenant_id == self.current_user.tenant_id,
                    ApprovalInstance.subject_type == "actuals",
                    ApprovalInstance.subject_id == actual.id,
                )
            ).order_by(ApprovalInstance.created_at.desc()).first()
            if instance and instance.status == ApprovalStatus.APPROVED:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "VALIDATION_ERROR",
                        "message": "Cannot edit approved actuals",
                    }
                )

        # Check period is open
        self._check_period_open(actual.year, actual.month)
        
        old_values = {}
        new_values = {}
        
        # Update actual_fte_percent if provided
        if data.get("actual_fte_percent") is not None:
            new_fte = data["actual_fte_percent"]
            # Validate FTE
            if new_fte != 0 and (new_fte < 5 or new_fte > 100 or new_fte % 5 != 0):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": ErrorCode.FTE_INVALID,
                        "message": "FTE must be 0 or between 5 and 100 in steps of 5",
                    }
                )
            self._check_100_percent_limit(
                actual.resource_id, actual.year, actual.month,
                new_fte, exclude_line_id=actual.id
            )
            old_values["actual_fte_percent"] = actual.actual_fte_percent
            actual.actual_fte_percent = new_fte
            new_values["actual_fte_percent"] = new_fte
        
        # Update planned_fte_percent if provided
        if data.get("planned_fte_percent") is not None:
            old_values["planned_fte_percent"] = actual.planned_fte_percent
            actual.planned_fte_percent = data["planned_fte_percent"]
            new_values["planned_fte_percent"] = data["planned_fte_percent"]
        
        # Update project_id if provided
        if data.get("project_id") is not None:
            old_values["project_id"] = actual.project_id
            actual.project_id = data["project_id"]
            new_values["project_id"] = data["project_id"]
        
        self.db.commit()
        self.db.refresh(actual)

        # Auto-sign for employees on edit (re-submit after rejection+unsign)
        if self.current_user.role == UserRole.EMPLOYEE and not actual.employee_signed_at:
            actual.employee_signed_at = datetime.utcnow()
            actual.employee_signed_by = self.current_user.object_id
            actual.is_proxy_signed = False
            self.db.commit()
            self.db.refresh(actual)
            self._ensure_approval_instance(actual)
            new_values["employee_signed_at"] = str(actual.employee_signed_at)

        log_audit(
            self.db, self.current_user,
            action="update",
            entity_type="ActualLine",
            entity_id=actual.id,
            old_values=old_values,
            new_values=new_values,
        )

        return actual
    
    def delete(self, actual_id: str) -> None:
        """Delete an actual line."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )
        
        # Employees can only delete their own actuals
        self._check_employee_owns_resource(actual.resource_id)
        # Managers can only delete actuals for resources in their cost center
        self._check_manager_resource_access(actual.resource_id)

        # Block delete once approved; pending approval can still be deleted
        if actual.employee_signed_at:
            instance = self.db.query(ApprovalInstance).filter(
                and_(
                    ApprovalInstance.tenant_id == self.current_user.tenant_id,
                    ApprovalInstance.subject_type == "actuals",
                    ApprovalInstance.subject_id == actual.id,
                )
            ).order_by(ApprovalInstance.created_at.desc()).first()
            if instance and instance.status == ApprovalStatus.APPROVED:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "code": "VALIDATION_ERROR",
                        "message": "Cannot delete approved actuals",
                    }
                )
            # Clean up the orphaned approval instance before deleting the actual
            if instance:
                self.db.query(ApprovalAction).filter(ApprovalAction.instance_id == instance.id).delete()
                self.db.query(ApprovalStep).filter(ApprovalStep.instance_id == instance.id).delete()
                self.db.delete(instance)
                self.db.flush()

        # Check period is open
        self._check_period_open(actual.year, actual.month)

        self.db.delete(actual)
        self.db.commit()
        
        log_audit(
            self.db, self.current_user,
            action="delete",
            entity_type="ActualLine",
            entity_id=actual_id,
        )
    
    def sign(self, actual_id: str) -> ActualLine:
        """Employee or Manager (own resource) signs their own actuals."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )

        # Employees can only sign their own actuals
        self._check_employee_owns_resource(actual.resource_id)
        # Managers can only sign actuals for their own resource
        if self.current_user.role == UserRole.MANAGER:
            own_id = self.get_my_resource_id()
            if own_id is None or actual.resource_id != own_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "UNAUTHORIZED_RESOURCE",
                        "message": "Managers can only sign their own actuals directly. Use proxy sign for team members.",
                    },
                )
        
        if actual.employee_signed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Actuals already signed",
                }
            )

        # Check period is open
        self._check_period_open(actual.year, actual.month)
        
        actual.employee_signed_at = datetime.utcnow()
        actual.employee_signed_by = self.current_user.object_id
        actual.is_proxy_signed = False
        
        self.db.commit()
        self.db.refresh(actual)

        self._ensure_approval_instance(actual)
        
        log_audit(
            self.db, self.current_user,
            action="sign",
            entity_type="ActualLine",
            entity_id=actual.id,
            new_values={"employee_signed_at": str(actual.employee_signed_at)},
        )
        
        return actual
    
    def proxy_sign(self, actual_id: str, reason: str) -> ActualLine:
        """RO signs on behalf of absent employee."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )

        # RO/Director: verify this employee is in their reporting line
        scoped_ids = self._get_scoped_resource_ids(for_write=True)
        if scoped_ids is not None and actual.resource_id not in scoped_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_RESOURCE",
                    "message": "You do not have access to records for this employee.",
                },
            )

        if actual.employee_signed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Actuals already signed",
                }
            )
        
        # Check period is open
        self._check_period_open(actual.year, actual.month)

        if not reason or not reason.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Reason is required for proxy signing",
                }
            )
        
        actual.employee_signed_at = datetime.utcnow()
        actual.employee_signed_by = self.current_user.object_id
        actual.is_proxy_signed = True
        actual.proxy_sign_reason = reason.strip()
        
        self.db.commit()
        self.db.refresh(actual)

        self._ensure_approval_instance(actual)
        
        log_audit(
            self.db, self.current_user,
            action="proxy_sign",
            entity_type="ActualLine",
            entity_id=actual.id,
            new_values={
                "employee_signed_at": str(actual.employee_signed_at),
                "is_proxy_signed": True,
            },
            reason=reason.strip(),
        )
        
        return actual

    def _ensure_approval_instance(self, actual: ActualLine) -> None:
        """Create an approval instance if one does not already exist (or if the last one was rejected)."""
        existing = self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id == actual.id,
            )
        ).order_by(ApprovalInstance.created_at.desc()).first()
        # Skip creation only when there is an active (pending or approved) instance.
        # If the prior instance was rejected, fall through to create a fresh one.
        if existing and existing.status in (ApprovalStatus.PENDING, ApprovalStatus.APPROVED):
            return

        from api.app.services.approvals import ApprovalsService

        ApprovalsService(self.db, self.current_user).create_approval_for_actuals(actual)

    def unsign(self, actual_id: str) -> ActualLine:
        """Clear an employee's signature so they can edit and re-submit a rejected actual."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )

        self._check_employee_owns_resource(actual.resource_id)
        self._check_period_open(actual.year, actual.month)

        if not actual.employee_signed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "VALIDATION_ERROR", "message": "Actuals are not signed"}
            )

        # Only allow unsign when the approval was rejected
        instance = self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id == actual.id,
            )
        ).order_by(ApprovalInstance.created_at.desc()).first()

        if instance and instance.status != ApprovalStatus.REJECTED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Can only unsign actuals with a rejected approval",
                }
            )

        actual.employee_signed_at = None
        actual.employee_signed_by = None
        actual.is_proxy_signed = False
        actual.proxy_sign_reason = None

        self.db.commit()
        self.db.refresh(actual)

        log_audit(
            self.db, self.current_user,
            action="unsign",
            entity_type="ActualLine",
            entity_id=actual.id,
            new_values={"employee_signed_at": None},
        )

        return actual

    def resubmit(self, actual_id: str, actual_fte_percent: float) -> ActualLine:
        """Unsign, update FTE, and re-sign in a single transaction for a rejected actual."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )

        self._check_employee_owns_resource(actual.resource_id)
        self._check_period_open(actual.year, actual.month)

        instance = self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id == actual.id,
            )
        ).order_by(ApprovalInstance.created_at.desc()).first()

        if not instance or instance.status != ApprovalStatus.REJECTED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Can only resubmit actuals with a rejected approval",
                }
            )

        if actual_fte_percent != 0 and (
            actual_fte_percent < 5 or actual_fte_percent > 100 or actual_fte_percent % 5 != 0
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be 0 or between 5 and 100 in steps of 5",
                }
            )
        self._check_100_percent_limit(
            actual.resource_id, actual.year, actual.month,
            actual_fte_percent, exclude_line_id=actual.id
        )

        old_fte = actual.actual_fte_percent
        actual.actual_fte_percent = actual_fte_percent
        actual.employee_signed_at = None
        actual.employee_signed_by = None
        actual.is_proxy_signed = False
        actual.proxy_sign_reason = None
        actual.employee_signed_at = datetime.utcnow()
        actual.employee_signed_by = self.current_user.object_id
        actual.is_proxy_signed = False

        self.db.commit()
        self.db.refresh(actual)

        self._ensure_approval_instance(actual)

        log_audit(
            self.db, self.current_user,
            action="resubmit",
            entity_type="ActualLine",
            entity_id=actual.id,
            old_values={"actual_fte_percent": old_fte},
            new_values={
                "actual_fte_percent": actual_fte_percent,
                "employee_signed_at": str(actual.employee_signed_at),
            },
        )

        return actual

    def get_my_approval_statuses(
        self, year: Optional[int] = None, month: Optional[int] = None
    ) -> Dict[str, Any]:
        """Return approval status keyed by actual_line_id for the current user's actuals."""
        actuals = self.get_my_actuals(year, month)
        return self._approval_statuses_for_lines([a.id for a in actuals])

    def get_approval_statuses(
        self, year: Optional[int] = None, month: Optional[int] = None
    ) -> Dict[str, Any]:
        """Return approval status keyed by actual_line_id for all actuals visible to the user."""
        if self.current_user.role == UserRole.EMPLOYEE:
            actuals = self.get_my_actuals(year, month)
        else:
            actuals = self.get_all(year, month)
        return self._approval_statuses_for_lines([a.id for a in actuals])

    def _approval_statuses_for_lines(self, actual_ids: list) -> Dict[str, Any]:
        """Return approval status keyed by actual_line_id for the given list of IDs."""
        if not actual_ids:
            return {}

        instances = self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id.in_(actual_ids),
            )
        ).order_by(ApprovalInstance.created_at.desc()).all()

        # Latest instance per actual_id
        latest: Dict[str, ApprovalInstance] = {}
        for inst in instances:
            if inst.subject_id not in latest:
                latest[inst.subject_id] = inst

        # Resolve current user's DB record (needed for step-2 proxy-approve check)
        current_user_record = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()

        result: Dict[str, Any] = {}
        for actual_id, inst in latest.items():
            rejection_comment: Optional[str] = None
            if inst.status == ApprovalStatus.REJECTED:
                rejected_step = self.db.query(ApprovalStep).filter(
                    and_(
                        ApprovalStep.instance_id == inst.id,
                        ApprovalStep.status == StepStatus.REJECTED,
                    )
                ).first()
                if rejected_step and rejected_step.comment:
                    rejection_comment = rejected_step.comment

            # Check if current user can proxy-approve step 1 as the step 2 approver
            can_proxy_approve_step1 = False
            step1_id = None
            if current_user_record and inst.status == ApprovalStatus.PENDING:
                steps = sorted(inst.steps, key=lambda s: s.step_order)
                inst_step1 = next((s for s in steps if s.step_order == 1), None)
                inst_step2 = next((s for s in steps if s.step_order == 2), None)
                if (inst_step1 and inst_step1.status == StepStatus.PENDING
                        and inst_step2 and inst_step2.status == StepStatus.PENDING):
                    from api.app.services.approvals import ApprovalsService
                    svc = ApprovalsService(self.db, self.current_user)
                    if svc._can_user_action_step(current_user_record, inst_step2):
                        can_proxy_approve_step1 = True
                        step1_id = inst_step1.id

            result[actual_id] = {
                "approval_id": inst.id,
                "status": inst.status.value,
                "rejection_comment": rejection_comment,
                "can_proxy_approve_step1": can_proxy_approve_step1,
                "step1_id": step1_id,
            }

        return result
    
    def get_resource_monthly_total(self, resource_id: str, year: int, month: int) -> int:
        """Get total FTE for a resource in a given month."""
        result = self.db.query(func.sum(ActualLine.actual_fte_percent)).filter(
            and_(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.resource_id == resource_id,
                ActualLine.year == year,
                ActualLine.month == month,
            )
        ).scalar()
        
        return result or 0
