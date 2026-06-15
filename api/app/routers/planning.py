"""Planning endpoints - Demand and Supply lines."""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole, Resource, User, CostCenter, Placeholder
from api.app.config import get_settings
from api.app.services.audit import log_audit
from api.app.schemas.admin import PlaceholderResponse
from api.app.schemas.planning import (
    PlaceholderCreateRequest,
    DemandLineCreate, DemandLineUpdate, DemandLineResponse,
    DemandGroupDeleteRequest, DemandGroupMoveRequest,
    SupplyLineCreate, SupplyLineUpdate, SupplyLineResponse,
    SupplyGroupDeleteRequest, SupplyGroupMoveRequest,
    BulkDemandLineRequest, BulkDemandLineResponse, BulkDemandLineAction,
    BulkDemandLineCreate, BulkDemandLineUpdate, BulkDemandLineDelete,
    BulkDemandLineResult,
    BulkSupplyLineRequest, BulkSupplyLineResponse, BulkSupplyLineAction,
    BulkSupplyLineCreate, BulkSupplyLineUpdate, BulkSupplyLineDelete,
    BulkSupplyLineResult
)
from api.app.services.planning import DemandService, SupplyService

router = APIRouter(tags=["Planning"])


def _check_resource_country(db: Session, resource_id: Optional[str], tenant_id: str) -> None:
    """Raise 400 if the resource's user country or email prefix is in the planning exclusion lists."""
    if not resource_id:
        return
    settings = get_settings()
    excluded_countries = settings.planning_excluded_countries_list
    excluded_prefixes = settings.planning_excluded_email_prefixes_list
    if not excluded_countries and not excluded_prefixes:
        return
    resource = db.query(Resource).filter(
        Resource.id == resource_id,
        Resource.tenant_id == tenant_id,
    ).first()
    if not resource or not resource.user_id:
        return
    user = db.query(User).filter(User.id == resource.user_id).first()
    if not user:
        return
    if excluded_countries and user.country and user.country.upper() in [c.upper() for c in excluded_countries]:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "RESOURCE_EXCLUDED",
                "message": f"Resource {resource.display_name} is excluded from planning (country: {user.country})",
            },
        )
    if excluded_prefixes and user.email:
        email_lower = user.email.lower()
        if any(email_lower.startswith(p) for p in excluded_prefixes):
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "RESOURCE_EXCLUDED",
                    "message": f"Resource {resource.display_name} is excluded from planning (external: {user.email})",
                },
            )


def _enrich_demand(line) -> DemandLineResponse:
    """Build an enriched DemandLineResponse with cost center context."""
    cc_id = cc_name = None
    if line.resource and line.resource.cost_center:
        cc = line.resource.cost_center
        cc_id = cc.id
        cc_name = cc.name
    elif line.placeholder and line.placeholder.cost_center:
        cc_id = line.placeholder.cost_center_id
        cc_name = line.placeholder.cost_center.name

    return DemandLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        period_id=line.period_id,
        project_id=line.project_id,
        resource_id=line.resource_id,
        placeholder_id=line.placeholder_id,
        year=line.year,
        month=line.month,
        fte_percent=line.fte_percent,
        created_by=line.created_by,
        created_at=line.created_at,
        updated_at=line.updated_at,
        project_name=line.project.name if line.project else None,
        resource_name=line.resource.display_name if line.resource else None,
        resource_initials=line.resource.initials if line.resource else None,
        placeholder_name=line.placeholder.name if line.placeholder else None,
        cost_center_id=cc_id,
        cost_center_name=cc_name,
    )


def _enrich_supply(line) -> SupplyLineResponse:
    """Build an enriched SupplyLineResponse with cost center context."""
    cc_id = cc_name = None
    if line.resource and line.resource.cost_center:
        cc = line.resource.cost_center
        cc_id = cc.id
        cc_name = cc.name

    return SupplyLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        period_id=line.period_id,
        resource_id=line.resource_id,
        project_id=line.project_id,
        year=line.year,
        month=line.month,
        fte_percent=line.fte_percent,
        created_by=line.created_by,
        created_at=line.created_at,
        updated_at=line.updated_at,
        resource_name=line.resource.display_name if line.resource else None,
        resource_initials=line.resource.initials if line.resource else None,
        project_name=line.project.name if line.project else None,
        cost_center_id=cc_id,
        cost_center_name=cc_name,
    )

