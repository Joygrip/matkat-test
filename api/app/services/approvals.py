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
from api.app.models.core import User, Resource, UserRole
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
        1. Manager approval (SKIPPED if no synced manager)
        2. RO approval
        3. Director approval (SKIPPED if RO == Director)
        """
        # Get the resource (tenant-scoped)
        resource = self.db.query(Resource).filter(
            and_(
                Resource.id == actual_line.resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()

        if not resource:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resource not found"})

        # Get RO and Director from cost center
        ro_user_id = None
        director_user_id = None

        if resource.cost_center:
            ro_user_id = resource.cost_center.ro_user_id
            director_user_id = resource.cost_center.director_user_id

        # Create approval instance
        instance = ApprovalInstance(
            tenant_id=self.current_user.tenant_id,
            subject_type="actuals",
            subject_id=actual_line.id,
            status=ApprovalStatus.PENDING,
            created_by=self.current_user.object_id,
        )
        logging.info(
            "Creating approval instance for actuals: resource_id=%s, ro_user_id=%s, director_user_id=%s",
            actual_line.resource_id, ro_user_id, director_user_id,
        )
        self.db.add(instance)
        self.db.flush()

        # Resolve manager from synced DB relationship (no live Graph calls)
        manager_user_id = self._resolve_manager_approver_id(resource)

        # Manager step (step 1) — SKIPPED when no manager can be resolved
        manager_step = ApprovalStep(
            instance_id=instance.id,
            step_order=1,
            step_name="Manager",
            approver_id=manager_user_id,
            status=StepStatus.PENDING if manager_user_id else StepStatus.SKIPPED,
        )
        logging.info(
            "Manager step: approver_id=%s, skipped=%s", manager_user_id, manager_user_id is None
        )
        self.db.add(manager_step)

        # RO step (step 2)
        ro_step = ApprovalStep(
            instance_id=instance.id,
            step_order=2,
            step_name="RO",
            approver_id=ro_user_id,
            status=StepStatus.PENDING,
        )
        logging.info("RO step: approver_id=%s", ro_user_id)
        self.db.add(ro_step)

        # Director step (step 3, skipped if RO == Director)
        skip_director = ro_user_id == director_user_id and ro_user_id is not None

        director_step = ApprovalStep(
            instance_id=instance.id,
            step_order=3,
            step_name="Director",
            approver_id=director_user_id,
            status=StepStatus.SKIPPED if skip_director else StepStatus.PENDING,
        )
        logging.info(
            "Director step: approver_id=%s, skipped=%s", director_user_id, skip_director
        )
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
                "manager_user_id": manager_user_id,
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

    def _resolve_manager_approver_id(self, resource: Resource) -> Optional[str]:
        """
        Resolve the manager approver's User.id from the synced DB manager relationship.

        Returns the manager's User.id if a valid, active, tenant-scoped manager is found.
        Returns None (causing the Manager step to be SKIPPED) when:
          - resource has no linked User (external/contractor without Entra account)
          - the resource User has no synced manager_object_id
          - manager_object_id does not resolve to a User record in this tenant
          - the resolved manager is inactive

        No live Microsoft Graph calls are made.
        """
        if not resource.user_id:
            logging.info(
                "approval_routing: resource %s has no user_id (external/non-Entra), skipping manager step",
                resource.id,
            )
            return None

        resource_user = self.db.query(User).filter(
            and_(
                User.id == resource.user_id,
                User.tenant_id == self.current_user.tenant_id,
            )
        ).first()

        if not resource_user:
            logging.warning(
                "approval_routing: resource %s references user_id %s not found in tenant %s",
                resource.id, resource.user_id, self.current_user.tenant_id,
            )
            return None

        if not resource_user.manager_object_id:
            logging.info(
                "approval_routing: user %s has no synced manager_object_id, skipping manager step",
                resource_user.id,
            )
            return None

        manager = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == resource_user.manager_object_id,
            )
        ).first()

        if not manager:
            logging.warning(
                "approval_routing: manager_object_id %s not found in tenant %s (not yet synced?), skipping manager step",
                resource_user.manager_object_id, self.current_user.tenant_id,
            )
            return None

        if not manager.is_active:
            logging.warning(
                "approval_routing: manager %s is inactive, skipping manager step",
                manager.id,
            )
            return None

        return manager.id

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

        # Role-based fallback (only applies when approver_id is None)
        # Manager steps always have approver_id set when PENDING; this is a safety net.
        if step.step_name == "RO":
            return user.role == UserRole.RO
        if step.step_name == "Director":
            return user.role == UserRole.DIRECTOR

        # Manager step with no approver_id is not actionable by anyone
        return False
