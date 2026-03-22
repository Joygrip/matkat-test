"""Admin CRUD endpoints for master data."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_
from typing import Optional

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.config import get_settings
from api.app.models.core import (
    UserRole, CostCenter, Project, Resource, Placeholder, Holiday, Settings
)
from api.app.schemas.admin import (
    CostCenterCreate, CostCenterUpdate, CostCenterResponse,
    ProjectCreate, ProjectUpdate, ProjectResponse,
    ResourceCreate, ResourceUpdate, ResourceResponse,
    PlaceholderCreate, PlaceholderUpdate, PlaceholderResponse,
    HolidayCreate, HolidayResponse,
    SettingsCreate, SettingsUpdate, SettingsResponse,
)
from api.app.services.audit import log_audit
from api.app.services.background_sync import run_graph_sync

router = APIRouter(prefix="/admin", tags=["Admin"])

# Allowed roles for read access (master data)
READ_ROLES = (UserRole.ADMIN, UserRole.FINANCE)
# Allowed roles for read access to planning-related data (projects, resources, placeholders)
PLANNING_READ_ROLES = (UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.RO)
# Allowed roles for write access
WRITE_ROLES = (UserRole.ADMIN,)
# Allowed roles for master data write access (Admin + Finance)
MASTER_DATA_WRITE_ROLES = (UserRole.ADMIN, UserRole.FINANCE)


# ============== COST CENTERS ==============

@router.get("/cost-centers", response_model=list[CostCenterResponse])
async def list_cost_centers(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*READ_ROLES)),
):
    """List all cost centers."""
    return db.query(CostCenter).filter(
        CostCenter.tenant_id == current_user.tenant_id
    ).all()


@router.get("/cost-centers/{cost_center_id}", response_model=CostCenterResponse)
async def get_cost_center(
    cost_center_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*READ_ROLES)),
):
    """Get a cost center by ID."""
    cc = db.query(CostCenter).filter(
        and_(CostCenter.id == cost_center_id, CostCenter.tenant_id == current_user.tenant_id)
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Cost center not found"})
    return cc


@router.post("/cost-centers", response_model=CostCenterResponse)
async def create_cost_center(
    data: CostCenterCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Create a new cost center. (Admin, Finance) Auto-creates one placeholder per cost center."""
    cc = CostCenter(tenant_id=current_user.tenant_id, **data.model_dump())
    db.add(cc)
    db.flush()
    # One placeholder per cost center
    placeholder = Placeholder(
        tenant_id=current_user.tenant_id,
        cost_center_id=cc.id,
        name=f"Placeholder: {cc.name}",
    )
    db.add(placeholder)
    db.commit()
    db.refresh(cc)
    log_audit(db, current_user, "create", "CostCenter", cc.id, new_values=data.model_dump())
    return cc


@router.patch("/cost-centers/{cost_center_id}", response_model=CostCenterResponse)
async def update_cost_center(
    cost_center_id: str,
    data: CostCenterUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Update a cost center. (Admin, Finance)"""
    cc = db.query(CostCenter).filter(
        and_(CostCenter.id == cost_center_id, CostCenter.tenant_id == current_user.tenant_id)
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Cost center not found"})
    
    update_data = data.model_dump(exclude_unset=True)
    old_values = {k: getattr(cc, k) for k in update_data}
    
    for key, value in update_data.items():
        setattr(cc, key, value)
    
    db.commit()
    db.refresh(cc)
    log_audit(db, current_user, "update", "CostCenter", cc.id, old_values=old_values, new_values=update_data)
    return cc


@router.delete("/cost-centers/{cost_center_id}")
async def delete_cost_center(
    cost_center_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Soft delete a cost center. (Admin, Finance)"""
    cc = db.query(CostCenter).filter(
        and_(CostCenter.id == cost_center_id, CostCenter.tenant_id == current_user.tenant_id)
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Cost center not found"})
    
    cc.is_active = False
    # Soft-deactivate the cost center's placeholder
    for ph in db.query(Placeholder).filter(
        and_(
            Placeholder.cost_center_id == cost_center_id,
            Placeholder.tenant_id == current_user.tenant_id,
        )
    ).all():
        ph.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "CostCenter", cc.id)
    return {"message": "Cost center deleted"}


# ============== PROJECTS ==============

@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*PLANNING_READ_ROLES)),
):
    """List all projects. Accessible to Admin, Finance, PM, RO."""
    return db.query(Project).filter(
        Project.tenant_id == current_user.tenant_id
    ).all()


