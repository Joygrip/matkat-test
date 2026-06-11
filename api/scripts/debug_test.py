"""Minimal repro of test_sign_actuals to show response bodies."""
import sys
sys.path.insert(0, ".")

from api.tests.conftest import *
from fastapi.testclient import TestClient
from api.app.main import app
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from api.app.db.base import Base
from api.app.db import get_db
from datetime import datetime
from api.app.models.core import CostCenter, User, UserRole, Resource

engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(bind=engine)
Base.metadata.create_all(bind=engine)

def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)

admin_headers = {
    "X-Dev-Role": "Admin",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "admin-001",
    "X-Dev-Email": "admin@test.com",
    "X-Dev-Name": "Admin User",
}
finance_headers = {
    "X-Dev-Role": "Finance",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "finance-001",
    "X-Dev-Email": "finance@test.com",
    "X-Dev-Name": "Finance User",
}
employee_headers = {
    "X-Dev-Role": "Employee",
    "X-Dev-Tenant": "test-tenant-001",
    "X-Dev-User-Id": "employee-001",
    "X-Dev-Email": "employee@test.com",
    "X-Dev-Name": "Employee User",
}

db = TestingSessionLocal()
employee_user = User(
    tenant_id="test-tenant-001",
    object_id="employee-001",
    email="employee@test.com",
    display_name="Employee User",
    role=UserRole.EMPLOYEE,
)
db.add(employee_user)
db.commit()
db.refresh(employee_user)
employee_user_id = employee_user.id
db.close()

cc_resp = client.post("/admin/cost-centers", json={"code": "CC-ACT", "name": "Actuals Test CC"}, headers=admin_headers)
print(f"cost_center: {cc_resp.status_code} {cc_resp.json()}")
cc_id = cc_resp.json()["id"]

project1_resp = client.post("/admin/projects", json={"code": "PRJ-ACT1", "name": "Actuals Project 1"}, headers=admin_headers)
project1_id = project1_resp.json()["id"]

resource_resp = client.post("/admin/resources", json={
    "cost_center_id": cc_id,
    "employee_id": "EMP-ACT",
    "display_name": "Actuals Employee",
    "user_id": employee_user_id,
}, headers=admin_headers)
print(f"resource: {resource_resp.status_code} {resource_resp.json()}")
resource_id = resource_resp.json()["id"]

now = datetime.utcnow()
period_resp = client.post("/periods", json={"year": now.year, "month": now.month}, headers=finance_headers)
print(f"period: {period_resp.status_code}")

create_resp = client.post("/actuals", json={
    "resource_id": resource_id,
    "project_id": project1_id,
    "year": now.year,
    "month": now.month,
    "actual_fte_percent": 50,
}, headers=employee_headers)
print(f"create: {create_resp.status_code} {create_resp.json()}")

if create_resp.status_code == 200:
    actual_id = create_resp.json()["id"]
    sign_resp = client.post(f"/actuals/{actual_id}/sign", headers=employee_headers)
    print(f"sign: {sign_resp.status_code} {sign_resp.json()}")
