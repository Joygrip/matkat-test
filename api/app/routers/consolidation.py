"""Consolidation endpoints - dashboard and publishing."""
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole
from api.app.services.consolidation import ConsolidationService

router = APIRouter(prefix="/consolidation", tags=["Consolidation"])


class PublishRequest(BaseModel):
    name: str
    description: Optional[str] = None


class SnapshotLineResponse(BaseModel):
    id: str
    line_type: str
    project_id: Optional[str]
    project_name: Optional[str]
    resource_id: Optional[str]
    resource_name: Optional[str]
    placeholder_id: Optional[str]
    placeholder_name: Optional[str]
    year: int
    month: int
    fte_percent: Optional[int]
    hours: Optional[int]
    cost: Optional[int]


class SnapshotResponse(BaseModel):
    id: str
    tenant_id: str
    period_id: str
    name: str
    description: Optional[str]
    published_by: str
    published_at: str
    lines_count: int


class SnapshotDetailResponse(SnapshotResponse):
    lines: list[SnapshotLineResponse]


def _to_response(snapshot, include_lines: bool = False):
    base = SnapshotResponse(
        id=snapshot.id,
        tenant_id=snapshot.tenant_id,
        period_id=snapshot.period_id,
        name=snapshot.name,
        description=snapshot.description,
        published_by=snapshot.published_by,
        published_at=str(snapshot.published_at),
        lines_count=len(snapshot.lines),
    )
    
    if include_lines:
        return SnapshotDetailResponse(
            **base.model_dump(),
            lines=[
                SnapshotLineResponse(
                    id=line.id,
                    line_type=line.line_type,
                    project_id=line.project_id,
                    project_name=line.project_name,
                    resource_id=line.resource_id,
                    resource_name=line.resource_name,
                    placeholder_id=line.placeholder_id,
                    placeholder_name=line.placeholder_name,
                    year=line.year,
                    month=line.month,
                    fte_percent=line.fte_percent,
                    hours=line.hours,
                    cost=line.cost,
                )
                for line in snapshot.lines
            ]
        )
    
    return base


@router.get("/dashboard/{period_id}")
async def get_dashboard(
    period_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.DIRECTOR
    )),
):
    """
    Get consolidation dashboard for a period.
    
    Shows demand vs supply gaps, orphan demands, and over-allocations.
    
    Accessible to: Admin, Finance, Director
    """
    service = ConsolidationService(db, current_user)
    return service.get_dashboard(period_id)


@router.post("/publish/{period_id}", response_model=SnapshotResponse)
async def publish_snapshot(
    period_id: str,
    data: PublishRequest,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Publish an immutable snapshot of planning data for a period.
    
    Accessible to: Admin, Finance
    """
    service = ConsolidationService(db, current_user)
    snapshot = service.publish_snapshot(period_id, data.name, data.description)
    return _to_response(snapshot)


@router.get("/snapshots", response_model=list[SnapshotResponse])
async def list_snapshots(
    period_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.DIRECTOR
    )),
):
    """
    List all published snapshots.
    
    Accessible to: Admin, Finance, Director
    """
    service = ConsolidationService(db, current_user)
    snapshots = service.get_snapshots(period_id)
    return [_to_response(s) for s in snapshots]


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDetailResponse)
async def get_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.DIRECTOR
    )),
):
    """
    Get a specific snapshot with all its lines.
    
    Accessible to: Admin, Finance, Director
    """
    service = ConsolidationService(db, current_user)
    snapshot = service.get_snapshot(snapshot_id)
    if not snapshot:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Snapshot not found"})
    return _to_response(snapshot, include_lines=True)