@router.get("/projects/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*PLANNING_READ_ROLES)),
):
    """Get a project by ID. Accessible to Admin, Finance, PM, RO."""
    project = db.query(Project).filter(
        and_(Project.id == project_id, Project.tenant_id == current_user.tenant_id)
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Project not found"})
    return project


@router.post("/projects", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Create a new project. (Admin, Finance)"""
    project = Project(tenant_id=current_user.tenant_id, **data.model_dump())
    db.add(project)
    db.commit()
    db.refresh(project)
    log_audit(db, current_user, "create", "Project", project.id, new_values=data.model_dump())
    return project


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Update a project. (Admin, Finance)"""
    project = db.query(Project).filter(
        and_(Project.id == project_id, Project.tenant_id == current_user.tenant_id)
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Project not found"})
    
    update_data = data.model_dump(exclude_unset=True)
    old_values = {k: getattr(project, k) for k in update_data}
    
    for key, value in update_data.items():
        setattr(project, key, value)
    
    db.commit()
    db.refresh(project)
    log_audit(db, current_user, "update", "Project", project.id, old_values=old_values, new_values=update_data)
    return project


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Soft delete a project. (Admin, Finance)"""
    project = db.query(Project).filter(
        and_(Project.id == project_id, Project.tenant_id == current_user.tenant_id)
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Project not found"})
    
    project.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "Project", project.id)
    return {"message": "Project deleted"}


# ============== RESOURCES ==============

@router.get("/resources", response_model=list[ResourceResponse])
async def list_resources(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*PLANNING_READ_ROLES)),
):
    """List all resources. Accessible to Admin, Finance, PM, RO."""
    return db.query(Resource).filter(
        Resource.tenant_id == current_user.tenant_id
    ).all()


@router.get("/resources/{resource_id}", response_model=ResourceResponse)
async def get_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*PLANNING_READ_ROLES)),
):
    """Get a resource by ID. Accessible to Admin, Finance, PM, RO."""
    resource = db.query(Resource).filter(
        and_(Resource.id == resource_id, Resource.tenant_id == current_user.tenant_id)
    ).first()
    if not resource:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resource not found"})
    return resource


@router.post("/resources", response_model=ResourceResponse)
async def create_resource(
    data: ResourceCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Create a new resource. (Admin, Finance)"""
    resource = Resource(tenant_id=current_user.tenant_id, **data.model_dump())
    db.add(resource)
    db.commit()
    db.refresh(resource)
    log_audit(db, current_user, "create", "Resource", resource.id, new_values=data.model_dump())
    return resource


@router.patch("/resources/{resource_id}", response_model=ResourceResponse)
async def update_resource(
    resource_id: str,
    data: ResourceUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Update a resource. (Admin, Finance)"""
    resource = db.query(Resource).filter(
        and_(Resource.id == resource_id, Resource.tenant_id == current_user.tenant_id)
    ).first()
    if not resource:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resource not found"})
    
    update_data = data.model_dump(exclude_unset=True)
    old_values = {k: getattr(resource, k) for k in update_data}
    
    for key, value in update_data.items():
        setattr(resource, key, value)
    
    db.commit()
    db.refresh(resource)
    log_audit(db, current_user, "update", "Resource", resource.id, old_values=old_values, new_values=update_data)
    return resource


@router.delete("/resources/{resource_id}")
async def delete_resource(
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Soft delete a resource. (Admin, Finance)"""
    resource = db.query(Resource).filter(
        and_(Resource.id == resource_id, Resource.tenant_id == current_user.tenant_id)
    ).first()
    if not resource:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resource not found"})
    
    resource.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "Resource", resource.id)
    return {"message": "Resource deleted"}


# ============== PLACEHOLDERS ==============

def _enrich_placeholder(placeholder: Placeholder) -> dict:
    """Enrich a placeholder ORM object with cost-center name."""
    data = {
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
    return data


@router.get("/placeholders", response_model=list[PlaceholderResponse])
async def list_placeholders(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*PLANNING_READ_ROLES)),
):
    """List all placeholders. Accessible to Admin, Finance, PM, RO."""
    placeholders = db.query(Placeholder).filter(
        Placeholder.tenant_id == current_user.tenant_id
    ).all()
    return [_enrich_placeholder(p) for p in placeholders]


@router.get("/placeholders/{placeholder_id}", response_model=PlaceholderResponse)
async def get_placeholder(
    placeholder_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*PLANNING_READ_ROLES)),
):
    """Get a placeholder by ID. Accessible to Admin, Finance, PM, RO."""
    placeholder = db.query(Placeholder).filter(
        and_(Placeholder.id == placeholder_id, Placeholder.tenant_id == current_user.tenant_id)
    ).first()
    if not placeholder:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Placeholder not found"})
    return _enrich_placeholder(placeholder)


