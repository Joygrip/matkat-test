"""Audit log API endpoints."""
from datetime import datetime, date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from api.app.auth.dependencies import require_roles, CurrentUser
from api.app.db.engine import get_db
from api.app.models.audit import AuditLog
from api.app.models.core import UserRole

router = APIRouter(prefix="/audit-logs", tags=["Audit"])

_DEFAULT_LIMIT = 50
_MAX_LIMIT = 100


def _parse_date_param(val: str) -> Optional[datetime]:
    """Parse ISO date or datetime string, returns naive datetime (UTC assumed)."""
    clean = val.strip().replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(clean, fmt)
        except ValueError:
            continue
    return None


@router.get("/")
def list_audit_logs(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
    limit: int = Query(_DEFAULT_LIMIT, ge=1, le=_MAX_LIMIT),
    offset: int = Query(0, ge=0),
    action: Optional[str] = Query(None),
    entity_type: Optional[str] = Query(None),
    actor: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    from_date: Optional[str] = Query(None),
    to_date: Optional[str] = Query(None),
):
    """List audit logs (Admin/Finance only). Tenant-scoped with server-side filters and pagination."""
    query = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == current_user.tenant_id)
    )

    if action:
        query = query.filter(AuditLog.action == action)
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    if actor:
        query = query.filter(AuditLog.user_email.ilike(f"%{actor}%"))
    if from_date:
        dt = _parse_date_param(from_date)
        if dt:
            query = query.filter(AuditLog.created_at >= dt)
    if to_date:
        dt = _parse_date_param(to_date)
        if dt:
            # to_date is inclusive: treat a date-only value as end-of-day
            if len(to_date.strip()) == 10:
                dt = dt.replace(hour=23, minute=59, second=59)
            query = query.filter(AuditLog.created_at <= dt)
    if q:
        like = f"%{q}%"
        query = query.filter(
            or_(
                AuditLog.user_email.ilike(like),
                AuditLog.action.ilike(like),
                AuditLog.entity_type.ilike(like),
                AuditLog.entity_id.ilike(like),
                AuditLog.reason.ilike(like),
            )
        )

    # Fetch one extra row to determine has_more without a COUNT query
    rows = (
        query
        .order_by(AuditLog.created_at.desc())
        .offset(offset)
        .limit(limit + 1)
        .all()
    )

    has_more = len(rows) > limit
    rows = rows[:limit]

    return {
        "items": [
            {
                "id": log.id,
                "timestamp": log.created_at.isoformat() + "Z",
                "user_email": log.user_email,
                "action": log.action,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "old_values": log.old_values,
                "new_values": log.new_values,
                "reason": log.reason,
                "ip_address": log.ip_address,
                "details": log.details,
            }
            for log in rows
        ],
        "has_more": has_more,
    }
