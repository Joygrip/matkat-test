"""Lookup endpoints for read-only master data access by all roles."""
from fastapi import APIRouter, Depends
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
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active resources.
    Accessible to all roles (read-only).
    """
    return db.query(Resource).filter(
        and_(
            Resource.tenant_id == current_user.tenant_id,
            Resource.is_active == True,
        )
    ).order_by(Resource.display_name).all()


@router.get("/placeholders", response_model=list[PlaceholderResponse])
async def list_placeholders(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(get_current_user),
):
    """
    List all active placeholders.
    Accessible to all roles (read-only).
    """
    return db.query(Placeholder).filter(
        and_(
            Placeholder.tenant_id == current_user.tenant_id,
            Placeholder.is_active == True,
        )
    ).order_by(Placeholder.name).all()
