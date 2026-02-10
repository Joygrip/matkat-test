"""Audit logging service."""
import json
from typing import Optional, Any
from sqlalchemy.orm import Session

from api.app.models.core import AuditLog
from api.app.auth.dependencies import CurrentUser


def log_audit(
    db: Session,
    current_user: CurrentUser,
    action: str,
    entity_type: str,
    entity_id: Optional[str] = None,
    old_values: Optional[dict[str, Any]] = None,
    new_values: Optional[dict[str, Any]] = None,
    reason: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> AuditLog:
    """
    Create an audit log entry.
    
    Args:
        db: Database session
        current_user: Current authenticated user
        action: Action performed (create, update, delete, lock, unlock, sign, approve, etc.)
        entity_type: Type of entity being audited
        entity_id: ID of the entity
        old_values: Previous values (for updates)
        new_values: New values (for creates/updates)
        reason: Reason for the action (required for some actions)
        ip_address: Client IP address
    """
    audit = AuditLog(
        tenant_id=current_user.tenant_id,
        user_id=current_user.object_id,
        user_email=current_user.email,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        old_values=json.dumps(old_values) if old_values else None,
        new_values=json.dumps(new_values) if new_values else None,
        reason=reason,
        ip_address=ip_address,
    )
    db.add(audit)
    db.commit()
    db.refresh(audit)
    return audit


def get_entity_diff(old_obj: Any, new_data: dict[str, Any]) -> tuple[dict, dict]:
    """
    Calculate diff between old object and new data.
    
    Returns:
        Tuple of (old_values, new_values) dicts containing only changed fields.
    """
    old_values = {}
    new_values = {}
    
    for key, new_val in new_data.items():
        if hasattr(old_obj, key):
            old_val = getattr(old_obj, key)
            if old_val != new_val:
                old_values[key] = old_val
                new_values[key] = new_val
    
    return old_values, new_values
