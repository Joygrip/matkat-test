"""Lookup endpoints for read-only master data access by all roles."""
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, CurrentUser
from api.app.models.core import (
    Department, CostCenter, Project, Resource, Placeholder
)
from api.app.schemas.admin import (
    DepartmentResponse, CostCenterResponse, ProjectResponse,
    ResourceResponse, PlaceholderResponse,
)

router = APIRouter(prefix="/lookups", tags=["Lookups"])


def _enrich_placeholder(placeholder: Placeholder) -> dict:
    """Enrich a placeholder ORM object with department/cost-center names."""
    return {
        "id": placeholder.id,
        "tenant_id": placeholder.tenant_id,
        "name": placeholder.name,
        "department_id": placeholder.department_id,
        "cost_center_id": placeholder.cost_center_id,
        "description": placeholder.description,
        "skill_profile": placeholder.skill_profile,
        "estimated_cost": placeholder.estimated_cost,
        "is_active": placeholder.is_active,
        "created_at": placeholder.created_at,
        "updated_at": placeholder.updated_at,
        "department_name": placeholder.department.name if placeholder.department else None,
        "cost_center_name": placeholder.cost_center.name if placeholder.cost_center else None,
    }


@router.get("/departments", response_model=list[DepartmentResponse])
async def list_departments(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active departments.
    Accessible to all roles (read-only).
    """
    return db.query(Department).filter(
        and_(
            Department.tenant_id == current_user.tenant_id,
            Department.is_active == True,
        )
    ).order_by(Department.name).all()


@router.get("/cost-centers", response_model=list[CostCenterResponse])
async def list_cost_centers(
    department_id: Optional[str] = Query(None, description="Filter by department_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active cost centers, optionally filtered by department.
    Accessible to all roles (read-only).
    """
    query = db.query(CostCenter).filter(
        and_(
            CostCenter.tenant_id == current_user.tenant_id,
            CostCenter.is_active == True,
        )
    )
    if department_id:
        query = query.filter(CostCenter.department_id == department_id)
    return query.order_by(CostCenter.name).all()


@router.get("/projects", response_model=list[ProjectResponse])
async def list_projects(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active projects.
    Accessible to all roles (read-only).
    """
    return db.query(Project).filter(
        and_(
            Project.tenant_id == current_user.tenant_id,
            Project.is_active == True,
        )
    ).order_by(Project.name).all()


@router.get("/resources", response_model=list[ResourceResponse])
async def list_resources(
    department_id: Optional[str] = Query(None, description="Filter by department_id"),
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active resources, optionally filtered by department/cost center.
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
    elif department_id:
        query = query.join(CostCenter, Resource.cost_center_id == CostCenter.id).filter(
            CostCenter.department_id == department_id
        )
    return query.order_by(Resource.display_name).all()


@router.get("/placeholders", response_model=list[PlaceholderResponse])
async def list_placeholders(
    department_id: Optional[str] = Query(None, description="Filter by department_id"),
    cost_center_id: Optional[str] = Query(None, description="Filter by cost_center_id"),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active placeholders, optionally filtered by department/cost center.
    Accessible to all roles (read-only).
    """
    query = db.query(Placeholder).filter(
        and_(
            Placeholder.tenant_id == current_user.tenant_id,
            Placeholder.is_active == True,
        )
    )
    if department_id:
        query = query.filter(Placeholder.department_id == department_id)
    if cost_center_id:
        query = query.filter(Placeholder.cost_center_id == cost_center_id)
    placeholders = query.order_by(Placeholder.name).all()
    return [_enrich_placeholder(p) for p in placeholders]