@router.post("/placeholders", response_model=PlaceholderResponse)
async def create_placeholder(
    data: PlaceholderCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Create a new placeholder for a cost center. (Admin, Finance) One per cost center."""
    existing = db.query(Placeholder).filter(
        and_(
            Placeholder.tenant_id == current_user.tenant_id,
            Placeholder.cost_center_id == data.cost_center_id,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"code": "PLACEHOLDER_EXISTS", "message": "This cost center already has a placeholder."},
        )
    dump = data.model_dump(exclude_unset=True)
    name = dump.pop("name", None) or "Placeholder"
    placeholder = Placeholder(
        tenant_id=current_user.tenant_id,
        cost_center_id=data.cost_center_id,
        name=name,
        description=dump.get("description"),
        skill_profile=dump.get("skill_profile"),
        estimated_cost=dump.get("estimated_cost"),
    )
    db.add(placeholder)
    db.commit()
    db.refresh(placeholder)
    log_audit(db, current_user, "create", "Placeholder", placeholder.id, new_values=data.model_dump())
    return _enrich_placeholder(placeholder)


@router.patch("/placeholders/{placeholder_id}", response_model=PlaceholderResponse)
async def update_placeholder(
    placeholder_id: str,
    data: PlaceholderUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Update a placeholder. (Admin, Finance)"""
    placeholder = db.query(Placeholder).filter(
        and_(Placeholder.id == placeholder_id, Placeholder.tenant_id == current_user.tenant_id)
    ).first()
    if not placeholder:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Placeholder not found"})
    
    update_data = data.model_dump(exclude_unset=True)
    old_values = {k: getattr(placeholder, k) for k in update_data}
    
    for key, value in update_data.items():
        setattr(placeholder, key, value)
    
    db.commit()
    db.refresh(placeholder)
    log_audit(db, current_user, "update", "Placeholder", placeholder.id, old_values=old_values, new_values=update_data)
    return _enrich_placeholder(placeholder)


@router.delete("/placeholders/{placeholder_id}")
async def delete_placeholder(
    placeholder_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Soft delete a placeholder. (Admin, Finance)"""
    placeholder = db.query(Placeholder).filter(
        and_(Placeholder.id == placeholder_id, Placeholder.tenant_id == current_user.tenant_id)
    ).first()
    if not placeholder:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Placeholder not found"})
    
    placeholder.is_active = False
    db.commit()
    log_audit(db, current_user, "delete", "Placeholder", placeholder.id)
    return {"message": "Placeholder deleted"}


# ============== HOLIDAYS ==============

@router.get("/holidays", response_model=list[HolidayResponse])
async def list_holidays(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*READ_ROLES)),
):
    """List all holidays."""
    return db.query(Holiday).filter(
        Holiday.tenant_id == current_user.tenant_id
    ).order_by(Holiday.date).all()


@router.post("/holidays", response_model=HolidayResponse)
async def create_holiday(
    data: HolidayCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Create a new holiday. (Admin, Finance)"""
    holiday = Holiday(tenant_id=current_user.tenant_id, **data.model_dump())
    db.add(holiday)
    db.commit()
    db.refresh(holiday)
    log_audit(db, current_user, "create", "Holiday", holiday.id, new_values=data.model_dump())
    return holiday


@router.delete("/holidays/{holiday_id}")
async def delete_holiday(
    holiday_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*MASTER_DATA_WRITE_ROLES)),
):
    """Delete a holiday. (Admin, Finance)"""
    holiday = db.query(Holiday).filter(
        and_(Holiday.id == holiday_id, Holiday.tenant_id == current_user.tenant_id)
    ).first()
    if not holiday:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Holiday not found"})
    
    db.delete(holiday)
    db.commit()
    log_audit(db, current_user, "delete", "Holiday", holiday_id)
    return {"message": "Holiday deleted"}


