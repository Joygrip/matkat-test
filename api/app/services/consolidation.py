"""Consolidation service - dashboard and publishing."""
from collections import defaultdict
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from api.app.models.core import Period, Project, Resource, Placeholder, Department, CostCenter
from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.actuals import ActualLine
from api.app.models.consolidation import OopLine, PublishSnapshot, PublishSnapshotLine
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit


class ConsolidationService:
    """Service for consolidation operations."""
    
    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user

    # ------------------------------------------------------------------ helpers
    def _load_resource_map(self) -> Dict[str, "Resource"]:
        """Load all resources for the tenant, keyed by id."""
        resources = self.db.query(Resource).filter(
            Resource.tenant_id == self.current_user.tenant_id
        ).all()
        return {r.id: r for r in resources}

    def _load_placeholder_map(self) -> Dict[str, "Placeholder"]:
        """Load all placeholders for the tenant, keyed by id."""
        placeholders = self.db.query(Placeholder).filter(
            Placeholder.tenant_id == self.current_user.tenant_id
        ).all()
        return {p.id: p for p in placeholders}

    def _resolve_dept_cc(self, resource: Optional["Resource"] = None,
                         placeholder: Optional["Placeholder"] = None):
        """Return (dept_id, dept_name, cc_id, cc_name) from resource or placeholder."""
        if resource and resource.cost_center:
            cc = resource.cost_center
            dept = cc.department if cc else None
            return (
                dept.id if dept else None,
                dept.name if dept else "Unassigned",
                cc.id,
                cc.name,
            )
        if placeholder:
            dept = placeholder.department
            cc = placeholder.cost_center
            return (
                dept.id if dept else None,
                dept.name if dept else "Unassigned",
                cc.id if cc else None,
                cc.name if cc else "Unassigned",
            )
        return (None, "Unassigned", None, "Unassigned")

    # ------------------------------------------------------------------ dashboard
    def get_dashboard(self, period_id: str) -> Dict[str, Any]:
        """
        Get consolidation dashboard data for a period, grouped by department.

        Returns a department-grouped hierarchy with per-resource/placeholder
        breakdowns plus flat over-allocations for quick scanning.
        """
        # Verify period exists
        period = self.db.query(Period).filter(
            and_(
                Period.id == period_id,
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).first()

        if not period:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Period not found"})

        resource_map = self._load_resource_map()
        placeholder_map = self._load_placeholder_map()

        # --- gather demand totals by resource ---
        demand_by_resource: Dict[str, int] = defaultdict(int)
        resource_demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.resource_id.isnot(None),
            )
        ).all()

        for d in resource_demands:
            demand_by_resource[d.resource_id] += d.fte_percent

        # --- gather supply totals by resource ---
        supply_by_resource: Dict[str, int] = defaultdict(int)
        supplies = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.period_id == period_id,
            )
        ).all()

        for s in supplies:
            supply_by_resource[s.resource_id] = s.fte_percent

        # --- gather placeholder demands ---
        placeholder_demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.placeholder_id.isnot(None),
            )
        ).all()

        # ---- build department -> cost-center -> resource/placeholder tree -----
        # Structure: dept_key -> { info, cc_key -> { info, resources[], placeholders[] } }
        dept_tree: Dict[str, Dict[str, Any]] = {}

        def _ensure_dept(dept_id, dept_name):
            key = dept_id or "__none__"
            if key not in dept_tree:
                dept_tree[key] = {
                    "department_id": dept_id,
                    "department_name": dept_name or "Unassigned",
                    "total_demand_fte": 0,
                    "total_supply_fte": 0,
                    "gap_fte": 0,
                    "cost_centers": {},
                }
            return dept_tree[key]

        def _ensure_cc(dept_node, cc_id, cc_name):
            key = cc_id or "__none__"
            if key not in dept_node["cost_centers"]:
                dept_node["cost_centers"][key] = {
                    "cost_center_id": cc_id,
                    "cost_center_name": cc_name or "Unassigned",
                    "resources": [],
                    "placeholders": [],
                }
            return dept_node["cost_centers"][key]

        # -- Add resource rows --
        all_resource_ids = set(demand_by_resource.keys()) | set(supply_by_resource.keys())
        over_allocations = []

        for res_id in all_resource_ids:
            resource = resource_map.get(res_id)
            dept_id, dept_name, cc_id, cc_name = self._resolve_dept_cc(resource=resource)
            demand = demand_by_resource.get(res_id, 0)
            supply = supply_by_resource.get(res_id, 0)
            gap = supply - demand

            dept_node = _ensure_dept(dept_id, dept_name)
            cc_node = _ensure_cc(dept_node, cc_id, cc_name)
            dept_node["total_demand_fte"] += demand
            dept_node["total_supply_fte"] += supply

            status = "balanced"
            if gap < 0:
                status = "under"
            elif gap > 0:
                status = "over"

            cc_node["resources"].append({
                "resource_id": res_id,
                "resource_name": resource.display_name if resource else "Unknown",
                "demand_fte": demand,
                "supply_fte": supply,
                "gap_fte": gap,
                "status": status,
            })

            if demand > 100:
                over_allocations.append({
                    "resource_id": res_id,
                    "resource_name": resource.display_name if resource else "Unknown",
                    "department_id": dept_id,
                    "department_name": dept_name,
                    "total_demand_fte": demand,
                })

        # -- Add placeholder rows --
        orphans_count = 0
        for od in placeholder_demands:
            ph = placeholder_map.get(od.placeholder_id)
            project = self.db.query(Project).filter(
                and_(Project.id == od.project_id, Project.tenant_id == self.current_user.tenant_id)
            ).first()

            dept_id, dept_name, cc_id, cc_name = self._resolve_dept_cc(placeholder=ph)
            dept_node = _ensure_dept(dept_id, dept_name)
            cc_node = _ensure_cc(dept_node, cc_id, cc_name)
            dept_node["total_demand_fte"] += od.fte_percent

            cc_node["placeholders"].append({
                "placeholder_id": od.placeholder_id,
                "placeholder_name": ph.name if ph else "Unknown",
                "demand_fte": od.fte_percent,
                "project_id": od.project_id,
                "project_name": project.name if project else "Unknown",
            })
            orphans_count += 1

        # -- Compute gap per department and flatten cost_centers dict -> list --
        departments_list = []
        total_demand = 0
        total_supply = 0
        for dept_node in dept_tree.values():
            dept_node["gap_fte"] = dept_node["total_supply_fte"] - dept_node["total_demand_fte"]
            dept_node["cost_centers"] = sorted(
                dept_node["cost_centers"].values(),
                key=lambda c: c["cost_center_name"],
            )
            total_demand += dept_node["total_demand_fte"]
            total_supply += dept_node["total_supply_fte"]
            departments_list.append(dept_node)

        departments_list.sort(key=lambda d: d["department_name"])

        return {
            "period_id": period_id,
            "period": f"{period.year}-{period.month:02d}",
            "summary": {
                "total_departments": len(departments_list),
                "total_demand_fte": total_demand,
                "total_supply_fte": total_supply,
                "total_gap_fte": total_supply - total_demand,
                "orphans_count": orphans_count,
                "over_allocations_count": len(over_allocations),
            },
            "departments": departments_list,
            "over_allocations": over_allocations,
        }
    
    def publish_snapshot(self, period_id: str, name: str, description: Optional[str] = None) -> PublishSnapshot:
        """
        Create an immutable snapshot of planning data for a period.
        """
        # Verify period exists
        period = self.db.query(Period).filter(
            and_(
                Period.id == period_id,
                Period.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        
        if not period:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Period not found"})
        
        # Create snapshot
        snapshot = PublishSnapshot(
            tenant_id=self.current_user.tenant_id,
            period_id=period_id,
            name=name,
            description=description,
            published_by=self.current_user.object_id,
        )
        self.db.add(snapshot)
        self.db.flush()
        
        # Copy demand lines
        demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
            )
        ).all()
        
        for d in demands:
            project = self.db.query(Project).filter(
                and_(Project.id == d.project_id, Project.tenant_id == self.current_user.tenant_id)
            ).first()
            resource = self.db.query(Resource).filter(
                and_(Resource.id == d.resource_id, Resource.tenant_id == self.current_user.tenant_id)
            ).first() if d.resource_id else None
            placeholder = self.db.query(Placeholder).filter(
                and_(Placeholder.id == d.placeholder_id, Placeholder.tenant_id == self.current_user.tenant_id)
            ).first() if d.placeholder_id else None
            
            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="demand",
                project_id=d.project_id,
                project_name=project.name if project else None,
                resource_id=d.resource_id,
                resource_name=resource.display_name if resource else None,
                placeholder_id=d.placeholder_id,
                placeholder_name=placeholder.name if placeholder else None,
                year=d.year,
                month=d.month,
                fte_percent=d.fte_percent,
            )
            self.db.add(line)
        
        # Copy supply lines
        supplies = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.period_id == period_id,
            )
        ).all()
        
        for s in supplies:
            resource = self.db.query(Resource).filter(
                and_(Resource.id == s.resource_id, Resource.tenant_id == self.current_user.tenant_id)
            ).first()
            
            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="supply",
                resource_id=s.resource_id,
                resource_name=resource.display_name if resource else None,
                year=s.year,
                month=s.month,
                fte_percent=s.fte_percent,
            )
            self.db.add(line)
        
        # Copy actual lines
        actuals = self.db.query(ActualLine).filter(
            and_(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.period_id == period_id,
            )
        ).all()
        
        for a in actuals:
            project = self.db.query(Project).filter(
                and_(Project.id == a.project_id, Project.tenant_id == self.current_user.tenant_id)
            ).first()
            resource = self.db.query(Resource).filter(
                and_(Resource.id == a.resource_id, Resource.tenant_id == self.current_user.tenant_id)
            ).first()
            
            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="actual",
                project_id=a.project_id,
                project_name=project.name if project else None,
                resource_id=a.resource_id,
                resource_name=resource.display_name if resource else None,
                year=a.year,
                month=a.month,
                fte_percent=a.actual_fte_percent,
            )
            self.db.add(line)
        
        # Copy OoP lines
        oops = self.db.query(OopLine).filter(
            and_(
                OopLine.tenant_id == self.current_user.tenant_id,
                OopLine.period_id == period_id,
            )
        ).all()
        
        for o in oops:
            project = self.db.query(Project).filter(
                and_(Project.id == o.project_id, Project.tenant_id == self.current_user.tenant_id)
            ).first()
            resource = self.db.query(Resource).filter(
                and_(Resource.id == o.resource_id, Resource.tenant_id == self.current_user.tenant_id)
            ).first()
            
            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="oop",
                project_id=o.project_id,
                project_name=project.name if project else None,
                resource_id=o.resource_id,
                resource_name=resource.display_name if resource else None,
                year=o.year,
                month=o.month,
                hours=o.hours,
                cost=o.total_cost,
            )
            self.db.add(line)
        
        self.db.commit()
        self.db.refresh(snapshot)
        
        log_audit(
            self.db, self.current_user,
            action="publish",
            entity_type="PublishSnapshot",
            entity_id=snapshot.id,
            new_values={
                "period_id": period_id,
                "name": name,
                "lines_count": len(snapshot.lines),
            }
        )
        
        return snapshot
    
    def get_snapshots(self, period_id: Optional[str] = None) -> List[PublishSnapshot]:
        """Get all snapshots, optionally filtered by period."""
        query = self.db.query(PublishSnapshot).filter(
            PublishSnapshot.tenant_id == self.current_user.tenant_id
        )
        
        if period_id:
            query = query.filter(PublishSnapshot.period_id == period_id)
        
        return query.order_by(PublishSnapshot.published_at.desc()).all()
    
    def get_snapshot(self, snapshot_id: str) -> Optional[PublishSnapshot]:
        """Get a specific snapshot with its lines."""
        return self.db.query(PublishSnapshot).filter(
            and_(
                PublishSnapshot.id == snapshot_id,
                PublishSnapshot.tenant_id == self.current_user.tenant_id,
            )
        ).first()
