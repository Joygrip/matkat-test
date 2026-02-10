"""Health check endpoints."""
from fastapi import APIRouter

from api.app.schemas.common import HealthResponse
from api.app.config import get_settings

router = APIRouter(tags=["Health"])


@router.get("/healthz", response_model=HealthResponse)
async def health_check():
    """
    Health check endpoint for load balancers and monitoring.
    """
    settings = get_settings()
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        environment=settings.env,
    )