# ============== SETTINGS ==============

@router.get("/settings", response_model=list[SettingsResponse])
async def list_settings(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*READ_ROLES)),
):
    """List all settings."""
    return db.query(Settings).filter(
        Settings.tenant_id == current_user.tenant_id
    ).all()


@router.get("/settings/{key}", response_model=SettingsResponse)
async def get_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*READ_ROLES)),
):
    """Get a setting by key."""
    setting = db.query(Settings).filter(
        and_(Settings.key == key, Settings.tenant_id == current_user.tenant_id)
    ).first()
    if not setting:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Setting not found"})
    return setting


@router.post("/settings", response_model=SettingsResponse)
async def create_setting(
    data: SettingsCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES)),
):
    """Create a new setting."""
    existing = db.query(Settings).filter(
        and_(Settings.key == data.key, Settings.tenant_id == current_user.tenant_id)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail={"code": "CONFLICT", "message": f"Setting '{data.key}' already exists"})
    
    setting = Settings(tenant_id=current_user.tenant_id, **data.model_dump())
    db.add(setting)
    db.commit()
    db.refresh(setting)
    log_audit(db, current_user, "create", "Settings", setting.id, new_values=data.model_dump())
    return setting


@router.patch("/settings/{key}", response_model=SettingsResponse)
async def update_setting(
    key: str,
    data: SettingsUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES)),
):
    """Update a setting."""
    setting = db.query(Settings).filter(
        and_(Settings.key == key, Settings.tenant_id == current_user.tenant_id)
    ).first()
    if not setting:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Setting not found"})
    
    update_data = data.model_dump(exclude_unset=True)
    old_values = {k: getattr(setting, k) for k in update_data}
    
    for k, value in update_data.items():
        setattr(setting, k, value)
    
    db.commit()
    db.refresh(setting)
    log_audit(db, current_user, "update", "Settings", setting.id, old_values=old_values, new_values=update_data)
    return setting


@router.delete("/settings/{key}")
async def delete_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(*WRITE_ROLES)),
):
    """Delete a setting."""
    setting = db.query(Settings).filter(
        and_(Settings.key == key, Settings.tenant_id == current_user.tenant_id)
    ).first()
    if not setting:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Setting not found"})
    
    db.delete(setting)
    db.commit()
    log_audit(db, current_user, "delete", "Settings", setting.id)
    return {"message": "Setting deleted"}


# ============== GRAPH SYNC ==============

@router.post("/sync/graph-users")
async def trigger_graph_sync(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN)),
):
    """Trigger an on-demand Graph background sync for the current tenant.

    Refreshes email, display_name, and manager_object_id for every user in the
    tenant from Microsoft Graph using the client credentials (app-only) flow.
    Requires the app registration to have User.Read.All application permission
    with admin consent. (Admin only)

    After syncing user profiles, rebuilds the reporting_cache so that
    RO/Director scoped access reflects the latest org chart.
    """
    from api.app.services.reporting import ReportingService

    settings = get_settings()
    result = run_graph_sync(db, settings, current_user.tenant_id)

    # Rebuild reporting cache from fresh manager_object_id data
    hierarchy_rows = ReportingService.rebuild_cache_for_tenant(current_user.tenant_id, db)

    response = result.as_dict()
    response["reporting_cache_rows"] = hierarchy_rows
    return response
