"""Approvals endpoints."""
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
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


class ActionRequest(BaseModel):
    comment: Optional[str] = None


def _to_response(instance) -> ApprovalInstanceResponse:
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
    return [_to_response(i) for i in instances]


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
    return _to_response(instance)


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
    return _to_response(instance)


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
    return _to_response(instance)