# ============== DEMAND LINES ==============

@router.get("/demand-lines/all", response_model=list[DemandLineResponse])
async def list_all_open_demand_lines(
    project_id: Optional[str] = Query(None, description="Filter by project_id"),
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    open_periods_only: bool = Query(True, description="When false, locked periods are included (read-only historical view)"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER,
        UserRole.EMPLOYEE,
    )),
):
    """Return all demand lines across every open period in a single query."""
    service = DemandService(db, current_user)
    lines = service.get_all(project_id=project_id, open_periods_only=open_periods_only, cost_center_id=cost_center_id)
    return [_enrich_demand(line) for line in lines]


@router.get("/demand-lines", response_model=list[DemandLineResponse])
async def list_demand_lines(
    period_id: Optional[str] = Query(None, description="Filter by period_id"),
    year: Optional[int] = Query(None, description="Filter by year"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Filter by month"),
    project_id: Optional[str] = Query(None, description="Filter by project_id"),
    resource_id: Optional[str] = Query(None, description="Filter by resource_id"),
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER,
        UserRole.EMPLOYEE,
    )),
):
    """
    List demand lines. Filtered by tenant, period, project, resource, cost center.
    Accessible to: Admin, Finance, PM, RO, Director, Employee (read-only for dashboard).
    """
    service = DemandService(db, current_user)
    lines = service.get_all(year, month, project_id, resource_id, period_id=period_id, cost_center_id=cost_center_id)
    return [_enrich_demand(line) for line in lines]


@router.get("/demand-lines/{demand_id}", response_model=DemandLineResponse)
async def get_demand_line(
    demand_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER
    )),
):
    """Get a specific demand line."""
    service = DemandService(db, current_user)
    line = service.get_by_id(demand_id)
    if not line:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Demand line not found"})
    
    return _enrich_demand(line)


@router.post("/demand-lines", response_model=DemandLineResponse)
async def create_demand_line(
    data: DemandLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.PM, UserRole.FINANCE)),
):
    """
    Create a new demand line.
    
    Rules:
    - Must specify either resource_id OR placeholder_id (XOR)
    - FTE must be 5-100 in steps of 5
    - Period must be open
    
    Accessible to: PM, Finance
    """
    _check_resource_country(db, data.resource_id, current_user.tenant_id)
    service = DemandService(db, current_user)
    line = service.create(
        project_id=data.project_id,
        year=data.year,
        month=data.month,
        fte_percent=data.fte_percent,
        resource_id=data.resource_id,
        placeholder_id=data.placeholder_id,
    )

    return _enrich_demand(line)


@router.patch("/demand-lines/{demand_id}", response_model=DemandLineResponse)
async def update_demand_line(
    demand_id: str,
    data: DemandLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.PM, UserRole.FINANCE)),
):
    """
    Update a demand line's FTE.
    
    Accessible to: PM, Finance
    """
    service = DemandService(db, current_user)
    line = service.update(demand_id, data.fte_percent, data.resource_id, data.placeholder_id)

    resp = _enrich_demand(line)
    resp.deleted_placeholder_ids = service.last_deleted_placeholder_ids or None
    return resp


@router.delete("/demand-lines/{demand_id}")
async def delete_demand_line(
    demand_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.PM, UserRole.FINANCE)),
):
    """
    Delete a demand line.
    
    Accessible to: PM, Finance
    """
    service = DemandService(db, current_user)
    service.delete(demand_id)
    return {"message": "Demand line deleted", "deleted_placeholder_ids": service.last_deleted_placeholder_ids}


@router.post("/demand-lines/group/delete")
async def delete_demand_group(
    data: DemandGroupDeleteRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.PM, UserRole.FINANCE)),
):
    """
    Delete all demand lines for a resource/placeholder + project combination
    across the specified periods.

    Rules:
    - Exactly one of resource_id or placeholder_id must be provided.
    - All periods must be open before any deletion occurs (all-or-nothing).
    - PM must be assigned to the project.
    - Supply lines and actuals are not affected.
    - Missing demand lines for some periods are silently skipped.

    Accessible to: Admin, PM, Finance
    """
    service = DemandService(db, current_user)
    deleted = service.delete_group(
        project_id=data.project_id,
        period_ids=data.period_ids,
        resource_id=data.resource_id,
        placeholder_id=data.placeholder_id,
    )
    return {"deleted": deleted, "deleted_placeholder_ids": service.last_deleted_placeholder_ids}


