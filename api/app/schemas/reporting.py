"""Pydantic schemas for reporting / manager hierarchy endpoints."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class ManagerOverrideCreate(BaseModel):
    employee_object_id: str
    manager_object_id: str
    note: Optional[str] = None


class ManagerOverridePatch(BaseModel):
    is_active: Optional[bool] = None
    note: Optional[str] = None


class ManagerOverrideResponse(BaseModel):
    id: str
    tenant_id: str
    employee_object_id: str
    manager_object_id: str
    is_active: bool
    note: Optional[str]
    created_at: datetime
    created_by: str

    model_config = {"from_attributes": True}


class ReportingChainEntry(BaseModel):
    employee_object_id: str
    depth: int
    source: str  # 'graph' | 'override'


class SyncResult(BaseModel):
    rows_written: int
    message: str
