"""Approvals endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.models.actuals import ActualLine
from api.app.services.approvals import ApprovalsService

router = APIRouter(prefix="/approvals", tags=["Approvals"])


class ApprovalStepResponse(BaseModel):
    id: str
    step_order: int
    step_name: str
    approver_id: Optional[str]
    status: str
    actioned_at: Optional[str]
    actioned_by: Optional[str]
    comment: Optional[str]


class ApprovalInstanceResponse(BaseModel):
    id: str
    tenant_id: str
    subject_type: str
    subject_id: str
    status: str
    steps: list[ApprovalStepResponse]
    created_by: str
    created_at: str
    # Enriched for actuals: who the actual is for (employee/resource) and project/period
    resource_name: Optional[str] = None
    resource_id: Optional[str] = None
    project_name: Optional[str] = None
    project_id: Optional[str] = None
    period_label: Optional[str] = None


class ActionRequest(BaseModel):
    comment: Optional[str] = None


def _enrich_for_actuals(db: Session, instance) -> dict:
    """For subject_type actuals, load ActualLine with resource/project and return display fields."""
    if getattr(instance, "subject_type", None) != "actuals":
        return {}
    line = (
        db.query(ActualLine)
        .options(
            joinedload(ActualLine.resource),
            joinedload(ActualLine.project),
        )
        .filter(
            ActualLine.id == instance.subject_id,
            ActualLine.tenant_id == instance.tenant_id,
        )
        .first()
    )
    if not line:
        return {}
    return {
        "resource_name": line.resource.display_name if line.resource else None,
        "resource_id": line.resource_id,
        "project_name": line.project.name if line.project else None,
        "project_id": line.project_id,
        "period_label": f"{line.year}-{line.month:02d}" if line.year and line.month else None,
    }


def _to_response(instance, **enrichment) -> ApprovalInstanceResponse:
    return ApprovalInstanceResponse(
        id=instance.id,
        tenant_id=instance.tenant_id,
        subject_type=instance.subject_type,
        subject_id=instance.subject_id,
        status=instance.status.value,
        steps=[
            ApprovalStepResponse(
                id=s.id,
                step_order=s.step_order,
                step_name=s.step_name,
                approver_id=s.approver_id,
                status=s.status.value,
                actioned_at=str(s.actioned_at) if s.actioned_at else None,
                actioned_by=s.actioned_by,
                comment=s.comment,
            )
            for s in sorted(instance.steps, key=lambda x: x.step_order)
        ],
        created_by=instance.created_by,
        created_at=str(instance.created_at),
        **enrichment,
    )


@router.get("/inbox", response_model=list[ApprovalInstanceResponse])
async def get_inbox(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.RO, UserRole.DIRECTOR
    )),
):
    """
    Get approval instances awaiting current user's action.
    
    Accessible to: RO, Director
    """
    service = ApprovalsService(db, current_user)
    instances = service.get_inbox()
    return [_to_response(i, **_enrich_for_actuals(db, i)) for i in instances]


@router.get("/{instance_id}", response_model=ApprovalInstanceResponse)
async def get_approval(
    instance_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.RO, UserRole.DIRECTOR
    )),
):
    """Get a specific approval instance."""
    service = ApprovalsService(db, current_user)
    instance = service.get_by_id(instance_id)
    if not instance:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Approval not found"})
    return _to_response(instance, **_enrich_for_actuals(db, instance))


@router.post("/{instance_id}/steps/{step_id}/approve", response_model=ApprovalInstanceResponse)
async def approve_step(
    instance_id: str,
    step_id: str,
    data: ActionRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.RO, UserRole.DIRECTOR
    )),
):
    """
    Approve a step.
    
    Accessible to: RO, Director
    """
    service = ApprovalsService(db, current_user)
    instance = service.approve_step(instance_id, step_id, data.comment)
    return _to_response(instance, **_enrich_for_actuals(db, instance))


@router.post("/{instance_id}/steps/{step_id}/proxy-approve", response_model=ApprovalInstanceResponse)
async def proxy_approve_step(
    instance_id: str,
    step_id: str,
    data: ActionRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.RO, UserRole.DIRECTOR
    )),
):
    """
    Proxy-approve a Director step (e.g. when Director is unavailable).
    
    Requires a comment/explanation. The RO step must already be approved.
    
    Accessible to: RO, Director
    """
    from fastapi import HTTPException
    if not data.comment or not data.comment.strip():
        raise HTTPException(
            status_code=400,
            detail={"code": "VALIDATION_ERROR", "message": "Comment is required for proxy-approve"}
        )
    service = ApprovalsService(db, current_user)
    instance = service.approve_step(instance_id, step_id, f"[PROXY-APPROVE] {data.comment}")
    return _to_response(instance, **_enrich_for_actuals(db, instance))


@router.post("/{instance_id}/steps/{step_id}/reject", response_model=ApprovalInstanceResponse)
async def reject_step(
    instance_id: str,
    step_id: str,
    data: ActionRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.RO, UserRole.DIRECTOR
    )),
):
    """
    Reject a step.
    
    Accessible to: RO, Director
    """
    service = ApprovalsService(db, current_user)
    instance = service.reject_step(instance_id, step_id, data.comment)
    return _to_response(instance, **_enrich_for_actuals(db, instance))
