"""Missing actuals detection service.

Identifies resources that have demand in a period but either have no actual
lines at all, or have at least one unsigned actual line (employee_signed_at IS NULL).

A resource is considered "fully signed" only when every one of its actual lines
for the period has employee_signed_at set. If any line is unsigned, the employee
receives a reminder.

Only resources with a linked user_id (i.e. a User account in the system) are
returned — there is no email address to send to otherwise.

Usage::

    service = MissingActualsService(db, tenant_id)
    missing = service.find_missing(year=2026, month=3)
    for m in missing:
        print(m.resource.display_name, "->", m.recipient.email)
"""
import logging
from dataclasses import dataclass
from typing import List

from sqlalchemy import func, and_, select
from sqlalchemy.orm import Session

from api.app.models.actuals import ActualLine
from api.app.models.core import Resource, User
from api.app.models.planning import DemandLine

logger = logging.getLogger(__name__)


@dataclass
class MissingActualsResult:
    """A resource whose actuals are absent or not fully signed for the period."""
    resource_id: str
    resource: Resource
    recipient: User  # The employee (resource.user_id → User)


class MissingActualsService:
    """Detect employees missing actuals for a tenant in a given period."""

    def __init__(self, db: Session, tenant_id: str) -> None:
        self._db = db
        self._tenant_id = tenant_id

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def find_missing(self, year: int, month: int) -> List[MissingActualsResult]:
        """Return resources with demand but without fully-signed actuals.

        Logic:
        1. Collect all resource_ids with demand lines this period.
        2. Collect resource_ids where ALL actual lines are signed (fully done).
        3. Difference = resources needing a reminder.
        4. Filter to those with a linked user_id (we need an email).
        """
        # Step 1 — resources with any demand this period
        demand_subq = (
            self._db.query(DemandLine.resource_id)
            .filter(
                and_(
                    DemandLine.tenant_id == self._tenant_id,
                    DemandLine.year == year,
                    DemandLine.month == month,
                    DemandLine.resource_id.isnot(None),
                )
            )
            .distinct()
            .subquery()
        )

        # Step 2 — resources whose every actual row is signed
        # (count of rows == count of non-null employee_signed_at)
        fully_signed_subq = (
            self._db.query(ActualLine.resource_id)
            .filter(
                and_(
                    ActualLine.tenant_id == self._tenant_id,
                    ActualLine.year == year,
                    ActualLine.month == month,
                )
            )
            .group_by(ActualLine.resource_id)
            .having(
                func.count(ActualLine.id)
                == func.count(ActualLine.employee_signed_at)
            )
            .subquery()
        )

        # Step 3+4 — demand - fully_signed, must have user_id
        resources = (
            self._db.query(Resource)
            .filter(
                and_(
                    Resource.tenant_id == self._tenant_id,
                    Resource.id.in_(select(demand_subq.c.resource_id)),
                    Resource.id.notin_(select(fully_signed_subq.c.resource_id)),
                    Resource.user_id.isnot(None),
                    Resource.is_active == True,
                )
            )
            .all()
        )

        if not resources:
            logger.info(
                "MissingActuals: no missing actuals for %d/%d (tenant=%s)",
                month,
                year,
                self._tenant_id,
            )
            return []

        # Batch-load linked User records
        user_ids = {r.user_id for r in resources}
        users = (
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
        user_map = {u.id: u for u in users}

        results: List[MissingActualsResult] = []
        for resource in resources:
            user = user_map.get(resource.user_id)
            if not user or not user.email:
                logger.debug(
                    "MissingActuals: resource %s has no active user with email, skipping",
                    resource.id,
                )
                continue
            results.append(
                MissingActualsResult(
                    resource_id=resource.id,
                    resource=resource,
                    recipient=user,
                )
            )

        logger.info(
            "MissingActuals: found %d resource(s) with missing actuals for %d/%d (tenant=%s)",
            len(results),
            month,
            year,
            self._tenant_id,
        )
        return results