@router.post("/demand-lines/group/move")
async def move_demand_group(
    data: DemandGroupMoveRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.PM, UserRole.FINANCE)),
):
    """
    Move all demand lines for a source resource/placeholder + project to a target
    resource/placeholder across the specified periods.

    Rules:
    - Exactly one source identifier (from_resource_id XOR from_placeholder_id).
    - Exactly one target identifier (to_resource_id XOR to_placeholder_id).
    - Source and target cannot be identical.
    - All periods must be open before any row is updated (all-or-nothing).
    - Target resource must be active and not excluded by planning filters.
    - If the target already has demand for the same project/month, returns 409 Conflict.
    - Missing source rows are silently skipped.

    Accessible to: Admin, PM, Finance
    """
    _check_resource_country(db, data.to_resource_id, current_user.tenant_id)
    service = DemandService(db, current_user)
    moved = service.move_group(
        project_id=data.project_id,
        to_project_id=data.to_project_id,
        period_ids=data.period_ids,
        from_resource_id=data.from_resource_id,
        from_placeholder_id=data.from_placeholder_id,
        to_resource_id=data.to_resource_id,
        to_placeholder_id=data.to_placeholder_id,
        confirm_cap=data.confirm_cap,
        operation=data.operation,
        period_mappings=data.period_mappings,
        merge_mode=data.merge_mode,
    )
    return {"moved": moved, "deleted_placeholder_ids": service.last_deleted_placeholder_ids}


@router.post("/demand-lines/bulk", response_model=BulkDemandLineResponse)
async def bulk_demand_lines(
    req: BulkDemandLineRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.PM)),
):
    """
    Bulk create, update, and delete demand lines.
    Accepts a list of actions. If all_or_nothing is True, stops on first error.
    """
    service = DemandService(db, current_user)
    results = []
    for action in req.actions:
        try:
            if action.action == 'create' and isinstance(action.data, BulkDemandLineCreate):
                _check_resource_country(db, action.data.resource_id, current_user.tenant_id)
                obj = service.create(**action.data.model_dump())
                results.append(BulkDemandLineResult(action="create", id=getattr(obj, 'id', None), status="success", error=None))
            elif action.action == 'update' and isinstance(action.data, BulkDemandLineUpdate):
                obj = service.update(action.data.id, action.data.fte_percent)
                results.append(BulkDemandLineResult(action="update", id=action.data.id, status="success", error=None))
            elif action.action == 'delete' and isinstance(action.data, BulkDemandLineDelete):
                service.delete(action.data.id)
                results.append(BulkDemandLineResult(action="delete", id=action.data.id, status="success", error=None))
            else:
                raise ValueError("Unknown or invalid action/data type")
        except Exception as e:
            detail = getattr(e, 'detail', None)
            error_msg = detail.get('message', str(e)) if isinstance(detail, dict) else str(detail or e)
            results.append(BulkDemandLineResult(
                action=action.action,
                id=getattr(action.data, 'id', None),
                status="error",
                error=error_msg,
            ))
            if req.all_or_nothing:
                remaining = req.actions[len(results):]
                for rem in remaining:
                    results.append(BulkDemandLineResult(
                        action=rem.action,
                        id=getattr(rem.data, 'id', None),
                        status="error",
                        error="Skipped due to earlier failure",
                    ))
                break
    return BulkDemandLineResponse(results=results)


# ============== PLACEHOLDERS ==============

