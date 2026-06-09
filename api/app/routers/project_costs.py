"""Project costs endpoints - externals and OoP equipment per project/period."""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator

from api.app.db.engine import get_db
from api.app.auth.dependencies import get_current_user, require_roles, CurrentUser
from api.app.models.core import UserRole, User, Project, ProjectPM, Resource, ResourceType
from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine

router = APIRouter(prefix="/project-costs", tags=["Project Costs"])

# ─── Schemas ─────────────────────────────────────────────────────────────────

class ExternalResourceResponse(BaseModel):
    id: str
    display_name: str
    initials: Optional[str]
    employee_id: str


class ExternalLineCreate(BaseModel):
    project_id: str
    period_id: str
    resource_id: Optional[str] = None
    description: Optional[str] = None  # name / description (required when resource_id is None)
    notes: Optional[str] = None         # additional free-text notes
    cost: int  # cents

    @field_validator("cost")
    @classmethod
    def cost_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("cost must be at least 1 cent")
        return v


class ExternalLineUpdate(BaseModel):
    resource_id: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    cost: Optional[int] = None

    @field_validator("cost")
    @classmethod
    def cost_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 1:
            raise ValueError("cost must be at least 1 cent")
        return v


class ExternalLineResponse(BaseModel):
    id: str
    tenant_id: str
    project_id: str
    period_id: str
    resource_id: Optional[str]
    resource_name: Optional[str]
    description: Optional[str]
    notes: Optional[str]
    cost: int
    created_by: str
    created_at: str
    updated_at: str
    project_name: Optional[str] = None


class EquipmentLineCreate(BaseModel):
    project_id: str
    period_id: str
    description: Optional[str] = None
    cost: int  # cents

    @field_validator("cost")
    @classmethod
    def cost_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("cost must be at least 1 cent")
        return v


class EquipmentLineUpdate(BaseModel):
    description: Optional[str] = None
    cost: Optional[int] = None

    @field_validator("cost")
    @classmethod
    def cost_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 1:
            raise ValueError("cost must be at least 1 cent")
        return v


class EquipmentLineResponse(BaseModel):
    id: str
    tenant_id: str
    project_id: str
    period_id: str
    description: Optional[str]
    cost: int
    created_by: str
    created_at: str
    updated_at: str
    project_name: Optional[str] = None


class ProjectCostSummaryItem(BaseModel):
    project_id: str
    project_name: str
    externals_total: int
    equipment_total: int
    combined_total: int


class ProjectCostSummaryResponse(BaseModel):
    externals_total: int
    equipment_total: int
    combined_total: int
    per_project: list[ProjectCostSummaryItem]


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_pm_project_ids(db: Session, current_user: CurrentUser) -> Optional[list[str]]:
    """Return project IDs owned by the current effective PM, or None if Finance/Admin (unrestricted).

    Effective PM = primary PM role, or Manager with secondary_role=PM.
    Returns None (no restriction) for all other roles.
    """
    is_effective_pm = (
        current_user.role == UserRole.PM
        or (current_user.role == UserRole.MANAGER and current_user.secondary_role == UserRole.PM.value)
    )
    if not is_effective_pm:
        return None
    pm_user = db.query(User).filter(
        User.tenant_id == current_user.tenant_id,
        User.object_id == current_user.object_id,
    ).first()
    if not pm_user:
        return []
    rows = db.query(ProjectPM.project_id).filter(
        ProjectPM.user_id == pm_user.id,
    ).all()
    return [r.project_id for r in rows]


def _check_project_access(project_id: str, pm_project_ids: Optional[list[str]]) -> None:
    """Raise 403 if PM does not own the project."""
    if pm_project_ids is not None and project_id not in pm_project_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "PM_NOT_AUTHORIZED", "message": "You are not the assigned PM for this project"},
        )


def _project_name_map(db: Session, tenant_id: str) -> dict[str, str]:
    projects = db.query(Project.id, Project.name).filter(Project.tenant_id == tenant_id).all()
    return {p.id: p.name for p in projects}


def _resource_name_map(db: Session, tenant_id: str) -> dict[str, str]:
    resources = db.query(Resource.id, Resource.display_name).filter(Resource.tenant_id == tenant_id).all()
    return {r.id: r.display_name for r in resources}


def _ext_to_response(
    line: ProjectExternalLine,
    project_name: Optional[str] = None,
    resource_name: Optional[str] = None,
) -> ExternalLineResponse:
    return ExternalLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        project_id=line.project_id,
        period_id=line.period_id,
        resource_id=line.resource_id,
        resource_name=resource_name,
        description=line.description,
        notes=line.notes,
        cost=line.cost,
        created_by=line.created_by,
        created_at=str(line.created_at),
        updated_at=str(line.updated_at),
        project_name=project_name,
    )


