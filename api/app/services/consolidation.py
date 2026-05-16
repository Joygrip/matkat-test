"""Consolidation service - dashboard and publishing."""
from collections import defaultdict
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from api.app.models.core import Period, Project, Resource, Placeholder, CostCenter, User, ApprovalDelegate
from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.actuals import ActualLine
from api.app.models.consolidation import PublishSnapshot, PublishSnapshotLine
from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine
from api.app.auth.dependencies import CurrentUser
from api.app.services.audit import log_audit
from api.app.services.period import PeriodService


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

    def _resolve_cc(self, resource: Optional["Resource"] = None,
                    placeholder: Optional["Placeholder"] = None):
        """Return (cc_id, cc_name) from resource or placeholder."""
        if resource and resource.cost_center:
            return (resource.cost_center.id, resource.cost_center.name)
        if placeholder and placeholder.cost_center:
            return (placeholder.cost_center_id, placeholder.cost_center.name)
        return (None, "Unassigned")

    # ------------------------------------------------------------------ dashboard
    def get_dashboard(self, period_id: str) -> Dict[str, Any]:
        """
        Get consolidation dashboard data for a period, grouped by cost center.

        Returns a cost-center list with per-resource/placeholder breakdowns
        plus flat over-allocations for quick scanning.
        """
        period = PeriodService(self.db, self.current_user).get_by_id(period_id)

        if not period:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Period not found"})

        resource_map = self._load_resource_map()
        placeholder_map = self._load_placeholder_map()

        demand_by_resource: Dict[str, int] = defaultdict(int)
        demand_by_resource_project: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        resource_project_ids: Dict[str, set] = defaultdict(set)
        resource_demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.resource_id.isnot(None),
            )
        ).all()
        for d in resource_demands:
            demand_by_resource[d.resource_id] += d.fte_percent
            resource_project_ids[d.resource_id].add(d.project_id)
            if d.project_id:
                demand_by_resource_project[d.resource_id][d.project_id] += d.fte_percent

        supply_by_resource: Dict[str, int] = defaultdict(int)
        supply_by_resource_project: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        supply_general_by_resource: Dict[str, int] = defaultdict(int)
        supplies = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.period_id == period_id,
            )
        ).all()
        for s in supplies:
            supply_by_resource[s.resource_id] += s.fte_percent
            if s.project_id:
                supply_by_resource_project[s.resource_id][s.project_id] += s.fte_percent
            else:
                supply_general_by_resource[s.resource_id] += s.fte_percent

        # Batch-load project names for per-resource/per-project allocation breakdown
        _res_proj_ids: set = set()
        for pids in resource_project_ids.values():
            _res_proj_ids.update(pids)
        for proj_dict in supply_by_resource_project.values():
            _res_proj_ids.update(proj_dict.keys())
        _res_proj_ids.discard(None)
        res_project_name_map: Dict[str, str] = {}
        if _res_proj_ids:
            res_project_name_map = {
                p.id: p.name for p in self.db.query(Project).filter(
                    Project.id.in_(_res_proj_ids),
                    Project.tenant_id == self.current_user.tenant_id,
                ).all()
            }

        placeholder_demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.placeholder_id.isnot(None),
            )
        ).all()

        # Build cost_center_id -> { info, resources[], placeholders[] }
        cc_tree: Dict[str, Dict[str, Any]] = {}

        def _ensure_cc(cc_id, cc_name):
            key = cc_id or "__none__"
            if key not in cc_tree:
                cc_tree[key] = {
                    "cost_center_id": cc_id,
                    "cost_center_name": cc_name or "Unassigned",
                    "total_demand_fte": 0,
                    "total_supply_fte": 0,
                    "gap_fte": 0,
                    "project_ids": set(),
                    "resources": [],
                    "placeholders": [],
                }
            return cc_tree[key]

        over_allocations = []
        all_resource_ids = set(demand_by_resource.keys()) | set(supply_by_resource.keys())

        for res_id in all_resource_ids:
            resource = resource_map.get(res_id)
            cc_id, cc_name = self._resolve_cc(resource=resource)
            demand = demand_by_resource.get(res_id, 0)
            supply = supply_by_resource.get(res_id, 0)
            gap = supply - demand

            cc_node = _ensure_cc(cc_id, cc_name)
            cc_node["total_demand_fte"] += demand
            cc_node["total_supply_fte"] += supply
            cc_node["project_ids"].update(resource_project_ids.get(res_id, set()))

            status = "balanced"
            if gap < 0:
                status = "under"
            elif gap > 0:
                status = "over"

            res_demand_proj = demand_by_resource_project.get(res_id, {})
            res_supply_proj = supply_by_resource_project.get(res_id, {})
            res_supply_gen = supply_general_by_resource.get(res_id, 0)
            all_proj_ids = set(res_demand_proj.keys()) | set(res_supply_proj.keys())
            project_allocations = [
                {
                    "project_id": pid,
                    "project_name": res_project_name_map.get(pid, "Unknown"),
                    "demand_fte": res_demand_proj.get(pid, 0),
                    "supply_fte": res_supply_proj.get(pid, 0),
                }
                for pid in sorted(all_proj_ids)
            ]
            if res_supply_gen > 0:
                project_allocations.append({
                    "project_id": None,
                    "project_name": "General availability",
                    "demand_fte": 0,
                    "supply_fte": res_supply_gen,
                })

            cc_node["resources"].append({
                "resource_id": res_id,
                "resource_name": resource.display_name if resource else "Unknown",
                "initials": resource.initials if resource else None,
                "demand_fte": demand,
                "supply_fte": supply,
                "gap_fte": gap,
                "status": status,
                "project_allocations": project_allocations,
            })

            if demand > 100:
                over_allocations.append({
                    "resource_id": res_id,
                    "resource_name": resource.display_name if resource else "Unknown",
                    "cost_center_id": cc_id,
                    "cost_center_name": cc_name,
                    "total_demand_fte": demand,
                })

        # Batch-load all projects referenced by placeholder demands in one query.
        _ph_project_ids = {od.project_id for od in placeholder_demands if od.project_id}
        ph_project_map: Dict[str, Project] = {}
        if _ph_project_ids:
            ph_project_map = {
                p.id: p for p in self.db.query(Project).filter(
                    Project.id.in_(_ph_project_ids),
                    Project.tenant_id == self.current_user.tenant_id,
                ).all()
            }

        orphans_count = 0
        for od in placeholder_demands:
            ph = placeholder_map.get(od.placeholder_id)
            project = ph_project_map.get(od.project_id)

            cc_id, cc_name = self._resolve_cc(placeholder=ph)
            cc_node = _ensure_cc(cc_id, cc_name)
            cc_node["total_demand_fte"] += od.fte_percent

            cc_node["project_ids"].add(od.project_id)
            cc_node["placeholders"].append({
                "placeholder_id": od.placeholder_id,
                "placeholder_name": ph.name if ph else "Unknown",
                "demand_fte": od.fte_percent,
                "project_id": od.project_id,
                "project_name": project.name if project else "Unknown",
            })
            orphans_count += 1

        cost_centers_list = []
        total_demand = 0
        total_supply = 0
        for cc_node in cc_tree.values():
            cc_node["gap_fte"] = cc_node["total_supply_fte"] - cc_node["total_demand_fte"]
            cc_node["project_ids"] = list(cc_node["project_ids"])
            total_demand += cc_node["total_demand_fte"]
            total_supply += cc_node["total_supply_fte"]
            cost_centers_list.append(cc_node)

        cost_centers_list.sort(key=lambda c: c["cost_center_name"] or "")

        # Manager restriction: filter to cost centers they manage (ro_user_id or director_user_id)
        # Also include cost centers of any delegators who have granted this manager delegation
        # Manager+Reader combo users (is_manager_reader) bypass this filter to see the full org.
        if self.current_user.role == "Manager" and not self.current_user.is_manager_reader:
            manager_user = self.db.query(User).filter(
                and_(
                    User.tenant_id == self.current_user.tenant_id,
                    User.object_id == self.current_user.object_id,
                )
            ).first()
            if manager_user:
                managed_cc_ids = {
                    row[0] for row in self.db.query(CostCenter.id).filter(
                        and_(
                            CostCenter.tenant_id == self.current_user.tenant_id,
                            CostCenter.is_active == True,
                            (CostCenter.ro_user_id == manager_user.id) | (CostCenter.director_user_id == manager_user.id),
                        )
                    ).all()
                }
                # Add cost centers managed by delegators who granted this manager delegation
                delegation_grants = self.db.query(ApprovalDelegate).filter(
                    and_(
                        ApprovalDelegate.tenant_id == self.current_user.tenant_id,
                        ApprovalDelegate.delegate_id == manager_user.id,
                        ApprovalDelegate.is_active == True,
                    )
                ).all()
                for grant in delegation_grants:
                    delegated_cc_ids = {
                        row[0] for row in self.db.query(CostCenter.id).filter(
                            and_(
                                CostCenter.tenant_id == self.current_user.tenant_id,
                                CostCenter.is_active == True,
                                (CostCenter.ro_user_id == grant.delegator_id) | (CostCenter.director_user_id == grant.delegator_id),
                            )
                        ).all()
                    }
                    managed_cc_ids |= delegated_cc_ids
            else:
                managed_cc_ids = set()
            cost_centers_list = [cc for cc in cost_centers_list if cc["cost_center_id"] in managed_cc_ids]
            over_allocations = [oa for oa in over_allocations if oa["cost_center_id"] in managed_cc_ids]
            # Recompute summary totals from filtered list
            total_demand = sum(cc["total_demand_fte"] for cc in cost_centers_list)
            total_supply = sum(cc["total_supply_fte"] for cc in cost_centers_list)
            orphans_count = sum(len(cc["placeholders"]) for cc in cost_centers_list)

        return {
            "period_id": period_id,
            "period": f"{period.year}-{period.month:02d}",
            "summary": {
                "total_cost_centers": len(cost_centers_list),
                "total_demand_fte": total_demand,
                "total_supply_fte": total_supply,
                "total_gap_fte": total_supply - total_demand,
                "orphans_count": orphans_count,
                "over_allocations_count": len(over_allocations),
            },
            "cost_centers": cost_centers_list,
            "over_allocations": over_allocations,
        }
    
    def publish_snapshot(self, period_id: str, name: str, description: Optional[str] = None) -> PublishSnapshot:
        """
        Create an immutable snapshot of planning data for a period.
        """
        # Verify period exists
        period = PeriodService(self.db, self.current_user).get_by_id(period_id)
        
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

        # Copy supply lines
        supplies = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.period_id == period_id,
            )
        ).all()

        # Copy actual lines — approved only
        from api.app.models.approvals import ApprovalInstance, ApprovalStatus
        latest_actual_subq = (
            self.db.query(
                ApprovalInstance.subject_id.label("actual_id"),
                func.max(ApprovalInstance.created_at).label("max_created"),
            )
            .filter(
                ApprovalInstance.subject_type == "actuals",
                ApprovalInstance.tenant_id == self.current_user.tenant_id,
            )
            .group_by(ApprovalInstance.subject_id)
            .subquery()
        )
        approved_actual_ids_subq = (
            self.db.query(ApprovalInstance.subject_id)
            .join(latest_actual_subq, and_(
                ApprovalInstance.subject_id == latest_actual_subq.c.actual_id,
                ApprovalInstance.created_at == latest_actual_subq.c.max_created,
                ApprovalInstance.subject_type == "actuals",
            ))
            .filter(ApprovalInstance.status == ApprovalStatus.APPROVED)
            .subquery()
        )
        actuals = self.db.query(ActualLine).filter(
            and_(
                ActualLine.tenant_id == self.current_user.tenant_id,
                ActualLine.period_id == period_id,
                ActualLine.id.in_(approved_actual_ids_subq),
            )
        ).all()

        # Copy OoP lines
        oops = self.db.query(ProjectExternalLine).filter(
            and_(
                ProjectExternalLine.tenant_id == self.current_user.tenant_id,
                ProjectExternalLine.period_id == period_id,
            )
        ).all()

        # Copy equipment lines
        equips = self.db.query(ProjectEquipmentLine).filter(
            and_(
                ProjectEquipmentLine.tenant_id == self.current_user.tenant_id,
                ProjectEquipmentLine.period_id == period_id,
            )
        ).all()

        # Batch-load all referenced entities in 3 queries instead of one-per-line.
        # Avoids N+1 queries when iterating demand/supply/actual/oop lines below.
        _project_ids = (
            {d.project_id for d in demands if d.project_id}
            | {a.project_id for a in actuals if a.project_id}
            | {o.project_id for o in oops if o.project_id}
            | {e.project_id for e in equips if e.project_id}
        )
        _resource_ids = (
            {d.resource_id for d in demands if d.resource_id}
            | {s.resource_id for s in supplies if s.resource_id}
            | {a.resource_id for a in actuals if a.resource_id}
            | {o.resource_id for o in oops if o.resource_id}  # resource_id optional on ProjectExternalLine
        )
        _placeholder_ids = {d.placeholder_id for d in demands if d.placeholder_id}

        snap_project_map: Dict[str, Project] = {}
        if _project_ids:
            snap_project_map = {
                p.id: p for p in self.db.query(Project).filter(
                    Project.id.in_(_project_ids),
                    Project.tenant_id == self.current_user.tenant_id,
                ).all()
            }
        snap_resource_map: Dict[str, Resource] = {}
        if _resource_ids:
            snap_resource_map = {
                r.id: r for r in self.db.query(Resource).filter(
                    Resource.id.in_(_resource_ids),
                    Resource.tenant_id == self.current_user.tenant_id,
                ).all()
            }
        snap_placeholder_map: Dict[str, Placeholder] = {}
        if _placeholder_ids:
            snap_placeholder_map = {
                p.id: p for p in self.db.query(Placeholder).filter(
                    Placeholder.id.in_(_placeholder_ids),
                    Placeholder.tenant_id == self.current_user.tenant_id,
                ).all()
            }

        for d in demands:
            project = snap_project_map.get(d.project_id)
            resource = snap_resource_map.get(d.resource_id) if d.resource_id else None
            placeholder = snap_placeholder_map.get(d.placeholder_id) if d.placeholder_id else None
            cc_id, cc_name = self._resolve_cc(resource=resource, placeholder=placeholder)

            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="demand",
                project_id=d.project_id,
                project_name=project.name if project else None,
                resource_id=d.resource_id,
                resource_name=resource.display_name if resource else None,
                placeholder_id=d.placeholder_id,
                placeholder_name=placeholder.name if placeholder else None,
                cost_center_id=cc_id,
                cost_center_name=cc_name,
                year=d.year,
                month=d.month,
                fte_percent=d.fte_percent,
            )
            self.db.add(line)

        for s in supplies:
            resource = snap_resource_map.get(s.resource_id) if s.resource_id else None
            cc_id, cc_name = self._resolve_cc(resource=resource)

            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="supply",
                resource_id=s.resource_id,
                resource_name=resource.display_name if resource else None,
                cost_center_id=cc_id,
                cost_center_name=cc_name,
                year=s.year,
                month=s.month,
                fte_percent=s.fte_percent,
            )
            self.db.add(line)

        for a in actuals:
            project = snap_project_map.get(a.project_id)
            resource = snap_resource_map.get(a.resource_id) if a.resource_id else None
            cc_id, cc_name = self._resolve_cc(resource=resource)

            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="actual",
                project_id=a.project_id,
                project_name=project.name if project else None,
                resource_id=a.resource_id,
                resource_name=resource.display_name if resource else None,
                cost_center_id=cc_id,
                cost_center_name=cc_name,
                year=a.year,
                month=a.month,
                fte_percent=a.actual_fte_percent,
            )
            self.db.add(line)

        for o in oops:
            project = snap_project_map.get(o.project_id)
            resource = snap_resource_map.get(o.resource_id) if o.resource_id else None
            cc_id, cc_name = self._resolve_cc(resource=resource)

            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="oop",
                project_id=o.project_id,
                project_name=project.name if project else None,
                resource_id=o.resource_id,
                resource_name=resource.display_name if resource else o.description,
                placeholder_id=None,
                placeholder_name=None,
                cost_center_id=cc_id,
                cost_center_name=cc_name,
                year=period.year,
                month=period.month,
                fte_percent=None,
                hours=None,
                cost=o.cost,
            )
            self.db.add(line)

        for e in equips:
            project = snap_project_map.get(e.project_id)

            line = PublishSnapshotLine(
                snapshot_id=snapshot.id,
                line_type="equipment",
                project_id=e.project_id,
                project_name=project.name if project else None,
                resource_id=None,
                resource_name=e.description,
                placeholder_id=None,
                placeholder_name=None,
                cost_center_id=None,
                cost_center_name=None,
                year=period.year,
                month=period.month,
                fte_percent=None,
                hours=None,
                cost=e.cost,
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

    # ------------------------------------------------------------------ resource detail
    def get_resource_detail(self, period_id: str, resource_id: str) -> Dict[str, Any]:
        """
        Get per-assignment demand and supply breakdown for a single resource in a period.
        """
        period = PeriodService(self.db, self.current_user).get_by_id(period_id)
        if not period:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Period not found"})

        resource = self.db.query(Resource).filter(
            and_(
                Resource.id == resource_id,
                Resource.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not resource:
            raise HTTPException(status_code=404, detail={"code": "NOT_FOUND", "message": "Resource not found"})

        demand_lines = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.resource_id == resource_id,
            )
        ).all()

        supply_lines = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.period_id == period_id,
                SupplyLine.resource_id == resource_id,
            )
        ).all()

        # Batch-load projects referenced by demand lines
        demand_project_ids = [d.project_id for d in demand_lines if d.project_id]
        supply_project_ids = [s.project_id for s in supply_lines if s.project_id]
        all_project_ids = list(set(demand_project_ids + supply_project_ids))
        if all_project_ids:
            projects = self.db.query(Project).filter(
                and_(
                    Project.id.in_(all_project_ids),
                    Project.tenant_id == self.current_user.tenant_id,
                )
            ).all()
            project_map = {p.id: p for p in projects}
        else:
            project_map = {}

        demand_result = []
        for d in demand_lines:
            project = project_map.get(d.project_id)
            demand_result.append({
                "project_id": d.project_id,
                "project_name": project.name if project else "Unknown",
                "fte_percent": d.fte_percent,
            })
        demand_result.sort(key=lambda x: x["project_name"])

        supply_result = []
        for s in supply_lines:
            project = project_map.get(s.project_id) if s.project_id else None
            supply_result.append({
                "project_id": s.project_id,
                "project_name": project.name if project else None,
                "fte_percent": s.fte_percent,
            })
        supply_result.sort(key=lambda x: x["project_name"] or "")

        total_demand = sum(d["fte_percent"] for d in demand_result)
        total_supply = sum(s["fte_percent"] for s in supply_result)

        return {
            "resource_id": resource_id,
            "resource_name": resource.display_name,
            "period_id": period_id,
            "demand_lines": demand_result,
            "supply_lines": supply_result,
            "total_demand_fte": total_demand,
            "total_supply_fte": total_supply,
            "gap_fte": total_supply - total_demand,
        }