@router.post("/placeholders", response_model=PlaceholderResponse)
async def create_planning_placeholder(
    data: PlaceholderCreateRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.PM)),
):
    """
    Create a placeholder for a cost center from the planning UI.

    Accessible to: PM (incl. Manager+PM via secondary role), Finance, Admin.
    The creator is recorded in created_by; the placeholder is visible and usable
    by anyone who can plan demand in the tenant.
    """
    cc = db.query(CostCenter).filter(
        and_(CostCenter.id == data.cost_center_id, CostCenter.tenant_id == current_user.tenant_id)
    ).first()
    if not cc:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Cost center not found"})
    if not cc.is_active:
        raise HTTPException(
            status_code=400,
            detail={"code": "VALIDATION_ERROR", "message": "Cannot create a placeholder for an inactive cost center"},
        )

    duplicate = db.query(Placeholder).filter(
        and_(
            Placeholder.tenant_id == current_user.tenant_id,
            Placeholder.cost_center_id == data.cost_center_id,
            Placeholder.is_active == True,
            func.lower(Placeholder.name) == data.name.lower(),
        )
    ).first()
    if duplicate:
        raise HTTPException(
            status_code=409,
            detail={"code": "PLACEHOLDER_EXISTS", "message": "This cost center already has a placeholder with that name."},
        )

    placeholder = Placeholder(
        tenant_id=current_user.tenant_id,
        cost_center_id=data.cost_center_id,
        name=data.name,
        description=data.description,
        skill_profile=data.skill_profile,
        created_by=current_user.id,
    )
    db.add(placeholder)
    db.commit()
    db.refresh(placeholder)
    log_audit(
        db, current_user, "create", "Placeholder", placeholder.id,
        new_values={"name": placeholder.name, "cost_center_id": placeholder.cost_center_id, "cost_center_name": cc.name},
    )
    return {
        "id": placeholder.id,
        "tenant_id": placeholder.tenant_id,
        "name": placeholder.name,
        "cost_center_id": placeholder.cost_center_id,
        "description": placeholder.description,
        "skill_profile": placeholder.skill_profile,
        "estimated_cost": placeholder.estimated_cost,
        "created_by": placeholder.created_by,
        "is_active": placeholder.is_active,
        "created_at": placeholder.created_at,
        "updated_at": placeholder.updated_at,
        "cost_center_name": cc.name,
    }


# ============== SUPPLY LINES ==============

@router.get("/supply-lines/all", response_model=list[SupplyLineResponse])
async def list_all_open_supply_lines(
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    project_id: Optional[str] = Query(None, description="Filter by project_id"),
    open_periods_only: bool = Query(True, description="When false, locked periods are included (read-only historical view)"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER,
        UserRole.EMPLOYEE,
    )),
):
    """Return all supply lines across every open period in a single query."""
    service = SupplyService(db, current_user)
    lines = service.get_all(open_periods_only=open_periods_only, cost_center_id=cost_center_id, project_id=project_id)
    return [_enrich_supply(line) for line in lines]


@router.get("/supply-lines", response_model=list[SupplyLineResponse])
async def list_supply_lines(
    period_id: Optional[str] = Query(None, description="Filter by period_id"),
    year: Optional[int] = Query(None, description="Filter by year"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Filter by month"),
    resource_id: Optional[str] = Query(None, description="Filter by resource_id"),
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER,
        UserRole.EMPLOYEE,
    )),
):
    """
    List supply lines. Filtered by tenant, period, resource, cost center.
    Accessible to: Admin, Finance, PM, RO, Director, Employee (read-only for dashboard).
    """
    service = SupplyService(db, current_user)
    lines = service.get_all(year, month, None, resource_id, period_id=period_id, cost_center_id=cost_center_id)
    return [_enrich_supply(line) for line in lines]


@router.get("/supply-lines/{supply_id}", response_model=SupplyLineResponse)
async def get_supply_line(
    supply_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER
    )),
):
    """Get a specific supply line."""
    service = SupplyService(db, current_user)
    line = service.get_by_id(supply_id)
    if not line:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Supply line not found"})
    
    return _enrich_supply(line)


@router.post("/supply-lines", response_model=SupplyLineResponse)
async def create_supply_line(
    data: SupplyLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.MANAGER, UserRole.FINANCE)),
):
    """
    Create a new supply line.
    
    Rules:
    - FTE must be 5-100 in steps of 5
    - Period must be open
    - One supply line per resource per month
    
    Accessible to: RO, Finance
    """
    _check_resource_country(db, data.resource_id, current_user.tenant_id)
    service = SupplyService(db, current_user)
    line = service.create(
        resource_id=data.resource_id,
        year=data.year,
        month=data.month,
        fte_percent=data.fte_percent,
        project_id=data.project_id,
    )

    return _enrich_supply(line)


@router.patch("/supply-lines/{supply_id}", response_model=SupplyLineResponse)
async def update_supply_line(
    supply_id: str,
    data: SupplyLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.MANAGER, UserRole.FINANCE)),
):
    """
    Update a supply line's FTE.
    
    Accessible to: RO, Finance
    """
    service = SupplyService(db, current_user)
    line = service.update(supply_id, data.fte_percent, data.resource_id, data.project_id)

    return _enrich_supply(line)