def _equip_to_response(line: ProjectEquipmentLine, project_name: Optional[str] = None) -> EquipmentLineResponse:
    return EquipmentLineResponse(
        id=line.id,
        tenant_id=line.tenant_id,
        project_id=line.project_id,
        period_id=line.period_id,
        description=line.description,
        cost=line.cost,
        created_by=line.created_by,
        created_at=str(line.created_at),
        updated_at=str(line.updated_at),
        project_name=project_name,
    )


# ─── External resources lookup ───────────────────────────────────────────────

@router.get("/external-resources", response_model=list[ExternalResourceResponse])
async def list_external_resources(
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER
    )),
):
    """Return all active resources of type External (initials starting with X)."""
    resources = db.query(Resource).filter(
        Resource.tenant_id == current_user.tenant_id,
        Resource.is_active == True,
        Resource.resource_type == ResourceType.EXTERNAL,
    ).order_by(Resource.display_name).all()
    return [
        ExternalResourceResponse(
            id=r.id,
            display_name=r.display_name,
            initials=r.initials,
            employee_id=r.employee_id,
        )
        for r in resources
    ]


# ─── Externals endpoints ─────────────────────────────────────────────────────

@router.get("/externals", response_model=list[ExternalLineResponse])
async def list_externals(
    period_id: Optional[str] = None,
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER
    )),
):
    pm_project_ids = _get_pm_project_ids(db, current_user)
    q = db.query(ProjectExternalLine).filter(
        ProjectExternalLine.tenant_id == current_user.tenant_id
    )
    if pm_project_ids is not None:
        q = q.filter(ProjectExternalLine.project_id.in_(pm_project_ids))
    if period_id:
        q = q.filter(ProjectExternalLine.period_id == period_id)
    if project_id:
        q = q.filter(ProjectExternalLine.project_id == project_id)
    lines = q.order_by(ProjectExternalLine.created_at).all()
    names = _project_name_map(db, current_user.tenant_id)
    rnames = _resource_name_map(db, current_user.tenant_id)
    return [_ext_to_response(ln, names.get(ln.project_id), rnames.get(ln.resource_id) if ln.resource_id else None) for ln in lines]


@router.post("/externals", response_model=ExternalLineResponse, status_code=status.HTTP_201_CREATED)
async def create_external(
    data: ExternalLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM
    )),
):
    pm_project_ids = _get_pm_project_ids(db, current_user)
    _check_project_access(data.project_id, pm_project_ids)
    line = ProjectExternalLine(
        tenant_id=current_user.tenant_id,
        project_id=data.project_id,
        period_id=data.period_id,
        resource_id=data.resource_id,
        description=data.description,
        notes=data.notes,
        cost=data.cost,
        created_by=current_user.object_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    names = _project_name_map(db, current_user.tenant_id)
    rnames = _resource_name_map(db, current_user.tenant_id)
    return _ext_to_response(line, names.get(line.project_id), rnames.get(line.resource_id) if line.resource_id else None)


@router.put("/externals/{line_id}", response_model=ExternalLineResponse)
async def update_external(
    line_id: str,
    data: ExternalLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM
    )),
):
    line = db.query(ProjectExternalLine).filter(
        ProjectExternalLine.id == line_id,
        ProjectExternalLine.tenant_id == current_user.tenant_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "External line not found"})
    pm_project_ids = _get_pm_project_ids(db, current_user)
    _check_project_access(line.project_id, pm_project_ids)
    if data.resource_id is not None:
        line.resource_id = data.resource_id
    if data.description is not None:
        line.description = data.description
    if data.notes is not None:
        line.notes = data.notes
    if data.cost is not None:
        line.cost = data.cost
    line.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(line)
    names = _project_name_map(db, current_user.tenant_id)
    rnames = _resource_name_map(db, current_user.tenant_id)
    return _ext_to_response(line, names.get(line.project_id), rnames.get(line.resource_id) if line.resource_id else None)


@router.delete("/externals/{line_id}")
async def delete_external(
    line_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM
    )),
):
    line = db.query(ProjectExternalLine).filter(
        ProjectExternalLine.id == line_id,
        ProjectExternalLine.tenant_id == current_user.tenant_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "External line not found"})
    pm_project_ids = _get_pm_project_ids(db, current_user)
    _check_project_access(line.project_id, pm_project_ids)
    db.delete(line)
    db.commit()
    return {"ok": True}


# ─── Equipment endpoints ──────────────────────────────────────────────────────

@router.get("/equipment", response_model=list[EquipmentLineResponse])
async def list_equipment(
    period_id: Optional[str] = None,
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER
    )),
):
    pm_project_ids = _get_pm_project_ids(db, current_user)
    q = db.query(ProjectEquipmentLine).filter(
        ProjectEquipmentLine.tenant_id == current_user.tenant_id
    )
    if pm_project_ids is not None:
        q = q.filter(ProjectEquipmentLine.project_id.in_(pm_project_ids))
    if period_id:
        q = q.filter(ProjectEquipmentLine.period_id == period_id)
    if project_id:
        q = q.filter(ProjectEquipmentLine.project_id == project_id)
    lines = q.order_by(ProjectEquipmentLine.created_at).all()
    names = _project_name_map(db, current_user.tenant_id)
    return [_equip_to_response(ln, names.get(ln.project_id)) for ln in lines]


