"""
Seed a few signed actuals for February 2026 for dev visualization.
Run: python api/scripts/seed_signed_actuals.py
"""
from datetime import datetime
from api.app.db.engine import get_db
from api.app.models.actuals import ActualLine
from api.app.models.core import User, Period, Project, Resource
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus

def main():
    db = next(get_db())
    tenant_id = "dev-tenant-001"
    # Find period for Feb 2026
    period = db.query(Period).filter_by(tenant_id=tenant_id, year=2026, month=2).first()
    if not period:
        print("No period for Feb 2026 found.")
        return
    # Find a few resources and projects
    resources = db.query(Resource).filter(Resource.tenant_id == tenant_id).limit(2).all()
    projects = db.query(Project).filter(Project.tenant_id == tenant_id).limit(2).all()
    if not resources or not projects:
        print("Not enough resources or projects.")
        return
    # Find employee users for signature
    users = db.query(User).filter(User.tenant_id == tenant_id, User.role == 'Employee').all()
    # Insert actuals if not present
    for i, resource in enumerate(resources):
        for j, project in enumerate(projects):
            exists = db.query(ActualLine).filter_by(
                tenant_id=tenant_id,
                period_id=period.id,
                resource_id=resource.id,
                project_id=project.id,
                year=2026,
                month=2
            ).first()
            if exists:
                print(f"Actual already exists for resource {resource.display_name}, project {project.name}")
                continue
            actual = ActualLine(
                tenant_id=tenant_id,
                period_id=period.id,
                resource_id=resource.id,
                project_id=project.id,
                year=2026,
                month=2,
                planned_fte_percent=50,
                actual_fte_percent=50,
                created_by="system",
                employee_signed_at=datetime.utcnow(),
                employee_signed_by=users[0].object_id if users else None,
                is_proxy_signed=False
            )
            db.add(actual)
            db.flush()
            approval = ApprovalInstance(
                tenant_id=tenant_id,
                subject_type="actuals",
                subject_id=actual.id,
                status=ApprovalStatus.APPROVED,
            )
            db.add(approval)
            db.flush()
            step = ApprovalStep(
                approval_instance_id=approval.id,
                step_order=1,
                step_name="RO Approval",
                status=StepStatus.APPROVED,
                approver_id=resource.user_id,
                completed_at=datetime.utcnow()
            )
            db.add(step)
            print(f"Added signed actual for {resource.display_name} on {project.name}")
    db.commit()
    print("Done.")

if __name__ == "__main__":
    main()
