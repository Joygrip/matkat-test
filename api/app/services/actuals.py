"""Actuals service - time entry and signing."""
from datetime import datetime
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from api.app.models.actuals import ActualLine
from api.app.models.approvals import ApprovalInstance
from api.app.models.core import Period, Project, Resource, PeriodStatus, User, UserRole
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.schemas.common import ErrorCode


class ActualsService:
    """Service for actuals operations."""
    
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
    
    def get_all(
        self,
        year: Optional[int] = None,
        month: Optional[int] = None,
        resource_id: Optional[str] = None,
    ) -> list[ActualLine]:
        """Get all actuals (for RO/Finance)."""
        query = self.db.query(ActualLine).filter(
            ActualLine.tenant_id == self.current_user.tenant_id
        )
        
        if year:
            query = query.filter(ActualLine.year == year)
        if month:
            query = query.filter(ActualLine.month == month)
        if resource_id:
            query = query.filter(ActualLine.resource_id == resource_id)
        
        return query.all()
    
    def get_by_id(self, actual_id: str) -> Optional[ActualLine]:
        """Get an actual line by ID."""
        return self.db.query(ActualLine).filter(
            and_(
                ActualLine.id == actual_id,
                ActualLine.tenant_id == self.current_user.tenant_id,
            )
        ).first()
    
    def create(
        self,
        resource_id: str,
        project_id: str,
        year: int,
        month: int,
        actual_fte_percent: int,
        planned_fte_percent: Optional[int] = None,
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
            }
        )
        
        return actual
    
    def update(self, actual_id: str, actual_fte_percent: int) -> ActualLine:
        """Update an actual line's FTE."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
            )
        
        # Check if already signed
        if actual.employee_signed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Cannot edit signed actuals",
                }
            )
        
        # Check period is open
        self._check_period_open(actual.year, actual.month)
        
        # Validate FTE
        if actual_fte_percent != 0 and (actual_fte_percent < 5 or actual_fte_percent > 100 or actual_fte_percent % 5 != 0):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": ErrorCode.FTE_INVALID,
                    "message": "FTE must be 0 or between 5 and 100 in steps of 5",
                }
            )
        
        # Check 100% limit (excluding this line's current value)
        self._check_100_percent_limit(
            actual.resource_id, actual.year, actual.month,
            actual_fte_percent, exclude_line_id=actual.id
        )
        
        old_fte = actual.actual_fte_percent
        actual.actual_fte_percent = actual_fte_percent
        self.db.commit()
        self.db.refresh(actual)
        
        log_audit(
            self.db, self.current_user,
            action="update",
            entity_type="ActualLine",
            entity_id=actual.id,
            old_values={"actual_fte_percent": old_fte},
            new_values={"actual_fte_percent": actual_fte_percent},
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
        
        # Check if already signed
        if actual.employee_signed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Cannot delete signed actuals",
                }
            )
        
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
        """Employee signs their own actuals."""
        actual = self.get_by_id(actual_id)
        if not actual:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Actual line not found"}
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
        
        if actual.employee_signed_at:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "Actuals already signed",
                }
            )
        
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
        """Create an approval instance if one does not already exist."""
        existing = self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.subject_id == actual.id,
            )
        ).first()
        if existing:
            return

        from api.app.services.approvals import ApprovalsService

        ApprovalsService(self.db, self.current_user).create_approval_for_actuals(actual)
    
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