@router.post("/equipment", response_model=EquipmentLineResponse, status_code=status.HTTP_201_CREATED)
async def create_equipment(
    data: EquipmentLineCreate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM
    )),
):
    pm_project_ids = _get_pm_project_ids(db, current_user)
    _check_project_access(data.project_id, pm_project_ids)
    line = ProjectEquipmentLine(
        tenant_id=current_user.tenant_id,
        project_id=data.project_id,
        period_id=data.period_id,
        description=data.description,
        cost=data.cost,
        created_by=current_user.object_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(line)
    db.commit()
    db.refresh(line)
    names = _project_name_map(db, current_user.tenant_id)
    return _equip_to_response(line, names.get(line.project_id))


@router.put("/equipment/{line_id}", response_model=EquipmentLineResponse)
async def update_equipment(
    line_id: str,
    data: EquipmentLineUpdate,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM
    )),
):
    line = db.query(ProjectEquipmentLine).filter(
        ProjectEquipmentLine.id == line_id,
        ProjectEquipmentLine.tenant_id == current_user.tenant_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Equipment line not found"})
    pm_project_ids = _get_pm_project_ids(db, current_user)
    _check_project_access(line.project_id, pm_project_ids)
    if data.description is not None:
        line.description = data.description
    if data.cost is not None:
        line.cost = data.cost
    line.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(line)
    names = _project_name_map(db, current_user.tenant_id)
    return _equip_to_response(line, names.get(line.project_id))


@router.delete("/equipment/{line_id}")
async def delete_equipment(
    line_id: str,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM
    )),
):
    line = db.query(ProjectEquipmentLine).filter(
        ProjectEquipmentLine.id == line_id,
        ProjectEquipmentLine.tenant_id == current_user.tenant_id,
    ).first()
    if not line:
        raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Equipment line not found"})
    pm_project_ids = _get_pm_project_ids(db, current_user)
    _check_project_access(line.project_id, pm_project_ids)
    db.delete(line)
    db.commit()
    return {"ok": True}


# ─── Summary endpoint ─────────────────────────────────────────────────────────

@router.get("/summary", response_model=ProjectCostSummaryResponse)
async def get_summary(
    period_id: Optional[str] = None,
    project_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: CurrentUser = Depends(require_roles(
        UserRole.ADMIN, UserRole.FINANCE, UserRole.PM, UserRole.MANAGER
    )),
):
    pm_project_ids = _get_pm_project_ids(db, current_user)
    names = _project_name_map(db, current_user.tenant_id)

    ext_q = db.query(ProjectExternalLine).filter(
        ProjectExternalLine.tenant_id == current_user.tenant_id
    )
    if pm_project_ids is not None:
        ext_q = ext_q.filter(ProjectExternalLine.project_id.in_(pm_project_ids))
    if period_id:
        ext_q = ext_q.filter(ProjectExternalLine.period_id == period_id)
    if project_id:
        ext_q = ext_q.filter(ProjectExternalLine.project_id == project_id)

    equip_q = db.query(ProjectEquipmentLine).filter(
        ProjectEquipmentLine.tenant_id == current_user.tenant_id
    )
    if pm_project_ids is not None:
        equip_q = equip_q.filter(ProjectEquipmentLine.project_id.in_(pm_project_ids))
    if period_id:
        equip_q = equip_q.filter(ProjectEquipmentLine.period_id == period_id)
    if project_id:
        equip_q = equip_q.filter(ProjectEquipmentLine.project_id == project_id)

    ext_by_project: dict[str, int] = {}
    for ln in ext_q.all():
        ext_by_project[ln.project_id] = ext_by_project.get(ln.project_id, 0) + ln.cost

    equip_by_project: dict[str, int] = {}
    for ln in equip_q.all():
        equip_by_project[ln.project_id] = equip_by_project.get(ln.project_id, 0) + ln.cost

    all_project_ids = set(ext_by_project.keys()) | set(equip_by_project.keys())
    per_project = []
    for pid in sorted(all_project_ids):
        ext_total = ext_by_project.get(pid, 0)
        equip_total = equip_by_project.get(pid, 0)
        per_project.append(ProjectCostSummaryItem(
            project_id=pid,
            project_name=names.get(pid, pid),
            externals_total=ext_total,
            equipment_total=equip_total,
            combined_total=ext_total + equip_total,
        ))

    total_ext = sum(ext_by_project.values())
    total_equip = sum(equip_by_project.values())
    return ProjectCostSummaryResponse(
        externals_total=total_ext,
        equipment_total=total_equip,
        combined_total=total_ext + total_equip,
        per_project=per_project,
    )
