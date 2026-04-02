"""Example data initialization for development."""
from datetime import datetime
from sqlalchemy.orm import Session

from api.app.models.core import (
    User, CostCenter, Project, ProjectPM, Resource, ResourceType, Period, Placeholder,
    UserRole, PeriodStatus,
)
from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.actuals import ActualLine
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus
from api.app.models.project_costs import ProjectExternalLine, ProjectEquipmentLine


def create_example_data(db: Session, tenant_id: str = "dev-tenant-001") -> None:
    """
    Create example data for development.
    Only creates data if database is empty (no cost centers exist).
    """
    existing_cc = db.query(CostCenter).filter(CostCenter.tenant_id == tenant_id).first()
    if existing_cc:
        return  # Data already exists, skip

    print("Creating example data for development...")

    # Create cost centers (no department)
    cc_software = CostCenter(tenant_id=tenant_id, code="CC-SW", name="Software Development")
    cc_qa = CostCenter(tenant_id=tenant_id, code="CC-QA", name="Quality Assurance")
    cc_infra = CostCenter(tenant_id=tenant_id, code="CC-INFRA", name="Infrastructure")
    cc_devops = CostCenter(tenant_id=tenant_id, code="CC-DEVOPS", name="DevOps")
    cc_marketing = CostCenter(tenant_id=tenant_id, code="CC-MKT", name="Marketing")
    cc_support = CostCenter(tenant_id=tenant_id, code="CC-SUPPORT", name="Support Team")
    db.add_all([cc_software, cc_qa, cc_infra, cc_devops, cc_marketing, cc_support])
    db.flush()

    # Create users with all roles (Directors get cost_center_id for display)
    users = [
        User(tenant_id=tenant_id, object_id="admin-001", email="admin@example.com", display_name="Admin User", role=UserRole.ADMIN),
        User(tenant_id=tenant_id, object_id="finance-001", email="finance@example.com", display_name="Finance Manager", role=UserRole.FINANCE),
        User(tenant_id=tenant_id, object_id="pm-001", email="pm1@example.com", display_name="Project Manager 1", role=UserRole.PM),
        User(tenant_id=tenant_id, object_id="pm-002", email="pm2@example.com", display_name="Project Manager 2", role=UserRole.PM),
        User(tenant_id=tenant_id, object_id="ro-001", email="ro1@example.com", display_name="RO Software", role=UserRole.MANAGER, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="ro-002", email="ro2@example.com", display_name="RO QA", role=UserRole.MANAGER, cost_center_id=cc_qa.id),
        User(tenant_id=tenant_id, object_id="ro-003", email="ro3@example.com", display_name="RO Infrastructure", role=UserRole.MANAGER, cost_center_id=cc_infra.id),
        User(tenant_id=tenant_id, object_id="director-001", email="director1@example.com", display_name="Engineering Director", role=UserRole.MANAGER, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="director-002", email="director2@example.com", display_name="Operations Director", role=UserRole.MANAGER, cost_center_id=cc_infra.id),
        User(tenant_id=tenant_id, object_id="emp-001", email="emp1@example.com", display_name="Alice Developer", role=UserRole.EMPLOYEE, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="emp-002", email="emp2@example.com", display_name="Bob Tester", role=UserRole.EMPLOYEE, cost_center_id=cc_qa.id),
        User(tenant_id=tenant_id, object_id="emp-003", email="emp3@example.com", display_name="Charlie DevOps", role=UserRole.EMPLOYEE, cost_center_id=cc_devops.id),
        User(tenant_id=tenant_id, object_id="emp-004", email="emp4@example.com", display_name="Diana Developer", role=UserRole.EMPLOYEE, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="emp-005", email="emp5@example.com", display_name="Eve Support", role=UserRole.EMPLOYEE, cost_center_id=cc_support.id),
        User(tenant_id=tenant_id, object_id="dev-user-001", email="dev@example.com", display_name="Dev User", role=UserRole.EMPLOYEE, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="manager-001", email="manager@example.com", display_name="Dev Manager", role=UserRole.MANAGER, cost_center_id=cc_software.id),
    ]

    # Set manager relationships
    users[9].manager_object_id = "manager-001"          # Alice -> Dev Manager
    users[10].manager_object_id = users[5].object_id    # Bob -> RO QA
    users[11].manager_object_id = users[6].object_id    # Charlie -> RO Infrastructure
    users[12].manager_object_id = "manager-001"          # Diana -> Dev Manager
    users[13].manager_object_id = users[6].object_id    # Eve -> RO Infrastructure
    users[4].manager_object_id = users[7].object_id     # RO Software -> Engineering Director
    users[5].manager_object_id = users[7].object_id     # RO QA -> Engineering Director
    users[6].manager_object_id = users[8].object_id     # RO Infrastructure -> Operations Director
    users[15].manager_object_id = users[7].object_id    # Dev Manager -> Engineering Director

    db.add_all(users)
    db.flush()

    # Update cost center ROs and directors
    cc_software.ro_user_id = users[15].id   # Dev Manager is RO for Software Development
    cc_software.director_user_id = users[7].id
    cc_qa.ro_user_id = users[5].id
    cc_qa.director_user_id = users[7].id
    cc_infra.ro_user_id = users[6].id
    cc_infra.director_user_id = users[8].id
    cc_devops.director_user_id = users[8].id
    
    # Create projects
    projects = [
        Project(tenant_id=tenant_id, code="PRJ-001", name="Project Alpha", cost_center_id=cc_software.id),
        Project(tenant_id=tenant_id, code="PRJ-002", name="Project Beta", cost_center_id=cc_software.id),
        Project(tenant_id=tenant_id, code="PRJ-003", name="Project Gamma", cost_center_id=cc_qa.id),
        Project(tenant_id=tenant_id, code="PRJ-004", name="Infrastructure Upgrade", cost_center_id=cc_infra.id),
        Project(tenant_id=tenant_id, code="PRJ-005", name="Marketing Campaign", cost_center_id=cc_marketing.id),
    ]
    db.add_all(projects)
    db.flush()
    # Assign PMs
    db.add_all([
        ProjectPM(project_id=projects[0].id, user_id=users[2].id, tenant_id=tenant_id),
        ProjectPM(project_id=projects[1].id, user_id=users[2].id, tenant_id=tenant_id),
        ProjectPM(project_id=projects[2].id, user_id=users[3].id, tenant_id=tenant_id),
        ProjectPM(project_id=projects[3].id, user_id=users[3].id, tenant_id=tenant_id),
        ProjectPM(project_id=projects[4].id, user_id=users[2].id, tenant_id=tenant_id),
    ])
    db.flush()
    
    # Create resources
    resources = [
        Resource(tenant_id=tenant_id, user_id=users[9].id, cost_center_id=cc_software.id, employee_id="EMP-001", display_name="Alice Developer", email="emp1@example.com", is_active=True),
        Resource(tenant_id=tenant_id, user_id=users[10].id, cost_center_id=cc_qa.id, employee_id="EMP-002", display_name="Bob Tester", email="emp2@example.com", is_active=True),
        Resource(tenant_id=tenant_id, user_id=users[11].id, cost_center_id=cc_devops.id, employee_id="EMP-003", display_name="Charlie DevOps", email="emp3@example.com", is_active=True),
        Resource(tenant_id=tenant_id, user_id=users[12].id, cost_center_id=cc_software.id, employee_id="EMP-004", display_name="Diana Developer", email="emp4@example.com", is_active=True),
        Resource(tenant_id=tenant_id, user_id=users[13].id, cost_center_id=cc_support.id, employee_id="EMP-005", display_name="Eve Support", email="emp5@example.com", is_active=True),
        Resource(tenant_id=tenant_id, cost_center_id=cc_software.id, employee_id="EMP-006", display_name="Frank Developer", email="frank@example.com", is_active=True),
        Resource(tenant_id=tenant_id, cost_center_id=cc_qa.id, employee_id="EMP-007", display_name="Grace Tester", email="grace@example.com", is_active=True),
        Resource(tenant_id=tenant_id, cost_center_id=cc_software.id, employee_id="EXT-001", display_name="External Contractor", resource_type=ResourceType.EXTERNAL, is_active=True),
        Resource(tenant_id=tenant_id, user_id=users[14].id, cost_center_id=cc_software.id, employee_id="DEV-001", display_name="Dev User", email="dev@example.com", is_active=True),
    ]
    db.add_all(resources)
    db.flush()
    
    # Create one placeholder per cost center
    cost_centers_list = [cc_software, cc_qa, cc_infra, cc_devops, cc_marketing, cc_support]
    placeholders = [
        Placeholder(tenant_id=tenant_id, cost_center_id=cc.id, name=f"Placeholder: {cc.name}")
        for cc in cost_centers_list
    ]
    db.add_all(placeholders)
    db.flush()
    
    # Create periods: Dec 2025, Jan 2026 (locked); Feb 2026 - Dec 2026 (open)
    periods = [
        Period(tenant_id=tenant_id, year=2025, month=12, status=PeriodStatus.LOCKED),
        Period(tenant_id=tenant_id, year=2026, month=1, status=PeriodStatus.LOCKED),
    ]
    periods += [
        Period(tenant_id=tenant_id, year=2026, month=m, status=PeriodStatus.OPEN)
        for m in range(2, 13)
    ]
    db.add_all(periods)
    db.flush()
    period_by_key = {(p.year, p.month): p for p in periods}

    # Demand lines: each (project, resource/placeholder) unique per month.
    # (project_idx, resource_idx or -1, placeholder_idx or -1, fte)
    demand_templates = [
        (0, 0, -1, 50), (0, 1, -1, 75), (1, 0, -1, 25), (1, 3, -1, 50), (2, 1, -1, 25),
        (0, -1, 0, 100), (1, 4, -1, 75), (0, 2, -1, 50), (3, 2, -1, 50), (4, 4, -1, 100),
        (2, 0, -1, 50), (3, 5, -1, 75),
    ]

    # All (year, month) pairs: Dec 2025, Jan 2026, Feb 2026 - Dec 2026
    period_months = [(2025, 12)] + [(2026, m) for m in range(1, 13)]

    demand_lines = []
    for year, month in period_months:
        p = period_by_key[(year, month)]
        for proj_idx, res_idx, ph_idx, fte_val in demand_templates:
            line = DemandLine(
                tenant_id=tenant_id, period_id=p.id, project_id=projects[proj_idx].id,
                year=year, month=month, fte_percent=fte_val, created_by="system",
            )
            if ph_idx >= 0:
                line.placeholder_id = placeholders[ph_idx].id
            else:
                line.resource_id = resources[res_idx].id
            demand_lines.append(line)
    db.add_all(demand_lines)
    db.flush()

    # Supply lines with project_id so Dashboard "by project" chart shows supply.
    # (resource_idx, project_idx, fte_percent) - allocates each resource's supply to projects
    supply_templates = [
        (0, 0, 100), (1, 0, 100), (2, 0, 50), (2, 1, 50), (3, 1, 100), (4, 2, 100),
        (5, 0, 100), (6, 2, 100),
    ]
    supply_lines = []
    for year, month in period_months:
        p = period_by_key[(year, month)]
        fte_base = 100 if month % 3 != 0 else 75
        for res_idx, proj_idx, fte_pct in supply_templates:
            fte_val = (fte_base * fte_pct) // 100
            fte_val = max(5, min(100, (fte_val // 5) * 5))
            supply_lines.append(SupplyLine(
                tenant_id=tenant_id, period_id=p.id, resource_id=resources[res_idx].id,
                project_id=projects[proj_idx].id, year=year, month=month,
                fte_percent=fte_val, created_by="system",
            ))
    db.add_all(supply_lines)
    db.flush()
    
    # Create actuals for January 2026 (locked period)
    jan_period = period_by_key[(2026, 1)]
    actual_lines = [
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[0].id, project_id=projects[0].id, year=2026, month=1, planned_fte_percent=50, actual_fte_percent=50, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[0].id, project_id=projects[1].id, year=2026, month=1, planned_fte_percent=25, actual_fte_percent=25, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[1].id, project_id=projects[0].id, year=2026, month=1, planned_fte_percent=75, actual_fte_percent=75, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[3].id, project_id=projects[1].id, year=2026, month=1, planned_fte_percent=50, actual_fte_percent=50, created_by="system"),
    ]
    db.add_all(actual_lines)
    db.flush()
    
    # Sign actuals and create approvals
    actual_lines[0].employee_signed_at = datetime.utcnow()
    actual_lines[0].employee_signed_by = users[9].object_id
    actual_lines[0].is_proxy_signed = False
    
    approval1 = ApprovalInstance(
        tenant_id=tenant_id,
        subject_type="actuals",
        subject_id=actual_lines[0].id,
        status=ApprovalStatus.PENDING,
        created_by=users[9].object_id,
    )
    db.add(approval1)
    db.flush()
    
    step1_ro = ApprovalStep(
        instance_id=approval1.id,
        step_order=1,
        step_name="Manager",
        approver_id=users[15].id,
        status=StepStatus.PENDING,
    )
    db.add(step1_ro)
    
    step1_director = ApprovalStep(
        instance_id=approval1.id,
        step_order=2,
        step_name="Senior Manager",
        approver_id=users[7].id,
        status=StepStatus.PENDING,
    )
    db.add(step1_director)
    db.flush()
    
    actual_lines[2].employee_signed_at = datetime.utcnow()
    actual_lines[2].employee_signed_by = users[10].object_id
    actual_lines[2].is_proxy_signed = False
    
    approval2 = ApprovalInstance(
        tenant_id=tenant_id,
        subject_type="actuals",
        subject_id=actual_lines[2].id,
        status=ApprovalStatus.PENDING,
        created_by=users[10].object_id,
    )
    db.add(approval2)
    db.flush()
    
    step2_ro = ApprovalStep(
        instance_id=approval2.id,
        step_order=1,
        step_name="Manager",
        approver_id=users[5].id,
        status=StepStatus.PENDING,
    )
    db.add(step2_ro)
    
    step2_director = ApprovalStep(
        instance_id=approval2.id,
        step_order=2,
        step_name="Senior Manager",
        approver_id=users[7].id,
        status=StepStatus.PENDING,
    )
    db.add(step2_director)
    db.flush()

    # Create actuals for February 2026 (open period) - for Finance Actuals chart
    feb_period = period_by_key[(2026, 2)]
    feb_actuals = [
        ActualLine(tenant_id=tenant_id, period_id=feb_period.id, resource_id=resources[0].id, project_id=projects[0].id, year=2026, month=2, planned_fte_percent=50, actual_fte_percent=50, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=feb_period.id, resource_id=resources[0].id, project_id=projects[1].id, year=2026, month=2, planned_fte_percent=25, actual_fte_percent=25, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=feb_period.id, resource_id=resources[1].id, project_id=projects[0].id, year=2026, month=2, planned_fte_percent=75, actual_fte_percent=75, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=feb_period.id, resource_id=resources[3].id, project_id=projects[1].id, year=2026, month=2, planned_fte_percent=50, actual_fte_percent=50, created_by="system"),
    ]
    db.add_all(feb_actuals)
    db.flush()

    # Sign Feb actuals and create approvals
    feb_actuals[0].employee_signed_at = datetime.utcnow()
    feb_actuals[0].employee_signed_by = users[9].object_id
    feb_actuals[0].is_proxy_signed = False

    feb_approval1 = ApprovalInstance(
        tenant_id=tenant_id,
        subject_type="actuals",
        subject_id=feb_actuals[0].id,
        status=ApprovalStatus.PENDING,
        created_by=users[9].object_id,
    )
    db.add(feb_approval1)
    db.flush()

    feb_step1_ro = ApprovalStep(
        instance_id=feb_approval1.id,
        step_order=1,
        step_name="Manager",
        approver_id=users[15].id,
        status=StepStatus.PENDING,
    )
    db.add(feb_step1_ro)

    feb_step1_director = ApprovalStep(
        instance_id=feb_approval1.id,
        step_order=2,
        step_name="Senior Manager",
        approver_id=users[7].id,
        status=StepStatus.PENDING,
    )
    db.add(feb_step1_director)
    db.flush()

    feb_actuals[2].employee_signed_at = datetime.utcnow()
    feb_actuals[2].employee_signed_by = users[10].object_id
    feb_actuals[2].is_proxy_signed = False

    feb_approval2 = ApprovalInstance(
        tenant_id=tenant_id,
        subject_type="actuals",
        subject_id=feb_actuals[2].id,
        status=ApprovalStatus.PENDING,
        created_by=users[10].object_id,
    )
    db.add(feb_approval2)
    db.flush()

    feb_step2_ro = ApprovalStep(
        instance_id=feb_approval2.id,
        step_order=1,
        step_name="Manager",
        approver_id=users[5].id,
        status=StepStatus.PENDING,
    )
    db.add(feb_step2_ro)

    feb_step2_director = ApprovalStep(
        instance_id=feb_approval2.id,
        step_order=2,
        step_name="Senior Manager",
        approver_id=users[7].id,
        status=StepStatus.PENDING,
    )
    db.add(feb_step2_director)

    # Project cost seed data — externals and equipment for Feb 2026
    # PM1 (users[2]) owns PRJ-001, PRJ-002, PRJ-005
    # PM2 (users[3]) owns PRJ-003, PRJ-004
    # resources[7] = EXT-001 External Contractor (ResourceType.EXTERNAL)
    ext_resource = resources[7]
    project_external_lines = [
        ProjectExternalLine(
            tenant_id=tenant_id,
            project_id=projects[0].id,   # Project Alpha
            period_id=feb_period.id,
            resource_id=ext_resource.id,
            description="Frontend development",
            hours=80,
            rate=15000,          # 150.00 DKK/hr
            total_cost=1200000,  # 12,000.00 DKK
            created_by=users[2].object_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
        ProjectExternalLine(
            tenant_id=tenant_id,
            project_id=projects[1].id,   # Project Beta
            period_id=feb_period.id,
            resource_id=ext_resource.id,
            description="UX review",
            hours=40,
            rate=12500,          # 125.00 DKK/hr
            total_cost=500000,   # 5,000.00 DKK
            created_by=users[2].object_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
        ProjectExternalLine(
            tenant_id=tenant_id,
            project_id=projects[2].id,   # Project Gamma
            period_id=feb_period.id,
            resource_id=ext_resource.id,
            description="QA automation",
            hours=60,
            rate=10000,          # 100.00 DKK/hr
            total_cost=600000,   # 6,000.00 DKK
            created_by=users[3].object_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
    ]
    db.add_all(project_external_lines)

    project_equipment_lines = [
        ProjectEquipmentLine(
            tenant_id=tenant_id,
            project_id=projects[0].id,   # Project Alpha
            period_id=feb_period.id,
            description="Server hardware lease",
            cost=350000,         # 3,500.00 DKK
            created_by=users[2].object_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
        ProjectEquipmentLine(
            tenant_id=tenant_id,
            project_id=projects[2].id,   # Project Gamma
            period_id=feb_period.id,
            description="Test equipment",
            cost=120000,         # 1,200.00 DKK
            created_by=users[3].object_id,
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        ),
    ]
    db.add_all(project_equipment_lines)

    db.commit()
    print("Example data created successfully")