@router.delete("/supply-lines/{supply_id}")
async def delete_supply_line(
    supply_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.MANAGER, UserRole.FINANCE)),
):
    """
    Delete a supply line.
    
    Accessible to: RO, Finance
    """
    service = SupplyService(db, current_user)
    service.delete(supply_id)
    return {"message": "Supply line deleted"}


@router.post("/supply-lines/group/delete")
async def delete_supply_group(
    data: SupplyGroupDeleteRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.FINANCE)),
):
    """
    Delete all supply lines for a resource + project combination across the specified periods.

    Rules:
    - resource_id is required; project_id is optional (null = General availability).
    - All periods must be open before any deletion occurs (all-or-nothing).
    - Manager must have supply write access for the resource's cost center.
    - Demand lines and actuals are not affected.
    - Missing supply lines for some periods are silently skipped.

    Accessible to: Admin, Manager, Finance
    """
    service = SupplyService(db, current_user)
    deleted = service.delete_group(
        resource_id=data.resource_id,
        project_id=data.project_id,
        period_ids=data.period_ids,
    )
    return {"deleted": deleted}


@router.post("/supply-lines/group/move")
async def move_supply_group(
    data: SupplyGroupMoveRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.MANAGER, UserRole.FINANCE)),
):
    """
    Move all supply lines for a source resource + project to a target resource across the
    specified periods.

    Rules:
    - from_resource_id, to_resource_id, and project_id are required and must differ.
    - All periods must be open before any mutation occurs (all-or-nothing).
    - Manager must have supply write access for both source and target resources.
    - Target must be active.
    - If target already has supply for the same project in any period, returns 409.
    - Missing source supply lines for some periods are silently skipped.

    Accessible to: Admin, Manager, Finance
    """
    service = SupplyService(db, current_user)
    moved = service.move_group(
        from_resource_id=data.from_resource_id,
        to_resource_id=data.to_resource_id,
        project_id=data.project_id,
        to_project_id=data.to_project_id,
        period_ids=data.period_ids,
        confirm_cap=data.confirm_cap,
        operation=data.operation,
        period_mappings=data.period_mappings,
        merge_mode=data.merge_mode,
    )
    return {"moved": moved}


@router.post("/supply-lines/bulk", response_model=BulkSupplyLineResponse)
async def bulk_supply_lines(
    req: BulkSupplyLineRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER)),
):
    """
    Bulk create, update, and delete supply lines.
    Accepts a list of actions. If all_or_nothing is True, stops on first error.
    """
    service = SupplyService(db, current_user)
    results = []
    for action in req.actions:
        try:
            if action.action == 'create' and isinstance(action.data, BulkSupplyLineCreate):
                _check_resource_country(db, action.data.resource_id, current_user.tenant_id)
                obj = service.create(**action.data.model_dump())
                results.append(BulkSupplyLineResult(action="create", id=getattr(obj, 'id', None), status="success", error=None))
            elif action.action == 'update' and isinstance(action.data, BulkSupplyLineUpdate):
                obj = service.update(action.data.id, action.data.fte_percent)
                results.append(BulkSupplyLineResult(action="update", id=action.data.id, status="success", error=None))
            elif action.action == 'delete' and isinstance(action.data, BulkSupplyLineDelete):
                service.delete(action.data.id)
                results.append(BulkSupplyLineResult(action="delete", id=action.data.id, status="success", error=None))
            else:
                raise ValueError("Unknown or invalid action/data type")
        except Exception as e:
            detail = getattr(e, 'detail', None)
            error_msg = detail.get('message', str(e)) if isinstance(detail, dict) else str(detail or e)
            results.append(BulkSupplyLineResult(
                action=action.action,
                id=getattr(action.data, 'id', None),
                status="error",
                error=error_msg,
            ))
            if req.all_or_nothing:
                remaining = req.actions[len(results):]
                for rem in remaining:
                    results.append(BulkSupplyLineResult(
                        action=rem.action,
                        id=getattr(rem.data, 'id', None),
                        status="error",
                        error="Skipped due to earlier failure",
                    ))
                break
    return BulkSupplyLineResponse(results=results)
