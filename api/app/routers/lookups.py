"""Lookup endpoints for read-only master data access by all roles."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from sqlalchemy import exists as sa_exists
from api.app.models.core import (
    CostCenter, Project, ProjectPM, Resource, Placeholder, User, UserRole
)

_SCOPED_ROLES = (UserRole.MANAGER,)
from api.app.schemas.admin import (
    CostCenterResponse, ProjectResponse,
    ResourceResponse, PlaceholderResponse,
)

router = APIRouter(prefix="/lookups", tags=["Lookups"])


def _enrich_project(project: Project) -> dict:
    return {
        "id": project.id,
        "tenant_id": project.tenant_id,
        "code": project.code,
        "name": project.name,
        "pm_user_ids": [u.id for u in project.pm_users],
        "cost_center_id": project.cost_center_id,
        "start_date": project.start_date,
        "end_date": project.end_date,
        "is_active": project.is_active,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


def _enrich_placeholder(placeholder: Placeholder) -> dict:
    """Enrich a placeholder ORM object with cost-center name."""
    return {
        "id": placeholder.id,
        "tenant_id": placeholder.tenant_id,
        "name": placeholder.name,
        "cost_center_id": placeholder.cost_center_id,
        "description": placeholder.description,
        "skill_profile": placeholder.skill_profile,
        "estimated_cost": placeholder.estimated_cost,
        "is_active": placeholder.is_active,
        "created_at": placeholder.created_at,
        "updated_at": placeholder.updated_at,
        "cost_center_name": placeholder.cost_center.name if placeholder.cost_center else None,
    }


@router.get("/cost-centers", response_model=list[CostCenterResponse])
async def list_cost_centers(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active cost centers.
    Accessible to all roles (read-only).
    """
    return db.query(CostCenter).filter(
        and_(
            CostCenter.tenant_id == current_user.tenant_id,
            CostCenter.is_active == True,
        )
    ).order_by(CostCenter.name).all()


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all projects for the tenant (active and inactive).
    Accessible to all roles (read-only).
    """
    projects = db.query(Project).filter(
        Project.tenant_id == current_user.tenant_id
    ).order_by(Project.name).all()
    return [_enrich_project(p) for p in projects]


@router.get("/resources", response_model=list[ResourceResponse])
async def list_resources(
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active resources, optionally filtered by cost center.
    Accessible to all roles (read-only).
    """
    query = db.query(Resource).filter(
        and_(
            Resource.tenant_id == current_user.tenant_id,
            Resource.is_active == True,
        )
    )
    if cost_center_id:
        query = query.filter(Resource.cost_center_id == cost_center_id)
    return query.order_by(Resource.display_name).all()


@router.get("/placeholders", response_model=list[PlaceholderResponse])
async def list_placeholders(
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active placeholders, optionally filtered by cost center.
    Accessible to all roles (read-only).
    """
    query = db.query(Placeholder).filter(
        and_(
            Placeholder.tenant_id == current_user.tenant_id,
            Placeholder.is_active == True,
        )
    )
    if cost_center_id:
        query = query.filter(Placeholder.cost_center_id == cost_center_id)
    placeholders = query.order_by(Placeholder.name).all()
    return [_enrich_placeholder(p) for p in placeholders]


@router.get("/projects/scoped", response_model=list[ProjectResponse])
async def list_projects_scoped(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.PM, UserRole.FINANCE)),
):
    """
    Projects scoped to the current user:
    - PM: only projects where this user is explicitly an assigned PM
    - Admin/Finance: all projects (same as /lookups/projects)
    """
    query = db.query(Project).filter(Project.tenant_id == current_user.tenant_id)
    if current_user.role == UserRole.PM:
        pm_user = db.query(User).filter(
            and_(
                User.tenant_id == current_user.tenant_id,
                User.object_id == current_user.object_id,
            )
        ).first()
        if pm_user:
            query = query.filter(
                sa_exists().where(
                    and_(
                        ProjectPM.project_id == Project.id,
                        ProjectPM.user_id == pm_user.id,
                    )
                )
            )
        else:
            query = query.filter(False)
    projects = query.order_by(Project.name).all()
    return [_enrich_project(p) for p in projects]


@router.get("/resources/scoped", response_model=list[ResourceResponse])
async def list_resources_scoped(
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER)),
):
    """
    Resources scoped to the current user's reporting line:
    - RO/Director: only resources in their org hierarchy
    - Admin/Finance: all active resources
    """
    query = db.query(Resource).filter(
        and_(
            Resource.tenant_id == current_user.tenant_id,
            Resource.is_active == True,
        )
    )
    if cost_center_id:
        query = query.filter(Resource.cost_center_id == cost_center_id)
    if current_user.role in _SCOPED_ROLES and not current_user.is_manager_reader:
        from api.app.services.reporting import ReportingService
        scoped_ids = list(ReportingService(db, current_user).get_accessible_resource_ids())
        # Also include the manager's own resource so they can enter their own actuals
        mgr_user = db.query(User).filter(
            and_(User.tenant_id == current_user.tenant_id, User.object_id == current_user.object_id)
        ).first()
        if mgr_user:
            own_resource = db.query(Resource).filter(
                and_(
                    Resource.tenant_id == current_user.tenant_id,
                    Resource.user_id == mgr_user.id,
                    Resource.is_active == True,
                )
            ).first()
            if own_resource and own_resource.id not in scoped_ids:
                scoped_ids.append(own_resource.id)
        query = query.filter(Resource.id.in_(scoped_ids))
    return query.order_by(Resource.display_name).all()


@router.get("/users")
async def list_users(
    role: Optional[str] = Query(None, description="Filter by role (e.g. PM, Finance, Admin)"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER)),
):
    """
    List active users, optionally filtered by role.
    Accessible to Admin, Finance, and Manager (Manager uses this for delegate picker).
    """
    query = db.query(User).filter(
        and_(
            User.tenant_id == current_user.tenant_id,
            User.is_active == True,
        )
    )
    if role:
        query = query.filter(User.role == role)
    users = query.order_by(User.display_name).all()
    cc_ids = {u.cost_center_id for u in users if u.cost_center_id}
    cc_name_map: dict[str, str] = {}
    if cc_ids:
        for cc in db.query(CostCenter.id, CostCenter.name).filter(CostCenter.id.in_(cc_ids)).all():
            cc_name_map[cc.id] = cc.name
    return [
        {
            "id": u.id,
            "display_name": u.display_name,
            "email": u.email,
            "role": u.role,
            "cost_center_name": cc_name_map.get(u.cost_center_id) if u.cost_center_id else None,
        }
        for u in users
    ]
