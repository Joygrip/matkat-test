"""Lookup endpoints for read-only master data access by all roles."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from sqlalchemy import exists as sa_exists
from api.app.models.core import (
    CostCenter, Project, ProjectPM, Resource, Placeholder, User, UserRole
)
from api.app.config import get_settings
from api.app.schemas.admin import (
    CostCenterResponse, ProjectResponse,
    ResourceResponse, PlaceholderResponse,
)

_SCOPED_ROLES = (UserRole.MANAGER,)


def _apply_country_exclusion(query, excluded_countries: list[str]):
    """Exclude resources whose linked user.country is in the excluded list (case-insensitive)."""
    if not excluded_countries:
        return query
    excluded_upper = [c.upper() for c in excluded_countries]
    return (
        query
        .outerjoin(User, Resource.user_id == User.id)
        .filter(
            or_(
                Resource.user_id == None,
                User.country == None,
                func.upper(User.country).notin_(excluded_upper),
            )
        )
    )


def _apply_planning_exclusions(query, excluded_countries: list[str], excluded_prefixes: list[str]):
    """Apply both country and email-prefix exclusion filters with a single User join."""
    if not excluded_countries and not excluded_prefixes:
        return query
    query = query.outerjoin(User, Resource.user_id == User.id)
    if excluded_countries:
        excluded_upper = [c.upper() for c in excluded_countries]
        query = query.filter(
            or_(
                Resource.user_id == None,
                User.country == None,
                func.upper(User.country).notin_(excluded_upper),
            )
        )
    if excluded_prefixes:
        prefix_conditions = [func.lower(User.email).startswith(p) for p in excluded_prefixes]
        query = query.filter(
            or_(
                Resource.user_id == None,
                User.email == None,
                ~or_(*prefix_conditions),
            )
        )
    return query

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
    settings = get_settings()
    query = _apply_planning_exclusions(query, settings.planning_excluded_countries_list, settings.planning_excluded_email_prefixes_list)
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
    for_write: bool = Query(False, description="When true, Manager+Reader is scoped identically to a plain Manager (write-intent pickers)"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER)),
):
    """
    Resources scoped to the current user's reporting line:
    - Manager: only resources in their CC hierarchy + delegations
    - Manager+Reader, for_write=False: all active resources (read-expanded)
    - Manager+Reader, for_write=True: scoped identically to plain Manager (write intent)
    - Admin/Finance: all active resources regardless of for_write
    """
    query = db.query(Resource).filter(
        and_(
            Resource.tenant_id == current_user.tenant_id,
            Resource.is_active == True,
        )
    )
    if cost_center_id:
        query = query.filter(Resource.cost_center_id == cost_center_id)
    settings = get_settings()
    query = _apply_planning_exclusions(query, settings.planning_excluded_countries_list, settings.planning_excluded_email_prefixes_list)
    # Apply scope when: user is a Manager AND (for_write=True OR not is_manager_reader).
    # for_write=True overrides the Manager+Reader read-expansion so write pickers stay correctly scoped.
    if current_user.role in _SCOPED_ROLES and (for_write or not current_user.is_manager_reader):
        from api.app.services.reporting import ReportingService
        _rs = ReportingService(db, current_user)
        scoped_ids = list(_rs.get_accessible_resource_ids())
        _cur_user = db.query(User).filter(
            User.tenant_id == current_user.tenant_id,
            User.object_id == current_user.object_id,
        ).first()
        if _cur_user:
            for _rid in _rs.get_delegated_resource_ids(_cur_user.id):
                if _rid not in scoped_ids:
                    scoped_ids.append(_rid)
        # Also include the manager's own resource so they can enter their own actuals
        mgr_user = _cur_user
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
    user_ids = [u.id for u in users]
    initials_map: dict[str, str] = {}
    if user_ids:
        for r in db.query(Resource.user_id, Resource.initials).filter(
            Resource.user_id.in_(user_ids),
            Resource.is_active == True,
        ).all():
            if r.user_id and r.initials:
                initials_map[r.user_id] = r.initials
    return [
        {
            "id": u.id,
            "display_name": u.display_name,
            "email": u.email,
            "role": u.role,
            "cost_center_name": cc_name_map.get(u.cost_center_id) if u.cost_center_id else None,
            "initials": initials_map.get(u.id),
        }
        for u in users
    ]
