"""Consolidation endpoints - dashboard and publishing."""
import csv
import io
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
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
    source_id: Optional[str] = None
    project_id: Optional[str] = None
    project_code: Optional[str] = None
    project_name: Optional[str] = None
    resource_id: Optional[str] = None
    resource_initials: Optional[str] = None
    resource_name: Optional[str] = None
    placeholder_id: Optional[str] = None
    placeholder_name: Optional[str] = None
    cost_center_id: Optional[str] = None
    cost_center_code: Optional[str] = None
    cost_center_name: Optional[str] = None
    year: int
    month: int
    fte_percent: Optional[int] = None
    planned_fte_percent: Optional[int] = None
    actual_fte_percent: Optional[int] = None
    hours: Optional[int] = None
    monthly_fte_cost_used: Optional[int] = None
    planned_cost_cents: Optional[int] = None
    actual_cost_cents: Optional[int] = None
    cost: Optional[int] = None
    approval_status: Optional[str] = None


class SnapshotResponse(BaseModel):
    id: str
    tenant_id: str
    period_id: str
    name: str
    description: Optional[str] = None
    published_by: str
    published_at: str
    lines_count: int
    monthly_fte_cost_used: Optional[int] = None
    period_status_at_publish: Optional[str] = None


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
        monthly_fte_cost_used=snapshot.monthly_fte_cost_used,
        period_status_at_publish=snapshot.period_status_at_publish,
    )

    if include_lines:
        return SnapshotDetailResponse(
            **base.model_dump(),
            lines=[
                SnapshotLineResponse(
                    id=line.id,
                    line_type=line.line_type,
                    source_id=line.source_id,
                    project_id=line.project_id,
                    project_code=line.project_code,
                    project_name=line.project_name,
                    resource_id=line.resource_id,
                    resource_initials=line.resource_initials,
                    resource_name=line.resource_name,
                    placeholder_id=line.placeholder_id,
                    placeholder_name=line.placeholder_name,
                    cost_center_id=line.cost_center_id,
                    cost_center_code=line.cost_center_code,
                    cost_center_name=line.cost_center_name,
                    year=line.year,
                    month=line.month,
                    fte_percent=line.fte_percent,
                    planned_fte_percent=line.planned_fte_percent,
                    actual_fte_percent=line.actual_fte_percent,
                    hours=line.hours,
                    monthly_fte_cost_used=line.monthly_fte_cost_used,
                    planned_cost_cents=line.planned_cost_cents,
                    actual_cost_cents=line.actual_cost_cents,
                    cost=line.cost,
                    approval_status=line.approval_status,
                )
                for line in snapshot.lines
            ]
        )

    return base


@router.get("/dashboard/{period_id}")
async def get_dashboard(
    period_id: str,
    scope: str = Query("default", description="Dashboard scope: 'default' or 'pm'. 'pm' bypasses Manager CC filtering for Manager+PM users only."),
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER, UserRole.PM
    )),
):
    """
    Get consolidation dashboard for a period.

    Shows demand vs supply gaps, orphan demands, and over-allocations.

    scope="default" — Manager users see only their managed/delegated CCs.
    scope="pm"      — Manager+PM users receive full-org data so the frontend
                      FinanceOverview component can apply PM project filtering.
                      Has no effect for plain Manager, Finance, Admin, or PM.

    Accessible to: Admin, Finance, Manager, PM (view only)
    """
    service = ConsolidationService(db, current_user)
    return service.get_dashboard(period_id, scope=scope)


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


@router.get("/resource/{period_id}/{resource_id}")
async def get_resource_detail(
    period_id: str,
    resource_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER, UserRole.PM
    )),
):
    """
    Get per-assignment demand and supply breakdown for a resource in a period.

    Accessible to: Admin, Finance, Manager, PM
    """
    service = ConsolidationService(db, current_user)
    return service.get_resource_detail(period_id, resource_id)


@router.get("/snapshots", response_model=list[SnapshotResponse])
async def list_snapshots(
    period_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER
    )),
):
    """
    List all published snapshots.
    
    Accessible to: Admin, Finance, Director, RO (view only)
    """
    service = ConsolidationService(db, current_user)
    snapshots = service.get_snapshots(period_id)
    return [_to_response(s) for s in snapshots]


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDetailResponse)
async def get_snapshot(
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.MANAGER
    )),
):
    """
    Get a specific snapshot with all its lines.

    Accessible to: Admin, Finance, Director, RO (view only)
    """
    service = ConsolidationService(db, current_user)
    snapshot = service.get_snapshot(snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Snapshot not found"})
    return _to_response(snapshot, include_lines=True)


@router.get("/snapshots/{snapshot_id}/csv")
async def download_snapshot_csv(
    snapshot_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(UserRole.ADMIN, UserRole.FINANCE)),
):
    """
    Download a published snapshot as a CSV file.

    Accessible to: Finance only
    """
    service = ConsolidationService(db, current_user)
    snapshot = service.get_snapshot(snapshot_id)
    if not snapshot:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Snapshot not found"})

    def _dkk(cents):
        """Convert cents to whole DKK for human-readable columns. Returns '' for None."""
        if cents is None:
            return ""
        return cents // 100

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "period",
        "line_type",
        "source_id",
        "project_id",
        "project_code",
        "project_name",
        "resource_id",
        "resource_initials",
        "resource_name",
        "placeholder_id",
        "placeholder_name",
        "cost_center_id",
        "cost_center_code",
        "cost_center_name",
        "fte_percent",
        "planned_fte_percent",
        "actual_fte_percent",
        "hours",
        "monthly_fte_cost_used",
        "monthly_fte_cost_dkk",
        "planned_cost_cents",
        "planned_cost_dkk",
        "actual_cost_cents",
        "actual_cost_dkk",
        "cost_cents",
        "cost_dkk",
        "approval_status",
        "snapshot_name",
        "published_at",
        "published_by",
        "period_status_at_publish",
    ])

    rate = snapshot.monthly_fte_cost_used  # DKK, already human-readable

    for line in snapshot.lines:
        writer.writerow([
            f"{line.year}-{line.month:02d}",
            line.line_type,
            line.source_id or "",
            line.project_id or "",
            line.project_code or "",
            line.project_name or "",
            line.resource_id or "",
            line.resource_initials or "",
            line.resource_name or "",
            line.placeholder_id or "",
            line.placeholder_name or "",
            line.cost_center_id or "",
            line.cost_center_code or "",
            line.cost_center_name or "",
            line.fte_percent if line.fte_percent is not None else "",
            line.planned_fte_percent if line.planned_fte_percent is not None else "",
            line.actual_fte_percent if line.actual_fte_percent is not None else "",
            line.hours if line.hours is not None else "",
            line.monthly_fte_cost_used if line.monthly_fte_cost_used is not None else "",
            line.monthly_fte_cost_used if line.monthly_fte_cost_used is not None else "",
            line.planned_cost_cents if line.planned_cost_cents is not None else "",
            _dkk(line.planned_cost_cents),
            line.actual_cost_cents if line.actual_cost_cents is not None else "",
            _dkk(line.actual_cost_cents),
            line.cost if line.cost is not None else "",
            _dkk(line.cost),
            line.approval_status or "",
            snapshot.name,
            str(snapshot.published_at),
            snapshot.published_by,
            snapshot.period_status_at_publish or "",
        ])

    output.seek(0)
    filename = f"snapshot-{snapshot.period_id}-{snapshot_id}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
