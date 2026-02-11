"""Development-only endpoints. Disabled in production."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from api.app.config import get_settings
from api.app.db.engine import get_db
from api.app.models.core import (
    User, Department, CostCenter, Project, Resource, Period, Placeholder,
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
    from api.app.models.core import Department, CostCenter, User, Project, Resource, Placeholder, Period, UserRole, PeriodStatus
    # Check if already seeded
    existing_dept = db.query(Department).filter(Department.tenant_id == tenant_id).first()
    if existing_dept:
        return f"Database already seeded for tenant {tenant_id}"
    # Create departments
    dept_engineering = Department(
        tenant_id=tenant_id,
        code="ENG",
        name="Engineering",
    )
    dept_operations = Department(
        tenant_id=tenant_id,
        code="OPS",
        name="Operations",
    )
    db.add_all([dept_engineering, dept_operations])
    db.flush()
    # Create cost centers
    cc_software = CostCenter(
        tenant_id=tenant_id,
        department_id=dept_engineering.id,
        code="CC-SW",
        name="Software Development",
    )
    cc_infra = CostCenter(
        tenant_id=tenant_id,
        department_id=dept_operations.id,
        code="CC-INFRA",
        name="Infrastructure",
    )
    db.add_all([cc_software, cc_infra])
    db.flush()
    # Create users with different roles
    users = [
        User(
            tenant_id=tenant_id,
            object_id="admin-001",
            email="admin@example.com",
            display_name="Admin User",
            role=UserRole.ADMIN,
        ),
        User(
            tenant_id=tenant_id,
            object_id="finance-001",
            email="finance@example.com",
            display_name="Finance User",
            role=UserRole.FINANCE,
        ),
        User(
            tenant_id=tenant_id,
            object_id="pm-001",
            email="pm@example.com",
            display_name="Project Manager",
            role=UserRole.PM,
        ),
        User(
            tenant_id=tenant_id,
            object_id="ro-001",
            email="ro@example.com",
            display_name="Resource Owner",
            role=UserRole.RO,
            cost_center_id=cc_software.id,
        ),
        User(
            tenant_id=tenant_id,
            object_id="director-001",
            email="director@example.com",
            display_name="Director",
            role=UserRole.DIRECTOR,
            department_id=dept_engineering.id,
        ),
        User(
            tenant_id=tenant_id,
            object_id="employee-001",
            email="employee@example.com",
            display_name="Employee User",
            role=UserRole.EMPLOYEE,
            cost_center_id=cc_software.id,
        ),
    ]
    # Set manager relationships
    users[5].manager_object_id = users[3].object_id  # Employee reports to RO
    users[3].manager_object_id = users[4].object_id  # RO reports to Director
    db.add_all(users)
    db.flush()
    # Update cost center RO
    cc_software.ro_user_id = users[3].id
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
            is_external=True,
        ),
    ]
    db.add_all(resources)
    # Create placeholders (with department/cost center context)
    placeholders = [
        Placeholder(
            tenant_id=tenant_id,
            name="Senior Developer TBH",
            description="Senior developer to be hired",
            skill_profile="Senior Full-Stack",
            department_id=dept_engineering.id,
            cost_center_id=cc_software.id,
        ),
        Placeholder(
            tenant_id=tenant_id,
            name="Junior Developer TBH",
            description="Junior developer to be hired",
            skill_profile="Junior Backend",
            department_id=dept_engineering.id,
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
