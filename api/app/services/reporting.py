"""Reporting service - manager hierarchy resolution and cache management."""
from collections import deque
from datetime import datetime
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import and_, delete

from api.app.models.core import ReportingCache, ManagerOverride, User, Resource, ResourceType
from api.app.auth.dependencies import CurrentUser


_MAX_DEPTH = 10  # Guard against org chart cycles


class ReportingService:
    """
    Resolves which resources an RO or Director may access based on
    the manager hierarchy stored in reporting_cache + manager_overrides.
    """

    def __init__(self, db: Session, current_user: CurrentUser):
        self.db = db
        self.current_user = current_user

    # ------------------------------------------------------------------
    # Hierarchy resolution
    # ------------------------------------------------------------------

    def get_subordinate_object_ids(self) -> set[str]:
        """
        Return all Entra object IDs of users who transitively report to
        the current user (any depth).

        Sources (unioned):
        1. reporting_cache rows where manager_object_id = current user
        2. active manager_override rows where manager_object_id = current user
        """
        tenant_id = self.current_user.tenant_id
        manager_oid = self.current_user.object_id

        cache_rows = self.db.query(ReportingCache.employee_object_id).filter(
            and_(
                ReportingCache.tenant_id == tenant_id,
                ReportingCache.manager_object_id == manager_oid,
            )
        ).all()

        override_rows = self.db.query(ManagerOverride.employee_object_id).filter(
            and_(
                ManagerOverride.tenant_id == tenant_id,
                ManagerOverride.manager_object_id == manager_oid,
                ManagerOverride.is_active.is_(True),
            )
        ).all()

        return {row[0] for row in cache_rows} | {row[0] for row in override_rows}

    def get_accessible_resource_ids(self) -> list[str]:
        """
        Resolve subordinate Entra object IDs → Resource IDs.

        Only Employee-type resources that are linked to a User (user_id IS NOT NULL)
        are considered — external/student/OOP resources are not owned by a reporting line.
        Falls back to CostCenter-based assignment when the reporting cache is empty.
        """
        subordinate_oids = self.get_subordinate_object_ids()

        if not subordinate_oids:
            # Fallback: resources in cost centers where this user is the RO/Director
            return self._get_cost_center_fallback_resource_ids()

        # Map object_ids → User.id
        users = self.db.query(User.id).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id.in_(subordinate_oids),
            )
        ).all()
        user_ids = [row[0] for row in users]

        if not user_ids:
            return []

        # Map User.id → Resource.id (Employee type only)
        resources = self.db.query(Resource.id).filter(
            and_(
                Resource.tenant_id == self.current_user.tenant_id,
                Resource.user_id.in_(user_ids),
                Resource.resource_type == ResourceType.EMPLOYEE,
                Resource.is_active.is_(True),
            )
        ).all()

        return [row[0] for row in resources]

    def _get_cost_center_fallback_resource_ids(self) -> list[str]:
        """
        Return resource IDs for all resources in cost centers managed by this user
        (ro_user_id or director_user_id = current user's DB id).
        Used when reporting_cache is empty (e.g. before first sync).
        """
        from api.app.models.core import CostCenter

        user = self.db.query(User).filter(
            and_(
                User.tenant_id == self.current_user.tenant_id,
                User.object_id == self.current_user.object_id,
            )
        ).first()
        if not user:
            return []

        cost_centers = self.db.query(CostCenter.id).filter(
            and_(
                CostCenter.tenant_id == self.current_user.tenant_id,
                CostCenter.is_active.is_(True),
                (CostCenter.ro_user_id == user.id) | (CostCenter.director_user_id == user.id),
            )
        ).all()
        cc_ids = [row[0] for row in cost_centers]
        if not cc_ids:
            return []

        resources = self.db.query(Resource.id).filter(
            and_(
                Resource.tenant_id == self.current_user.tenant_id,
                Resource.cost_center_id.in_(cc_ids),
                Resource.is_active.is_(True),
            )
        ).all()
        return [row[0] for row in resources]

    def assert_resource_accessible(self, resource_id: str) -> None:
        """Raise 403 if the given resource is not in the current user's reporting scope."""
        accessible = self.get_accessible_resource_ids()
        if resource_id not in accessible:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "UNAUTHORIZED_RESOURCE",
                    "message": "You do not have access to records for this employee.",
                },
            )

    # ------------------------------------------------------------------
    # Cache rebuild
    # ------------------------------------------------------------------

    @staticmethod
    def rebuild_cache_for_tenant(tenant_id: str, db: Session) -> int:
        """
        Rebuild reporting_cache for a tenant by BFS over User.manager_object_id
        values already stored in the DB.

        Returns the number of rows written.
        """
        # Load all users for this tenant that have a manager set
        users = db.query(User.object_id, User.manager_object_id).filter(
            and_(
                User.tenant_id == tenant_id,
                User.is_active.is_(True),
            )
        ).all()

        # Build adjacency: manager_oid → list of direct report oids
        subordinates_of: dict[str, list[str]] = {}
        all_oids: set[str] = set()
        for oid, manager_oid in users:
            all_oids.add(oid)
            if manager_oid:
                subordinates_of.setdefault(manager_oid, []).append(oid)

        # For each manager that has at least one direct report, BFS outward
        rows: list[dict] = []
        seen_pairs: set[tuple[str, str]] = set()  # (employee_oid, manager_oid)
        now = datetime.utcnow()

        for manager_oid in list(subordinates_of.keys()):
            # BFS from this manager downward
            queue: deque[tuple[str, int]] = deque()
            for direct in subordinates_of.get(manager_oid, []):
                queue.append((direct, 1))

            while queue:
                employee_oid, depth = queue.popleft()
                if depth > _MAX_DEPTH:
                    continue
                pair = (employee_oid, manager_oid)
                if pair in seen_pairs:
                    continue
                seen_pairs.add(pair)
                rows.append({
                    "tenant_id": tenant_id,
                    "employee_object_id": employee_oid,
                    "manager_object_id": manager_oid,
                    "depth": depth,
                    "source": "graph",
                    "synced_at": now,
                })
                # Recurse into this employee's subordinates
                for sub in subordinates_of.get(employee_oid, []):
                    queue.append((sub, depth + 1))

        # Replace existing cache rows for this tenant
        db.execute(
            delete(ReportingCache).where(ReportingCache.tenant_id == tenant_id)
        )

        if rows:
            from api.app.models.core import generate_uuid
            for row in rows:
                row["id"] = generate_uuid()
            db.bulk_insert_mappings(ReportingCache, rows)

        db.commit()
        return len(rows)

    # ------------------------------------------------------------------
    # Manager Override CRUD (Admin)
    # ------------------------------------------------------------------

    def list_overrides(self) -> list[ManagerOverride]:
        return self.db.query(ManagerOverride).filter(
            ManagerOverride.tenant_id == self.current_user.tenant_id
        ).order_by(ManagerOverride.created_at.desc()).all()

    def create_override(
        self,
        employee_object_id: str,
        manager_object_id: str,
        note: Optional[str] = None,
    ) -> ManagerOverride:
        existing = self.db.query(ManagerOverride).filter(
            and_(
                ManagerOverride.tenant_id == self.current_user.tenant_id,
                ManagerOverride.employee_object_id == employee_object_id,
                ManagerOverride.manager_object_id == manager_object_id,
            )
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "CONFLICT",
                    "message": "An override for this employee/manager pair already exists.",
                },
            )
        override = ManagerOverride(
            tenant_id=self.current_user.tenant_id,
            employee_object_id=employee_object_id,
            manager_object_id=manager_object_id,
            is_active=True,
            note=note,
            created_at=datetime.utcnow(),
            created_by=self.current_user.object_id,
        )
        self.db.add(override)
        self.db.commit()
        self.db.refresh(override)
        return override

    def patch_override(self, override_id: str, is_active: Optional[bool], note: Optional[str]) -> ManagerOverride:
        override = self.db.query(ManagerOverride).filter(
            and_(
                ManagerOverride.id == override_id,
                ManagerOverride.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not override:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Override not found"},
            )
        if is_active is not None:
            override.is_active = is_active
        if note is not None:
            override.note = note
        self.db.commit()
        self.db.refresh(override)
        return override

    def delete_override(self, override_id: str) -> None:
        override = self.db.query(ManagerOverride).filter(
            and_(
                ManagerOverride.id == override_id,
                ManagerOverride.tenant_id == self.current_user.tenant_id,
            )
        ).first()
        if not override:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NOT_FOUND", "message": "Override not found"},
            )
        self.db.delete(override)
        self.db.commit()

    def get_reporting_chain(self, manager_object_id: str) -> list[dict]:
        """Preview all subordinates (any depth) for a given manager object ID."""
        rows = self.db.query(ReportingCache).filter(
            and_(
                ReportingCache.tenant_id == self.current_user.tenant_id,
                ReportingCache.manager_object_id == manager_object_id,
            )
        ).order_by(ReportingCache.depth).all()

        overrides = self.db.query(ManagerOverride).filter(
            and_(
                ManagerOverride.tenant_id == self.current_user.tenant_id,
                ManagerOverride.manager_object_id == manager_object_id,
                ManagerOverride.is_active.is_(True),
            )
        ).all()

        result = [
            {"employee_object_id": r.employee_object_id, "depth": r.depth, "source": r.source}
            for r in rows
        ] + [
            {"employee_object_id": o.employee_object_id, "depth": 1, "source": "override"}
            for o in overrides
        ]
        return result
