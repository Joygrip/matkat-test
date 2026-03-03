"""Development-only endpoints. Disabled in production."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.app.config import get_settings
from api.app.db.engine import get_db
from api.app.models.core import (
    User, CostCenter, Project, Resource, ResourceType, Period, Placeholder,
    UserRole, PeriodStatus,
)
from api.app.schemas.common import MessageResponse
from api.app.auth.dependencies import get_current_user, CurrentUser

router = APIRouter(prefix="/dev", tags=["Development"])


def require_dev_mode():
    """Dependency that ensures dev mode is enabled."""
    settings = get_settings()
    if not settings.is_dev or not settings.dev_auth_bypass:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Not found",
        )


def seed_database_for_tenant(db: Session, tenant_id: str) -> str:
    """
    Seed database with sample data for development for a given tenant_id.
    Returns a message indicating result.
    """
    from api.app.models.core import CostCenter, User, Project, Resource, Placeholder, Period, UserRole, PeriodStatus
    existing_cc = db.query(CostCenter).filter(CostCenter.tenant_id == tenant_id).first()
    if existing_cc:
        return f"Database already seeded for tenant {tenant_id}"
    cc_software = CostCenter(
        tenant_id=tenant_id,
        code="CC-SW",
        name="Software Development",
    )
    cc_infra = CostCenter(
        tenant_id=tenant_id,
        code="CC-INFRA",
        name="Infrastructure",
    )
    db.add_all([cc_software, cc_infra])
    db.flush()
    users = [
        User(tenant_id=tenant_id, object_id="admin-001", email="admin@example.com", display_name="Admin User", role=UserRole.ADMIN),
        User(tenant_id=tenant_id, object_id="finance-001", email="finance@example.com", display_name="Finance User", role=UserRole.FINANCE),
        User(tenant_id=tenant_id, object_id="pm-001", email="pm@example.com", display_name="Project Manager", role=UserRole.PM),
        User(tenant_id=tenant_id, object_id="ro-001", email="ro@example.com", display_name="Resource Owner", role=UserRole.RO, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="director-001", email="director@example.com", display_name="Director", role=UserRole.DIRECTOR, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="employee-001", email="employee@example.com", display_name="Employee User", role=UserRole.EMPLOYEE, cost_center_id=cc_software.id),
    ]
    users[5].manager_object_id = users[3].object_id
    users[3].manager_object_id = users[4].object_id
    db.add_all(users)
    db.flush()
    cc_software.ro_user_id = users[3].id
    cc_software.director_user_id = users[4].id
    # Create projects
    projects = [
        Project(
            tenant_id=tenant_id,
            code="PRJ-001",
            name="Project Alpha",
            pm_user_id=users[2].id,
            cost_center_id=cc_software.id,
        ),
        Project(
            tenant_id=tenant_id,
            code="PRJ-002",
            name="Project Beta",
            pm_user_id=users[2].id,
            cost_center_id=cc_software.id,
        ),
    ]
    db.add_all(projects)
    # Create resources
    resources = [
        Resource(
            tenant_id=tenant_id,
            user_id=users[5].id,
            cost_center_id=cc_software.id,
            employee_id="EMP-001",
            display_name="Employee User",
            email="employee@example.com",
        ),
        Resource(
            tenant_id=tenant_id,
            cost_center_id=cc_software.id,
            employee_id="EMP-002",
            display_name="John Developer",
            email="john@example.com",
        ),
        Resource(
            tenant_id=tenant_id,
            cost_center_id=cc_software.id,
            employee_id="EXT-001",
            display_name="External Contractor",
            resource_type=ResourceType.EXTERNAL,
        ),
    ]
    db.add_all(resources)
    # One placeholder per cost center
    placeholders = [
        Placeholder(
            tenant_id=tenant_id,
            cost_center_id=cc_software.id,
            name="Placeholder: Software Development",
            description="Senior developer to be hired",
            skill_profile="Senior Full-Stack",
        ),
    ]
    db.add_all(placeholders)
    # Create current period (open)
    now = datetime.now(timezone.utc)
    current_period = Period(
        tenant_id=tenant_id,
        year=now.year,
        month=now.month,
        status=PeriodStatus.OPEN,
    )
    db.add(current_period)
    # Create next month period (open)
    next_month = now.month + 1 if now.month < 12 else 1
    next_year = now.year if now.month < 12 else now.year + 1
    next_period = Period(
        tenant_id=tenant_id,
        year=next_year,
        month=next_month,
        status=PeriodStatus.OPEN,
    )
    db.add(next_period)
    db.commit()
    return f"Seeded database with sample data for tenant {tenant_id}"


@router.post("/seed", response_model=MessageResponse, dependencies=[Depends(require_dev_mode)])
async def seed_database(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    Seed database with sample data for development.
    Only available when DEV_AUTH_BYPASS=true.
    """
    tenant_id = current_user.tenant_id
    msg = seed_database_for_tenant(db, tenant_id)
    return MessageResponse(message=msg)


@router.get("/config", dependencies=[Depends(require_dev_mode)])
async def get_dev_config():
    """Get current dev configuration."""
    settings = get_settings()
    return {
        "env": settings.env,
        "dev_auth_bypass": settings.dev_auth_bypass,
        "database_url": settings.database_url.split("@")[-1] if "@" in settings.database_url else settings.database_url,
    }


@router.get("/resources-with-users", dependencies=[Depends(require_dev_mode)])
async def get_resources_with_users(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List resources with linked user info for Dev Login dropdown.
    Returns resource_id, display_name, employee_id, email, user_object_id, user_id.
    """
    rows = (
        db.query(Resource, User)
        .outerjoin(User, Resource.user_id == User.id)
        .filter(Resource.tenant_id == current_user.tenant_id, Resource.is_active == True)
        .order_by(Resource.display_name)
        .all()
    )
    result = []
    for resource, user in rows:
        result.append({
            "resource_id": resource.id,
            "display_name": resource.display_name or "",
            "employee_id": resource.employee_id or "",
            "email": resource.email if resource.email is not None else (user.email if user else None),
            "user_object_id": user.object_id if user else None,
            "user_id": str(user.id) if user else None,
        })
    return result
