"""Common schemas and error codes."""
from typing import Optional, Any
from pydantic import BaseModel


# Standard error codes
class ErrorCode:
    """Stable error codes for frontend handling."""
    FTE_INVALID = "FTE_INVALID"
    DEMAND_XOR = "DEMAND_XOR"
    PLACEHOLDER_BLOCKED_4MFC = "PLACEHOLDER_BLOCKED_4MFC"
    ACTUALS_OVER_100 = "ACTUALS_OVER_100"
    PERIOD_LOCKED = "PERIOD_LOCKED"
    UNAUTHORIZED_ROLE = "UNAUTHORIZED_ROLE"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    CONFLICT = "CONFLICT"


class ProblemDetail(BaseModel):
    """RFC 7807 Problem Details response."""
    type: str = "about:blank"
    title: str
    status: int
    detail: Optional[str] = None
    instance: Optional[str] = None
    code: str
    errors: Optional[list[dict[str, Any]]] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "type": "about:blank",
                "title": "Validation Error",
                "status": 400,
                "detail": "FTE must be between 5 and 100 in steps of 5",
                "code": "FTE_INVALID",
            }
        }


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    version: str
    environment: str


class MessageResponse(BaseModel):
    """Simple message response."""
    message: str
