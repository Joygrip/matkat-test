"""Audit log API endpoints."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.db.engine import get_db
from api.app.models.audit import AuditLog
from api.app.models.core import UserRole
from typing import List

router = APIRouter(prefix="/audit-logs", tags=["Audit"])

@router.get("/", response_model=List[dict])
def list_audit_logs(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """List audit logs (Admin/Finance only). Tenant-scoped."""
    logs = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == current_user.tenant_id)
        .order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return [
        {
            "timestamp": log.created_at,
            "user_email": log.user_email,
            "action": log.action,
            "entity_type": log.entity_type,
            "entity_id": log.entity_id,
            "old_values": log.old_values,
            "new_values": log.new_values,
            "reason": log.reason,
            "ip_address": log.ip_address,
        }
        for log in logs
    ]
