"""Lookup endpoints for read-only master data access by all roles."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, CurrentUser
from api.app.models.core import (
    CostCenter, Project, Resource, Placeholder
)
from api.app.schemas.admin import (
    CostCenterResponse, ProjectResponse,
    ResourceResponse, PlaceholderResponse,
)

router = APIRouter(prefix="/lookups", tags=["Lookups"])


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
    return db.query(Project).filter(
        Project.tenant_id == current_user.tenant_id
    ).order_by(Project.name).all()


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
