"""Pytest configuration and fixtures."""
import os

# Set test environment BEFORE any imports that might load settings
# Use dev environment to enable dev bypass mode
os.environ["ENV"] = "dev"
os.environ["DEV_AUTH_BYPASS"] = "true"
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Clear settings cache in case it was loaded earlier
from api.app.config import get_settings
get_settings.cache_clear()
# Force reload settings with new env vars
settings = get_settings()
assert settings.dev_auth_bypass == True, "DEV_AUTH_BYPASS must be enabled for tests"
assert settings.is_dev == True, "is_dev must be True for tests"

from api.app.main import app
from api.app.db.base import Base
from api.app.db.engine import get_db


# Test database
TEST_DATABASE_URL = "sqlite:///./test.db"
engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def override_get_db():
    """Override database dependency for tests."""
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


# Override the dependency
app.dependency_overrides[get_db] = override_get_db


@pytest.fixture(scope="function")
def db():
    """Create fresh database for each test."""
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture(scope="function")
def client(db):
    """Create test client with fresh database."""
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as c:
        yield c
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def admin_headers():
    """Headers for admin user."""
    return {
        "X-Dev-Role": "Admin",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "admin-001",
        "X-Dev-Email": "admin@test.com",
        "X-Dev-Name": "Admin User",
    }


@pytest.fixture
def finance_headers():
    """Headers for finance user."""
    return {
        "X-Dev-Role": "Finance",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "finance-001",
        "X-Dev-Email": "finance@test.com",
        "X-Dev-Name": "Finance User",
    }


@pytest.fixture
def pm_headers():
    """Headers for PM user."""
    return {
        "X-Dev-Role": "PM",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "pm-001",
        "X-Dev-Email": "pm@test.com",
        "X-Dev-Name": "PM User",
    }


@pytest.fixture
def ro_headers():
    """Headers for RO user."""
    return {
        "X-Dev-Role": "RO",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "ro-001",
        "X-Dev-Email": "ro@test.com",
        "X-Dev-Name": "RO User",
    }


@pytest.fixture
def employee_headers():
    """Headers for Employee user."""
    return {
        "X-Dev-Role": "Employee",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "employee-001",
        "X-Dev-Email": "employee@test.com",
        "X-Dev-Name": "Employee User",
    }


@pytest.fixture
def director_headers():
    """Headers for Director user."""
    return {
        "X-Dev-Role": "Director",
        "X-Dev-Tenant": "test-tenant-001",
        "X-Dev-User-Id": "director-001",
        "X-Dev-Email": "director@test.com",
        "X-Dev-Name": "Director User",
    }
