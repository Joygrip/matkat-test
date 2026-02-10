"""Consolidation service - dashboard and publishing."""
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_, func

from api.app.models.core import Period, Project, Resource, Placeholder
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
    
    def get_dashboard(self, period_id: str) -> Dict[str, Any]:
        """
        Get consolidation dashboard data for a period.
        
        Shows:
        - Demand vs supply gaps
        - Orphan demand (unassigned to resources)
        - Over-allocation flags
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
        
        # Get demand totals by resource
        demand_by_resource = {}
        demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.resource_id.isnot(None),
            )
        ).all()
        
        for d in demands:
            key = (d.resource_id, d.year, d.month)
            if key not in demand_by_resource:
                demand_by_resource[key] = 0
            demand_by_resource[key] += d.fte_percent
        
        # Get supply totals by resource
        supply_by_resource = {}
        supplies = self.db.query(SupplyLine).filter(
            and_(
                SupplyLine.tenant_id == self.current_user.tenant_id,
                SupplyLine.period_id == period_id,
            )
        ).all()
        
        for s in supplies:
            key = (s.resource_id, s.year, s.month)
            supply_by_resource[key] = s.fte_percent
        
        # Calculate gaps (supply - demand)
        gaps = []
        all_keys = set(demand_by_resource.keys()) | set(supply_by_resource.keys())
        
        for key in all_keys:
            resource_id, year, month = key
            demand = demand_by_resource.get(key, 0)
            supply = supply_by_resource.get(key, 0)
            gap = supply - demand
            
            if gap != 0:
                resource = self.db.query(Resource).filter(Resource.id == resource_id).first()
                gaps.append({
                    "resource_id": resource_id,
                    "resource_name": resource.display_name if resource else "Unknown",
                    "year": year,
                    "month": month,
                    "demand_fte": demand,
                    "supply_fte": supply,
                    "gap_fte": gap,
                    "status": "under" if gap < 0 else "over",
                })
        
        # Find orphan demand (placeholder assignments)
        orphan_demands = self.db.query(DemandLine).filter(
            and_(
                DemandLine.tenant_id == self.current_user.tenant_id,
                DemandLine.period_id == period_id,
                DemandLine.placeholder_id.isnot(None),
            )
        ).all()
        
        orphans = []
        for od in orphan_demands:
            placeholder = self.db.query(Placeholder).filter(Placeholder.id == od.placeholder_id).first()
            project = self.db.query(Project).filter(Project.id == od.project_id).first()
            orphans.append({
                "demand_line_id": od.id,
                "project_id": od.project_id,
                "project_name": project.name if project else "Unknown",
                "placeholder_id": od.placeholder_id,
                "placeholder_name": placeholder.name if placeholder else "Unknown",
                "year": od.year,
                "month": od.month,
                "fte_percent": od.fte_percent,
            })
        
        # Find over-allocations (total > 100%)
        over_allocations = []
        for key, demand in demand_by_resource.items():
            if demand > 100:
                resource_id, year, month = key
                resource = self.db.query(Resource).filter(Resource.id == resource_id).first()
                over_allocations.append({
                    "resource_id": resource_id,
                    "resource_name": resource.display_name if resource else "Unknown",
                    "year": year,
                    "month": month,
                    "total_demand_fte": demand,
                })
        
        return {
            "period_id": period_id,
            "period": f"{period.year}-{period.month:02d}",
            "gaps": sorted(gaps, key=lambda x: (x["year"], x["month"], x["resource_name"])),
            "orphan_demands": orphans,
            "over_allocations": over_allocations,
            "summary": {
                "total_resources": len(set(k[0] for k in all_keys)),
                "gaps_count": len(gaps),
                "orphans_count": len(orphans),
                "over_allocations_count": len(over_allocations),
            }
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
            project = self.db.query(Project).filter(Project.id == d.project_id).first()
            resource = self.db.query(Resource).filter(Resource.id == d.resource_id).first() if d.resource_id else None
            placeholder = self.db.query(Placeholder).filter(Placeholder.id == d.placeholder_id).first() if d.placeholder_id else None
            
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
            resource = self.db.query(Resource).filter(Resource.id == s.resource_id).first()
            
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
            project = self.db.query(Project).filter(Project.id == a.project_id).first()
            resource = self.db.query(Resource).filter(Resource.id == a.resource_id).first()
            
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
            project = self.db.query(Project).filter(Project.id == o.project_id).first()
            resource = self.db.query(Resource).filter(Resource.id == o.resource_id).first()
            
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
