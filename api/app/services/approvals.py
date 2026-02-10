"""Approvals service - workflow management."""
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
import logging

from api.app.models.approvals import (
    ApprovalInstance, ApprovalStep, ApprovalAction,
    ApprovalStatus, StepStatus,
)
from api.app.models.actuals import ActualLine
from api.app.models.core import User, Resource
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit


class ApprovalsService:
    """Service for approval workflow operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user
    
    def create_approval_for_actuals(self, actual_line: ActualLine) -> ApprovalInstance:
        """
        Create an approval instance when actuals are signed.
        
        Steps:
        1. RO approval
        2. Director approval (skipped if RO == Director)
        """
        # Get the resource's RO
        resource = self.db.query(Resource).filter(
            Resource.id == actual_line.resource_id
        ).first()
        
        if not resource:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resource not found"})
        
        # Get RO from cost center
        ro_user_id = None
        director_user_id = None
        
        if resource.cost_center:
            ro_user_id = resource.cost_center.ro_user_id
            # Get Director from department (simplified lookup)
            # TODO: In production, use Azure Graph API manager chain for accurate Director resolution
            if resource.cost_center.department:
                # Find Director user in this department (simplified)
                director = self.db.query(User).filter(
                    and_(
                        User.tenant_id == self.current_user.tenant_id,
                        User.department_id == resource.cost_center.department_id,
                        User.role == "Director",
                    )
                ).first()
                if director:
                    director_user_id = director.id
        
        # Create approval instance
        instance = ApprovalInstance(
            tenant_id=self.current_user.tenant_id,
            subject_type="actuals",
            subject_id=actual_line.id,
            status=ApprovalStatus.PENDING,
            created_by=self.current_user.object_id,
        )
        logging.info(f"Creating approval instance for actuals: resource_id={actual_line.resource_id}, ro_user_id={ro_user_id}, director_user_id={director_user_id}")
        self.db.add(instance)
        self.db.flush()
        
        # Create RO step
        ro_step = ApprovalStep(
            instance_id=instance.id,
            step_order=1,
            step_name="RO",
            approver_id=ro_user_id,
            status=StepStatus.PENDING,
        )
        logging.info(f"RO step: approver_id={ro_user_id}")
        self.db.add(ro_step)
        
        # Create Director step (may be skipped if RO == Director)
        skip_director = ro_user_id == director_user_id and ro_user_id is not None
        
        director_step = ApprovalStep(
            instance_id=instance.id,
            step_order=2,
            step_name="Director",
            approver_id=director_user_id,
            status=StepStatus.SKIPPED if skip_director else StepStatus.PENDING,
        )
        logging.info(f"Director step: approver_id={director_user_id}, skipped={skip_director}")
        self.db.add(director_step)
        
        self.db.commit()
        self.db.refresh(instance)
        
        log_audit(
            self.db, self.current_user,
            action="create",
            entity_type="ApprovalInstance",
            entity_id=instance.id,
            new_values={
                "subject_type": "actuals",
                "subject_id": actual_line.id,
                "skip_director": skip_director,
            }
        )
        
        return instance
    
    def get_inbox(self) -> List[ApprovalInstance]:
        """Get approval instances awaiting current user's action."""
        # Get current user's User record
        user = self._get_user()
        if not user:
            return []
        
        # Find instances with pending steps for this user
        pending_instances: List[ApprovalInstance] = []
        
        instances = self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
                ApprovalInstance.status == ApprovalStatus.PENDING,
            )
        ).all()
        
        for instance in instances:
            # Find the current step (first pending step)
            current_step = None
            for step in sorted(instance.steps, key=lambda s: s.step_order):
                if step.status == StepStatus.PENDING:
                    current_step = step
                    break
            if current_step:
                logging.info(f"Inbox check: user_id={user.id}, user_role={user.role}, step_name={current_step.step_name}, approver_id={current_step.approver_id}")
            if current_step and self._can_user_action_step(user, current_step):
                pending_instances.append(instance)
        
        return pending_instances
    
    def get_by_id(self, instance_id: str) -> Optional[ApprovalInstance]:
        """Get an approval instance by ID."""
        return self.db.query(ApprovalInstance).filter(
            and_(
                ApprovalInstance.id == instance_id,
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
            )
        ).first()
    
    def approve_step(self, instance_id: str, step_id: str, comment: Optional[str] = None) -> ApprovalInstance:
        """Approve a step."""
        instance = self.get_by_id(instance_id)
        if not instance:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Approval not found"})
        
        step = self.db.query(ApprovalStep).filter(
            and_(
                ApprovalStep.id == step_id,
                ApprovalStep.instance_id == instance_id,
            )
        ).first()
        
        if not step:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Step not found"})
        
        if step.status != StepStatus.PENDING:
            raise HTTPException(
                status_code=400,
                detail={"code": "VALIDATION_ERROR", "message": "Step is not pending"}
            )

        user = self._get_user()
        if not user or not self._can_user_action_step(user, step):
            raise HTTPException(
                status_code=403,
                detail={"code": "UNAUTHORIZED_ROLE", "message": "You are not allowed to approve this step"},
            )

        current_step = self._get_current_step(instance)
        if not current_step or current_step.id != step.id:
            raise HTTPException(
                status_code=400,
                detail={"code": "VALIDATION_ERROR", "message": "Only the current step can be approved"},
            )
        
        # Update step
        step.status = StepStatus.APPROVED
        step.actioned_at = datetime.now(timezone.utc)
        step.actioned_by = self.current_user.object_id
        step.comment = comment
        
        # Record action
        action = ApprovalAction(
            tenant_id=self.current_user.tenant_id,
            instance_id=instance_id,
            step_id=step_id,
            action="approve",
            performed_by=self.current_user.object_id,
            comment=comment,
        )
        self.db.add(action)
        
        # Check if all steps are complete
        all_done = all(
            s.status in (StepStatus.APPROVED, StepStatus.SKIPPED)
            for s in instance.steps
        )
        
        if all_done:
            instance.status = ApprovalStatus.APPROVED
        
        self.db.commit()
        self.db.refresh(instance)
        
        log_audit(
            self.db, self.current_user,
            action="approve",
            entity_type="ApprovalStep",
            entity_id=step_id,
        )
        
        return instance
    
    def reject_step(self, instance_id: str, step_id: str, comment: Optional[str] = None) -> ApprovalInstance:
        """Reject a step."""
        instance = self.get_by_id(instance_id)
        if not instance:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Approval not found"})
        
        step = self.db.query(ApprovalStep).filter(
            and_(
                ApprovalStep.id == step_id,
                ApprovalStep.instance_id == instance_id,
            )
        ).first()
        
        if not step:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Step not found"})
        
        if step.status != StepStatus.PENDING:
            raise HTTPException(
                status_code=400,
                detail={"code": "VALIDATION_ERROR", "message": "Step is not pending"}
            )

        user = self._get_user()
        if not user or not self._can_user_action_step(user, step):
            raise HTTPException(
                status_code=403,
                detail={"code": "UNAUTHORIZED_ROLE", "message": "You are not allowed to reject this step"},
            )

        current_step = self._get_current_step(instance)
        if not current_step or current_step.id != step.id:
            raise HTTPException(
                status_code=400,
                detail={"code": "VALIDATION_ERROR", "message": "Only the current step can be rejected"},
            )
        
        # Update step
        step.status = StepStatus.REJECTED
        step.actioned_at = datetime.now(timezone.utc)
        step.actioned_by = self.current_user.object_id
        step.comment = comment
        
        # Update instance
        instance.status = ApprovalStatus.REJECTED
        
        # Record action
        action = ApprovalAction(
            tenant_id=self.current_user.tenant_id,
            instance_id=instance_id,
            step_id=step_id,
            action="reject",
            performed_by=self.current_user.object_id,
            comment=comment,
        )
        self.db.add(action)
        
        self.db.commit()
        self.db.refresh(instance)
        
        log_audit(
            self.db, self.current_user,
            action="reject",
            entity_type="ApprovalStep",
            entity_id=step_id,
            reason=comment,
        )
        
        return instance

    def _get_user(self) -> Optional[User]:
        """Get the current user's User record."""
        return self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()

    def _get_current_step(self, instance: ApprovalInstance) -> Optional[ApprovalStep]:
        """Get the first pending step in order."""
        for step in sorted(instance.steps, key=lambda s: s.step_order):
            if step.status == StepStatus.PENDING:
                return step
        return None

    def _can_user_action_step(self, user: User, step: ApprovalStep) -> bool:
        """Check if the user can act on the given step."""
        if step.approver_id:
            return step.approver_id == user.id

        # If no explicit approver, require role match
        if step.step_name == "RO":
            return user.role == "RO"
        if step.step_name == "Director":
            return user.role == "Director"

        return False
