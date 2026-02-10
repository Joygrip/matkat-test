"""FastAPI Application - Resource Allocation API."""
from http import HTTPStatus
from fastapi import FastAPI, Request, status, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from api.app.config import get_settings
from api.app.routers import health, me, dev, periods, admin, planning, actuals, approvals, consolidation, notifications, lookups
from api.app.routers import finance

# Create FastAPI app
app = FastAPI(
    title="Resource Allocation API",
    description="MatKat 2.0 - Resource planning and allocation system",
    version="1.0.0",
    docs_url="/docs" if get_settings().is_dev else None,
    redoc_url="/redoc" if get_settings().is_dev else None,
)

# CORS middleware for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server (default)
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Dev-Role",
        "X-Dev-Tenant",
        "X-Dev-User-Id",
        "X-Dev-Email",
        "X-Dev-Name",
    ],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Convert validation errors to Problem Details format."""
    errors = []
    for error in exc.errors():
        errors.append({
            "field": ".".join(str(loc) for loc in error["loc"]),
            "message": error["msg"],
            "type": error["type"],
        })
    
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "type": "about:blank",
            "title": "Validation Error",
            "status": 400,
            "detail": "Request validation failed",
            "code": "VALIDATION_ERROR",
            "errors": errors,
        },
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    """Convert HTTPException to Problem Details format."""
    detail = exc.detail

    # If already in Problem Details format, pass through
    if isinstance(detail, dict) and {"title", "status", "code"}.issubset(detail.keys()):
        return JSONResponse(
            status_code=exc.status_code,
            content=detail,
            headers=exc.headers,
        )

    title = "HTTP Error"
    try:
        title = HTTPStatus(exc.status_code).phrase
    except ValueError:
        pass

    if isinstance(detail, dict):
        code = detail.get("code", "HTTP_ERROR")
        message = detail.get("message") or detail.get("detail") or title
        extras = {k: v for k, v in detail.items() if k not in {"code", "message", "detail"}}
    else:
        code = "HTTP_ERROR"
        message = str(detail) if detail else title
        extras = {}

    problem = {
        "type": "about:blank",
        "title": title,
        "status": exc.status_code,
        "detail": message,
        "code": code,
        **extras,
    }

    return JSONResponse(
        status_code=exc.status_code,
        content=problem,
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    """Convert unhandled exceptions to Problem Details format."""
    settings = get_settings()
    
    # In dev mode, include exception details
    detail = str(exc) if settings.is_dev else "An unexpected error occurred"
    
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "type": "about:blank",
            "title": "Internal Server Error",
            "status": 500,
            "detail": detail,
            "code": "INTERNAL_ERROR",
        },
    )


# Include routers
app.include_router(health.router)
app.include_router(me.router)
app.include_router(dev.router)
app.include_router(periods.router)
app.include_router(lookups.router)  # Read-only lookups for all roles
app.include_router(admin.router)  # Admin-only CRUD
app.include_router(planning.router)
app.include_router(actuals.router)
app.include_router(approvals.router)
app.include_router(consolidation.router)
app.include_router(notifications.router)
app.include_router(finance.router, prefix="/finance")


@app.on_event("startup")
async def startup_event():
    """Initialize application on startup."""
    settings = get_settings()
    print(f"Starting Resource Allocation API in {settings.env} mode")
    if settings.dev_auth_bypass:
        print("WARNING: DEV_AUTH_BYPASS is enabled. Do not use in production!")
        # --- Robust dev seeding logic ---
        from api.app.db.engine import SessionLocal
        from api.app.routers.dev import seed_database_for_tenant
        # Use a default dev tenant id (as in tests or frontend dev login)
        dev_tenant_id = "dev-tenant-001"
        with SessionLocal() as db:
            msg = seed_database_for_tenant(db, dev_tenant_id)
            print(f"[DEV SEED] {msg}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    print("Shutting down Resource Allocation API")
