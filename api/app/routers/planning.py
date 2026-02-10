"""Planning endpoints - Demand and Supply lines."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.schemas.planning import (
    DemandLineCreate, DemandLineUpdate, DemandLineResponse,
    SupplyLineCreate, SupplyLineUpdate, SupplyLineResponse,
)
from api.app.services.planning import DemandService, SupplyService

router = APIRouter(tags=["Planning"])

# ============== DEMAND LINES ==============

@router.get("/demand-lines", response_model=list[DemandLineResponse])
async def list_demand_lines(
    year: Optional[int] = Query(None, description="Filter by year"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Filter by month"),
    project_id: Optional[str] = Query(None, description="Filter by project_id"),
    resource_id: Optional[str] = Query(None, description="Filter by resource_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.RO, UserRole.DIRECTOR
    )),
):
    """
    List demand lines. Filtered by tenant, project, resource.
    
    Accessible to: Admin, Finance (read-only), PM, RO (read-only), Director
    """
    service = DemandService(db, current_user)
    lines = service.get_all(year, month, project_id, resource_id)
    
    # Enrich with names
    result = []
    for line in lines:
        resp = DemandLineResponse(
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
            placeholder_name=line.placeholder.name if line.placeholder else None,
        )
        result.append(resp)
    
    return result


@router.get("/demand-lines/{demand_id}", response_model=DemandLineResponse)
async def get_demand_line(
    demand_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.RO, UserRole.DIRECTOR
    )),
):
    """Get a specific demand line."""
    service = DemandService(db, current_user)
    line = service.get_by_id(demand_id)
    if not line:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Demand line not found"})
    
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
        placeholder_name=line.placeholder.name if line.placeholder else None,
    )


@router.post("/demand-lines", response_model=DemandLineResponse)
async def create_demand_line(
    data: DemandLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.PM)),
):
    """
    Create a new demand line.
    
    Rules:
    - Must specify either resource_id OR placeholder_id (XOR)
    - Placeholders not allowed within 4MFC window
    - FTE must be 5-100 in steps of 5
    - Period must be open
    
    Accessible to: PM
    """
    service = DemandService(db, current_user)
    line = service.create(
        project_id=data.project_id,
        year=data.year,
        month=data.month,
        fte_percent=data.fte_percent,
        resource_id=data.resource_id,
        placeholder_id=data.placeholder_id,
    )
    
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
        placeholder_name=line.placeholder.name if line.placeholder else None,
    )


@router.patch("/demand-lines/{demand_id}", response_model=DemandLineResponse)
async def update_demand_line(
    demand_id: str,
    data: DemandLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.PM)),
):
    """
    Update a demand line's FTE.
    
    Accessible to: PM
    """
    service = DemandService(db, current_user)
    line = service.update(demand_id, data.fte_percent)
    
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
        placeholder_name=line.placeholder.name if line.placeholder else None,
    )


@router.delete("/demand-lines/{demand_id}")
async def delete_demand_line(
    demand_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.PM)),
):
    """
    Delete a demand line.
    
    Accessible to: PM
    """
    service = DemandService(db, current_user)
    service.delete(demand_id)
    return {"message": "Demand line deleted"}


# ============== SUPPLY LINES ==============

@router.get("/supply-lines", response_model=list[SupplyLineResponse])
async def list_supply_lines(
    year: Optional[int] = Query(None, description="Filter by year"),
    month: Optional[int] = Query(None, ge=1, le=12, description="Filter by month"),
    resource_id: Optional[str] = Query(None, description="Filter by resource_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.RO, UserRole.DIRECTOR
    )),
):
    """
    List supply lines. Filtered by tenant, resource.
    
    Accessible to: Admin, Finance (read-only), PM (read-only), RO, Director
    """
    service = SupplyService(db, current_user)
    lines = service.get_all(year, month, None, resource_id)
    
    result = []
    for line in lines:
        resp = SupplyLineResponse(
            id=line.id,
            tenant_id=line.tenant_id,
            period_id=line.period_id,
            resource_id=line.resource_id,
            year=line.year,
            month=line.month,
            fte_percent=line.fte_percent,
            created_by=line.created_by,
            created_at=line.created_at,
            updated_at=line.updated_at,
            resource_name=line.resource.display_name if line.resource else None,
        )
        result.append(resp)
    
    return result


@router.get("/supply-lines/{supply_id}", response_model=SupplyLineResponse)
async def get_supply_line(
    supply_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.RO, UserRole.DIRECTOR
    )),
):
    """Get a specific supply line."""
    service = SupplyService(db, current_user)
    line = service.get_by_id(supply_id)
    if not line:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Supply line not found"})
    
    return SupplyLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        period_id=line.period_id,
        resource_id=line.resource_id,
        year=line.year,
        month=line.month,
        fte_percent=line.fte_percent,
        created_by=line.created_by,
        created_at=line.created_at,
        updated_at=line.updated_at,
        resource_name=line.resource.display_name if line.resource else None,
    )


@router.post("/supply-lines", response_model=SupplyLineResponse)
async def create_supply_line(
    data: SupplyLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.RO)),
):
    """
    Create a new supply line.
    
    Rules:
    - FTE must be 5-100 in steps of 5
    - Period must be open
    - One supply line per resource per month
    
    Accessible to: RO
    """
    service = SupplyService(db, current_user)
    line = service.create(
        resource_id=data.resource_id,
        year=data.year,
        month=data.month,
        fte_percent=data.fte_percent,
    )
    
    return SupplyLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        period_id=line.period_id,
        resource_id=line.resource_id,
        year=line.year,
        month=line.month,
        fte_percent=line.fte_percent,
        created_by=line.created_by,
        created_at=line.created_at,
        updated_at=line.updated_at,
        resource_name=line.resource.display_name if line.resource else None,
    )


@router.patch("/supply-lines/{supply_id}", response_model=SupplyLineResponse)
async def update_supply_line(
    supply_id: str,
    data: SupplyLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.RO)),
):
    """
    Update a supply line's FTE.
    
    Accessible to: RO
    """
    service = SupplyService(db, current_user)
    line = service.update(supply_id, data.fte_percent)
    
    return SupplyLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        period_id=line.period_id,
        resource_id=line.resource_id,
        year=line.year,
        month=line.month,
        fte_percent=line.fte_percent,
        created_by=line.created_by,
        created_at=line.created_at,
        updated_at=line.updated_at,
        resource_name=line.resource.display_name if line.resource else None,
    )


@router.delete("/supply-lines/{supply_id}")
async def delete_supply_line(
    supply_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.RO)),
):
    """
    Delete a supply line.
    
    Accessible to: RO
    """
    service = SupplyService(db, current_user)
    service.delete(supply_id)
    return {"message": "Supply line deleted"}
