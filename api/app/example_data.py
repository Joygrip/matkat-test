"""Example data initialization for development."""
from datetime import datetime
from sqlalchemy.orm import Session

from api.app.models.core import (
    User, Department, CostCenter, Project, Resource, Period, Placeholder,
    UserRole, PeriodStatus,
)
from api.app.models.planning import DemandLine, SupplyLine
from api.app.models.actuals import ActualLine
from api.app.models.approvals import ApprovalInstance, ApprovalStep, ApprovalStatus, StepStatus


def create_example_data(db: Session, tenant_id: str = "dev-tenant-001") -> None:
    """
    Create example data for development.
    Only creates data if database is empty (no departments exist).
    """
    # Check if data already exists
    existing_dept = db.query(Department).filter(Department.tenant_id == tenant_id).first()
    if existing_dept:
        return  # Data already exists, skip
    
    print("Creating example data for development...")
    
    # Create departments
    dept_engineering = Department(tenant_id=tenant_id, code="ENG", name="Engineering")
    dept_operations = Department(tenant_id=tenant_id, code="OPS", name="Operations")
    dept_sales = Department(tenant_id=tenant_id, code="SALES", name="Sales & Marketing")
    dept_support = Department(tenant_id=tenant_id, code="SUPPORT", name="Customer Support")
    db.add_all([dept_engineering, dept_operations, dept_sales, dept_support])
    db.flush()
    
    # Create cost centers
    cc_software = CostCenter(tenant_id=tenant_id, department_id=dept_engineering.id, code="CC-SW", name="Software Development")
    cc_qa = CostCenter(tenant_id=tenant_id, department_id=dept_engineering.id, code="CC-QA", name="Quality Assurance")
    cc_infra = CostCenter(tenant_id=tenant_id, department_id=dept_operations.id, code="CC-INFRA", name="Infrastructure")
    cc_devops = CostCenter(tenant_id=tenant_id, department_id=dept_operations.id, code="CC-DEVOPS", name="DevOps")
    cc_marketing = CostCenter(tenant_id=tenant_id, department_id=dept_sales.id, code="CC-MKT", name="Marketing")
    cc_support = CostCenter(tenant_id=tenant_id, department_id=dept_support.id, code="CC-SUPPORT", name="Support Team")
    db.add_all([cc_software, cc_qa, cc_infra, cc_devops, cc_marketing, cc_support])
    db.flush()
    
    # Create users with all roles
    users = [
        User(tenant_id=tenant_id, object_id="admin-001", email="admin@example.com", display_name="Admin User", role=UserRole.ADMIN),
        User(tenant_id=tenant_id, object_id="finance-001", email="finance@example.com", display_name="Finance Manager", role=UserRole.FINANCE),
        User(tenant_id=tenant_id, object_id="pm-001", email="pm1@example.com", display_name="Project Manager 1", role=UserRole.PM),
        User(tenant_id=tenant_id, object_id="pm-002", email="pm2@example.com", display_name="Project Manager 2", role=UserRole.PM),
        User(tenant_id=tenant_id, object_id="ro-001", email="ro1@example.com", display_name="RO Software", role=UserRole.RO, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="ro-002", email="ro2@example.com", display_name="RO QA", role=UserRole.RO, cost_center_id=cc_qa.id),
        User(tenant_id=tenant_id, object_id="ro-003", email="ro3@example.com", display_name="RO Infrastructure", role=UserRole.RO, cost_center_id=cc_infra.id),
        User(tenant_id=tenant_id, object_id="director-001", email="director1@example.com", display_name="Engineering Director", role=UserRole.DIRECTOR, department_id=dept_engineering.id),
        User(tenant_id=tenant_id, object_id="director-002", email="director2@example.com", display_name="Operations Director", role=UserRole.DIRECTOR, department_id=dept_operations.id),
        User(tenant_id=tenant_id, object_id="emp-001", email="emp1@example.com", display_name="Alice Developer", role=UserRole.EMPLOYEE, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="emp-002", email="emp2@example.com", display_name="Bob Tester", role=UserRole.EMPLOYEE, cost_center_id=cc_qa.id),
        User(tenant_id=tenant_id, object_id="emp-003", email="emp3@example.com", display_name="Charlie DevOps", role=UserRole.EMPLOYEE, cost_center_id=cc_devops.id),
        User(tenant_id=tenant_id, object_id="emp-004", email="emp4@example.com", display_name="Diana Developer", role=UserRole.EMPLOYEE, cost_center_id=cc_software.id),
        User(tenant_id=tenant_id, object_id="emp-005", email="emp5@example.com", display_name="Eve Support", role=UserRole.EMPLOYEE, cost_center_id=cc_support.id),
    ]
    
    # Set manager relationships
    users[9].manager_object_id = users[4].object_id   # Alice -> RO Software
    users[10].manager_object_id = users[5].object_id   # Bob -> RO QA
    users[11].manager_object_id = users[6].object_id   # Charlie -> RO Infrastructure
    users[12].manager_object_id = users[4].object_id   # Diana -> RO Software
    users[13].manager_object_id = users[6].object_id   # Eve -> RO Infrastructure
    users[4].manager_object_id = users[7].object_id    # RO Software -> Engineering Director
    users[5].manager_object_id = users[7].object_id    # RO QA -> Engineering Director
    users[6].manager_object_id = users[8].object_id    # RO Infrastructure -> Operations Director
    
    db.add_all(users)
    db.flush()
    
    # Update cost center ROs
    cc_software.ro_user_id = users[4].id
    cc_qa.ro_user_id = users[5].id
    cc_infra.ro_user_id = users[6].id
    
    # Create projects
    projects = [
        Project(tenant_id=tenant_id, code="PRJ-001", name="Project Alpha", pm_user_id=users[2].id, cost_center_id=cc_software.id),
        Project(tenant_id=tenant_id, code="PRJ-002", name="Project Beta", pm_user_id=users[2].id, cost_center_id=cc_software.id),
        Project(tenant_id=tenant_id, code="PRJ-003", name="Project Gamma", pm_user_id=users[3].id, cost_center_id=cc_qa.id),
        Project(tenant_id=tenant_id, code="PRJ-004", name="Infrastructure Upgrade", pm_user_id=users[3].id, cost_center_id=cc_infra.id),
        Project(tenant_id=tenant_id, code="PRJ-005", name="Marketing Campaign", pm_user_id=users[2].id, cost_center_id=cc_marketing.id),
    ]
    db.add_all(projects)
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
        Resource(tenant_id=tenant_id, cost_center_id=cc_software.id, employee_id="EXT-001", display_name="External Contractor", is_external=True, is_active=True),
    ]
    db.add_all(resources)
    db.flush()
    
    # Create placeholders
    placeholders = [
        Placeholder(tenant_id=tenant_id, name="Senior Full-Stack Developer TBH", description="Senior developer to be hired", skill_profile="Senior Full-Stack"),
        Placeholder(tenant_id=tenant_id, name="Junior Backend Developer TBH", description="Junior developer to be hired", skill_profile="Junior Backend"),
        Placeholder(tenant_id=tenant_id, name="QA Engineer TBH", description="QA engineer to be hired", skill_profile="QA Automation"),
        Placeholder(tenant_id=tenant_id, name="DevOps Engineer TBH", description="DevOps engineer to be hired", skill_profile="DevOps/SRE"),
    ]
    db.add_all(placeholders)
    db.flush()
    
    # Create periods
    periods = [
        Period(tenant_id=tenant_id, year=2025, month=12, status=PeriodStatus.LOCKED),
        Period(tenant_id=tenant_id, year=2026, month=1, status=PeriodStatus.LOCKED),
        Period(tenant_id=tenant_id, year=2026, month=2, status=PeriodStatus.OPEN),
        Period(tenant_id=tenant_id, year=2026, month=3, status=PeriodStatus.OPEN),
        Period(tenant_id=tenant_id, year=2026, month=4, status=PeriodStatus.OPEN),
        Period(tenant_id=tenant_id, year=2026, month=5, status=PeriodStatus.OPEN),
    ]
    db.add_all(periods)
    db.flush()
    
    current_period = periods[2]  # February 2026
    
    # Create demand lines
    demand_lines = [
        DemandLine(tenant_id=tenant_id, period_id=current_period.id, project_id=projects[0].id, resource_id=resources[0].id, year=2026, month=2, fte_percent=50, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=current_period.id, project_id=projects[0].id, resource_id=resources[1].id, year=2026, month=2, fte_percent=75, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=current_period.id, project_id=projects[1].id, resource_id=resources[0].id, year=2026, month=2, fte_percent=25, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=current_period.id, project_id=projects[1].id, resource_id=resources[3].id, year=2026, month=2, fte_percent=50, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=current_period.id, project_id=projects[2].id, resource_id=resources[1].id, year=2026, month=2, fte_percent=25, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=periods[3].id, project_id=projects[0].id, resource_id=resources[0].id, year=2026, month=3, fte_percent=50, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=periods[3].id, project_id=projects[0].id, placeholder_id=placeholders[0].id, year=2026, month=3, fte_percent=100, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=periods[3].id, project_id=projects[1].id, resource_id=resources[3].id, year=2026, month=3, fte_percent=75, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=periods[4].id, project_id=projects[0].id, resource_id=resources[0].id, year=2026, month=4, fte_percent=50, created_by="system"),
        DemandLine(tenant_id=tenant_id, period_id=periods[4].id, project_id=projects[0].id, placeholder_id=placeholders[1].id, year=2026, month=4, fte_percent=50, created_by="system"),
    ]
    db.add_all(demand_lines)
    db.flush()
    
    # Create supply lines
    supply_lines = [
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[0].id, year=2026, month=2, fte_percent=100, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[1].id, year=2026, month=2, fte_percent=75, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[2].id, year=2026, month=2, fte_percent=50, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[3].id, year=2026, month=2, fte_percent=100, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[4].id, year=2026, month=2, fte_percent=100, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[5].id, year=2026, month=2, fte_percent=100, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=current_period.id, resource_id=resources[6].id, year=2026, month=2, fte_percent=75, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=periods[3].id, resource_id=resources[0].id, year=2026, month=3, fte_percent=100, created_by="system"),
        SupplyLine(tenant_id=tenant_id, period_id=periods[3].id, resource_id=resources[3].id, year=2026, month=3, fte_percent=100, created_by="system"),
    ]
    db.add_all(supply_lines)
    db.flush()
    
    # Create actuals for January 2026
    jan_period = periods[1]
    actual_lines = [
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[0].id, project_id=projects[0].id, year=2026, month=1, actual_fte_percent=50, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[0].id, project_id=projects[1].id, year=2026, month=1, actual_fte_percent=25, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[1].id, project_id=projects[0].id, year=2026, month=1, actual_fte_percent=75, created_by="system"),
        ActualLine(tenant_id=tenant_id, period_id=jan_period.id, resource_id=resources[3].id, project_id=projects[1].id, year=2026, month=1, actual_fte_percent=50, created_by="system"),
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
        step_name="RO",
        approver_id=users[4].id,
        status=StepStatus.PENDING,
    )
    db.add(step1_ro)
    
    step1_director = ApprovalStep(
        instance_id=approval1.id,
        step_order=2,
        step_name="Director",
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
        step_name="RO",
        approver_id=users[5].id,
        status=StepStatus.PENDING,
    )
    db.add(step2_ro)
    
    step2_director = ApprovalStep(
        instance_id=approval2.id,
        step_order=2,
        step_name="Director",
        approver_id=users[7].id,
        status=StepStatus.PENDING,
    )
    db.add(step2_director)
    
    db.commit()
    print("✓ Example data created successfully")
