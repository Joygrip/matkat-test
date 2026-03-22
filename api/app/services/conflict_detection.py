"""Conflict detection service — demand > supply per resource per period.

Identifies resources where the total FTE demand across all projects exceeds
the total FTE supply offered by the RO. For each conflict it resolves the
recipients who should be notified:

  - RO:  the Resource Owner of the resource's cost center
  - PMs: all Project Managers who have demand lines for that resource

Usage::

    service = ConflictDetectionService(db, tenant_id)
    conflicts = service.find_conflicts(year=2026, month=3)
    for c in conflicts:
        print(c.resource.display_name, c.total_demand, c.total_supply)
        print("RO:", c.ro_recipient)
        print("PMs:", c.pm_recipients)
"""
import logging
from dataclasses import dataclass, field
from typing import List, Optional

from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from api.app.models.core import CostCenter, Project, Resource, User
from api.app.models.planning import DemandLine, SupplyLine

logger = logging.getLogger(__name__)


@dataclass
class ConflictResult:
    """A resource whose total demand exceeds total supply for a period."""
    resource_id: str
    resource: Resource
    total_demand: int
    total_supply: int
    ro_recipient: Optional[User]
    pm_recipients: List[User] = field(default_factory=list)


class ConflictDetectionService:
    """Detect FTE demand/supply conflicts for a tenant in a given period."""

    def __init__(self, db: Session, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def find_conflicts(self, year: int, month: int) -> List[ConflictResult]:
        """Return all resources with total_demand > total_supply for the period.

        Placeholder demand lines (resource_id IS NULL) are excluded — only
        real resource conflicts are reported.
        """
        raw = self._query_conflicts(year, month)
        if not raw:
            return []

        resource_ids = [r.resource_id for r in raw]

        # Batch-load resources with cost centers to avoid N+1
        resources = self._load_resources(resource_ids)
        if not resources:
            return []

        # Batch-load RO users for all affected cost centers
        cc_ids = {r.cost_center_id for r in resources.values()}
        cost_centers = self._load_cost_centers(cc_ids)
        ro_user_ids = {
            cc.ro_user_id for cc in cost_centers.values() if cc.ro_user_id
        }

        # Batch-load PM users for all demand lines across affected resources
        pm_by_resource = self._load_pm_recipients(resource_ids, year, month)

        # Batch-load all RO users in one query
        ro_users = self._load_users(ro_user_ids)

        results: List[ConflictResult] = []
        for row in raw:
            resource = resources.get(row.resource_id)
            if not resource:
                logger.warning(
                    "ConflictDetection: resource %s not found, skipping",
                    row.resource_id,
                )
                continue

            cc = cost_centers.get(resource.cost_center_id)
            ro_recipient = (
                ro_users.get(cc.ro_user_id) if cc and cc.ro_user_id else None
            )

            results.append(
                ConflictResult(
                    resource_id=row.resource_id,
                    resource=resource,
                    total_demand=int(row.total_demand),
                    total_supply=int(row.total_supply),
                    ro_recipient=ro_recipient,
                    pm_recipients=pm_by_resource.get(row.resource_id, []),
                )
            )

        logger.info(
            "ConflictDetection: found %d conflict(s) for %d/%d (tenant=%s)",
            len(results),
            month,
            year,
            self._tenant_id,
        )
        return results

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _query_conflicts(self, year: int, month: int):
        """Run the aggregation query and return rows with resource_id, total_demand, total_supply."""
        demand_agg = (
            self._db.query(
                DemandLine.resource_id,
                func.sum(DemandLine.fte_percent).label("total_demand"),
            )
            .filter(
                and_(
                    DemandLine.tenant_id == self._tenant_id,
                    DemandLine.year == year,
                    DemandLine.month == month,
                    DemandLine.resource_id.isnot(None),
                )
            )
            .group_by(DemandLine.resource_id)
            .subquery()
        )

        supply_agg = (
            self._db.query(
                SupplyLine.resource_id,
                func.sum(SupplyLine.fte_percent).label("total_supply"),
            )
            .filter(
                and_(
                    SupplyLine.tenant_id == self._tenant_id,
                    SupplyLine.year == year,
                    SupplyLine.month == month,
                )
            )
            .group_by(SupplyLine.resource_id)
            .subquery()
        )

        total_supply_col = func.coalesce(supply_agg.c.total_supply, 0)
        return (
            self._db.query(
                demand_agg.c.resource_id,
                demand_agg.c.total_demand,
                total_supply_col.label("total_supply"),
            )
            .outerjoin(supply_agg, demand_agg.c.resource_id == supply_agg.c.resource_id)
            # Use filter (WHERE) not having — outer query is not an aggregate
            .filter(demand_agg.c.total_demand > total_supply_col)
            .all()
        )

    def _load_resources(self, resource_ids: List[str]) -> dict:
        rows = (
            self._db.query(Resource)
            .filter(
                and_(
                    Resource.tenant_id == self._tenant_id,
                    Resource.id.in_(resource_ids),
                )
            )
            .all()
        )
        return {r.id: r for r in rows}

    def _load_cost_centers(self, cc_ids: set) -> dict:
        if not cc_ids:
            return {}
        rows = (
            self._db.query(CostCenter)
            .filter(CostCenter.id.in_(cc_ids))
            .all()
        )
        return {cc.id: cc for cc in rows}

    def _load_pm_recipients(
        self, resource_ids: List[str], year: int, month: int
    ) -> dict:
        """Return {resource_id: [User, ...]} for all distinct PMs per resource."""
        demand_rows = (
            self._db.query(
                DemandLine.resource_id,
                DemandLine.project_id,
            )
            .filter(
                and_(
                    DemandLine.tenant_id == self._tenant_id,
                    DemandLine.year == year,
                    DemandLine.month == month,
                    DemandLine.resource_id.in_(resource_ids),
                )
            )
            .distinct()
            .all()
        )

        # resource_id → set of project_ids
        project_by_resource: dict = {}
        all_project_ids = set()
        for row in demand_rows:
            project_by_resource.setdefault(row.resource_id, set()).add(row.project_id)
            all_project_ids.add(row.project_id)

        if not all_project_ids:
            return {}

        # Batch-load projects
        projects = (
            self._db.query(Project)
            .filter(Project.id.in_(all_project_ids))
            .all()
        )
        project_map = {p.id: p for p in projects}

        pm_user_ids = {p.pm_user_id for p in projects if p.pm_user_id}
        pm_users = self._load_users(pm_user_ids)

        result: dict = {}
        for resource_id, proj_ids in project_by_resource.items():
            seen = set()
            pm_list = []
            for pid in proj_ids:
                project = project_map.get(pid)
                if project and project.pm_user_id and project.pm_user_id not in seen:
                    user = pm_users.get(project.pm_user_id)
                    if user:
                        pm_list.append(user)
                        seen.add(project.pm_user_id)
            result[resource_id] = pm_list

        return result

    def _load_users(self, user_ids: set) -> dict:
        if not user_ids:
            return {}
        rows = (
            self._db.query(User)
            .filter(
                and_(
                    User.tenant_id == self._tenant_id,
                    User.id.in_(user_ids),
                    User.is_active == True,
                )
            )
            .all()
        )
        return {u.id: u for u in rows}
