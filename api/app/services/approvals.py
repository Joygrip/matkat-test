"""Approvals service - workflow management."""
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
import logging
import threading

from api.app.models.approvals import (
    ApprovalInstance, ApprovalStep, ApprovalAction,
    ApprovalStatus, StepStatus,
)
from api.app.models.actuals import ActualLine
from api.app.models.core import User, Resource, Project, ManagerOverride, ApprovalDelegate
from api.app.models.notification_schedule import NotificationSchedule, NotificationScheduleType
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.services.notifications import NotificationsService


class ApprovalsService:
    """Service for approval workflow operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user
    
    def create_approval_for_actuals(self, actual_line: ActualLine) -> ApprovalInstance:
        """
        Create an approval instance when actuals are signed.

        Steps:
        1. RO = requester's direct manager from synced DB hierarchy
        2. Director = RO's direct manager from synced DB hierarchy (SKIPPED if same as RO or not found)

        ManagerOverride entries take precedence over User.manager_object_id at each level.
        Falls back to CostCenter.ro_user_id / director_user_id when no hierarchy data exists.
        No live Graph calls are made.
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

        # Resolve RO and Director from DB hierarchy (no live Graph calls)
        ro_user_id, director_user_id = self._resolve_hierarchy_approvers(resource)

        logging.info(
            "Creating approval instance for actuals: resource_id=%s, ro_user_id=%s, director_user_id=%s",
            actual_line.resource_id, ro_user_id, director_user_id,
        )

        # Create approval instance
        instance = ApprovalInstance(
            tenant_id=self.current_user.tenant_id,
            subject_type="actuals",
            subject_id=actual_line.id,
            status=ApprovalStatus.PENDING,
            created_by=self.current_user.object_id,
        )
        self.db.add(instance)
        self.db.flush()

        # Step 1: Manager (requester's direct manager from hierarchy)
        ro_step = ApprovalStep(
            instance_id=instance.id,
            step_order=1,
            step_name="Manager",
            approver_id=ro_user_id,
            status=StepStatus.PENDING if ro_user_id else StepStatus.SKIPPED,
        )
        logging.info("Manager step: approver_id=%s, skipped=%s", ro_user_id, ro_user_id is None)
        self.db.add(ro_step)

        # Step 2: Senior Manager (manager's direct manager); skip if same person or not found
        skip_director = (director_user_id == ro_user_id and ro_user_id is not None) or not director_user_id
        director_step = ApprovalStep(
            instance_id=instance.id,
            step_order=2,
            step_name="Senior Manager",
            approver_id=director_user_id,
            status=StepStatus.SKIPPED if skip_director else StepStatus.PENDING,
        )
        logging.info(
            "Senior Manager step: approver_id=%s, skipped=%s", director_user_id, skip_director
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
                "ro_user_id": ro_user_id,
                "director_user_id": director_user_id,
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

        # Prefix comment with delegation attribution when acting as a delegate
        is_delegated, delegated_for_name = self._get_delegation_info(user, step)
        if is_delegated and delegated_for_name:
            comment = f"[DELEGATE for {delegated_for_name}] {comment or ''}".strip()

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
            details=self._build_step_audit_details(
                step=step,
                instance=instance,
                user=user,
                is_delegated=is_delegated,
                delegated_for_name=delegated_for_name,
                approval_status="approved",
            ),
        )

        return instance

    def proxy_approve_step1_by_step2(self, instance_id: str, step1_id: str, comment: str) -> ApprovalInstance:
        """Step 2 approver proxy-approves Step 1 on behalf of the direct manager."""
        instance = self.get_by_id(instance_id)
        if not instance:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Approval not found"})

        step1 = next((s for s in instance.steps if s.id == step1_id and s.step_order == 1), None)
        if not step1:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Step 1 not found"})

        if step1.status != StepStatus.PENDING:
            raise HTTPException(status_code=400, detail={"code": "VALIDATION_ERROR", "message": "Step 1 is not pending"})

        step2 = next((s for s in instance.steps if s.step_order == 2), None)
        if not step2:
            raise HTTPException(status_code=403, detail={"code": "UNAUTHORIZED_ROLE", "message": "No step 2 exists for this approval"})

        user = self._get_user()
        if not user or not self._can_user_action_step(user, step2):
            raise HTTPException(status_code=403, detail={"code": "UNAUTHORIZED_ROLE", "message": "Only the step 2 approver can proxy-approve step 1"})

        step1.status = StepStatus.APPROVED
        step1.actioned_at = datetime.now(timezone.utc)
        step1.actioned_by = self.current_user.object_id
        step1.comment = f"[PROXY-APPROVE by Senior Manager] {comment}"

        action = ApprovalAction(
            tenant_id=self.current_user.tenant_id,
            instance_id=instance_id,
            step_id=step1_id,
            action="approve",
            performed_by=self.current_user.object_id,
            comment=step1.comment,
        )
        self.db.add(action)
        self.db.commit()
        self.db.refresh(instance)

        log_audit(
            self.db, self.current_user,
            action="proxy_approve_step1",
            entity_type="ApprovalStep",
            entity_id=step1_id,
            details=self._build_step_audit_details(
                step=step1,
                instance=instance,
                user=user,
                is_delegated=False,
                delegated_for_name=None,
                approval_status="proxy_approved",
                proxy_approver_name=user.display_name,
            ),
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

        # Prefix comment with delegation attribution when acting as a delegate
        is_delegated, delegated_for_name = self._get_delegation_info(user, step)
        if is_delegated and delegated_for_name:
            comment = f"[DELEGATE for {delegated_for_name}] {comment or ''}".strip()

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
            details=self._build_step_audit_details(
                step=step,
                instance=instance,
                user=user,
                is_delegated=is_delegated,
                delegated_for_name=delegated_for_name,
                approval_status="rejected",
            ),
        )

        # Fire-and-forget rejection email — runs in background so the user gets an
        # immediate response regardless of Graph API latency.
        if instance.subject_type == "actuals":
            _subject_id  = instance.subject_id
            _step_id     = step.id
            _approver_id = step.approver_id
            _tenant_id   = self.current_user.tenant_id
            _current_user = self.current_user

            def _send_rejection_email():
                try:
                    from api.app.db.engine import SessionLocal
                    bg_db = SessionLocal()
                    try:
                        actual = bg_db.query(ActualLine).filter(
                            ActualLine.id == _subject_id
                        ).first()
                        if actual:
                            rejector = bg_db.query(User).filter(
                                User.id == _approver_id
                            ).first()
                            rejector_name = rejector.display_name if rejector else "Unknown"

                            action = bg_db.query(ApprovalAction).filter(
                                ApprovalAction.step_id == _step_id,
                                ApprovalAction.action == "reject",
                            ).order_by(ApprovalAction.created_at.desc()).first()
                            bg_comment = action.comment if action else None

                            schedule = bg_db.query(NotificationSchedule).filter(
                                NotificationSchedule.notification_type == NotificationScheduleType.APPROVAL_REJECTION.value,
                                NotificationSchedule.tenant_id == _tenant_id,
                                NotificationSchedule.is_active == True,  # noqa: E712
                            ).first()

                            if schedule:
                                excluded = schedule.excluded_emails or []
                                bg_svc = NotificationsService(bg_db, _current_user)
                                bg_svc.send_rejection_notification(
                                    actual=actual,
                                    rejector_name=rejector_name,
                                    comment=bg_comment,
                                    excluded_emails=excluded,
                                )
                    finally:
                        bg_db.close()
                except Exception as exc:
                    logging.error("Failed to send rejection notification: %s", exc)

            threading.Thread(target=_send_rejection_email, daemon=True).start()

        return instance

    def _get_user(self) -> Optional[User]:
        """Get the current user's User record."""
        return self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()

    def _resolve_hierarchy_approvers(
        self, resource: Resource
    ) -> tuple[Optional[str], Optional[str]]:
        """
        Resolve (ro_user_id, director_user_id) from the synced DB hierarchy.

        RO  = requester's direct manager (ManagerOverride > manager_object_id > CostCenter fallback)
        Dir = RO's direct manager        (ManagerOverride > manager_object_id > CostCenter fallback)

        Returns User.id values (not object_ids). None means the step will be SKIPPED.
        No live Graph calls are made.
        """
        if not resource.user_id:
            # External/non-Entra resource — fall back to CostCenter immediately
            return self._cc_fallback(resource)

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
            return self._cc_fallback(resource)

        # Resolve RO = direct manager of the resource's user
        ro_user = self._resolve_direct_manager(resource_user)

        if ro_user is None:
            # No hierarchy data yet — fall back to CostCenter
            logging.info(
                "approval_routing: no hierarchy manager found for user %s, using CostCenter fallback",
                resource_user.id,
            )
            return self._cc_fallback(resource)

        # Resolve Director = direct manager of the RO
        director_user = self._resolve_direct_manager(ro_user)
        return ro_user.id, (director_user.id if director_user else None)

    def _resolve_direct_manager(self, user: User) -> Optional[User]:
        """
        Resolve a user's direct manager via ManagerOverride (preferred) or manager_object_id.

        Returns the manager User if found and active; None otherwise.
        Scoped to the current tenant. No live Graph calls.
        """
        tenant_id = self.current_user.tenant_id

        # ManagerOverride takes precedence over synced manager_object_id
        override = self.db.query(ManagerOverride).filter(
            and_(
                ManagerOverride.tenant_id == tenant_id,
                ManagerOverride.employee_object_id == user.object_id,
                ManagerOverride.is_active == True,
            )
        ).first()

        manager_object_id = override.manager_object_id if override else user.manager_object_id

        if not manager_object_id:
            return None

        manager = self.db.query(User).filter(
            and_(
                User.tenant_id == tenant_id,
                User.object_id == manager_object_id,
                User.is_active == True,
            )
        ).first()

        if not manager:
            logging.warning(
                "approval_routing: manager_object_id %s not found or inactive in tenant %s",
                manager_object_id, tenant_id,
            )
        return manager

    def _cc_fallback(self, resource: Resource) -> tuple[Optional[str], Optional[str]]:
        """Return (ro_user_id, director_user_id) from CostCenter fields as fallback."""
        if not resource.cost_center:
            return None, None
        return resource.cost_center.ro_user_id, resource.cost_center.director_user_id

    def _get_current_step(self, instance: ApprovalInstance) -> Optional[ApprovalStep]:
        """Get the first pending step in order."""
        for step in sorted(instance.steps, key=lambda s: s.step_order):
            if step.status == StepStatus.PENDING:
                return step
        return None

    def _can_user_action_step(self, user: User, step: ApprovalStep) -> bool:
        """Check if the user can act on the given step (direct or via delegation)."""
        if not step.approver_id:
            return False
        if step.approver_id == user.id:
            return True
        # Check active delegation grant
        return self.db.query(ApprovalDelegate).filter(
            and_(
                ApprovalDelegate.tenant_id == self.current_user.tenant_id,
                ApprovalDelegate.delegator_id == step.approver_id,
                ApprovalDelegate.delegate_id == user.id,
                ApprovalDelegate.is_active == True,
            )
        ).first() is not None

    def _get_delegation_info(self, user: User, step: ApprovalStep) -> tuple[bool, Optional[str]]:
        """
        Returns (is_delegated, delegated_for_display_name).
        True when user has access via delegation (not as the direct approver).
        """
        if not step.approver_id or step.approver_id == user.id:
            return False, None
        grant = self.db.query(ApprovalDelegate).filter(
            and_(
                ApprovalDelegate.tenant_id == self.current_user.tenant_id,
                ApprovalDelegate.delegator_id == step.approver_id,
                ApprovalDelegate.delegate_id == user.id,
                ApprovalDelegate.is_active == True,
            )
        ).first()
        if grant:
            delegator = self.db.query(User).filter(User.id == step.approver_id).first()
            return True, (delegator.display_name if delegator else None)
        return False, None

    def _build_step_audit_details(
        self,
        step: ApprovalStep,
        instance: ApprovalInstance,
        user: User,
        is_delegated: bool,
        delegated_for_name: Optional[str],
        approval_status: str,
        proxy_approver_name: Optional[str] = None,
    ) -> dict:
        """Build enriched audit context for an approval step action (write-time denormalization)."""
        ctx: dict = {
            "approval_instance_id": instance.id,
            "approval_step_id": step.id,
            "approval_step_order": step.step_order,
            "approval_step_label": f"Step {step.step_order}",
            "approval_step_name": step.step_name,
            "approval_status": approval_status,
            "actor_name": user.display_name,
            "actor_email": user.email,
            "acted_as_delegate": is_delegated,
        }
        if is_delegated and delegated_for_name:
            ctx["delegating_manager_name"] = delegated_for_name
        if proxy_approver_name:
            ctx["proxy_approver_name"] = proxy_approver_name

        if instance.subject_type == "actuals":
            actual = self.db.query(ActualLine).filter(
                ActualLine.id == instance.subject_id
            ).first()
            if actual:
                ctx["actual_line_id"] = actual.id
                ctx["year"] = actual.year
                ctx["month"] = actual.month
                ctx["actual_fte_percent"] = actual.actual_fte_percent
                ctx["planned_fte_percent"] = actual.planned_fte_percent

                resource = self.db.query(Resource).filter(
                    Resource.id == actual.resource_id
                ).first()
                if resource:
                    ctx["employee_name"] = resource.display_name
                    ctx["employee_email"] = resource.email
                    ctx["resource_id"] = resource.id
                    if resource.cost_center:
                        ctx["cost_center_name"] = resource.cost_center.name
                        ctx["cost_center_id"] = resource.cost_center_id

                project = self.db.query(Project).filter(
                    Project.id == actual.project_id
                ).first()
                if project:
                    ctx["project_name"] = project.name
                    ctx["project_id"] = project.id

        return ctx

