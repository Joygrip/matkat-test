"""
Azure Functions Timer - Notification Scheduler

This function triggers on a schedule and calls the API notification endpoints.
In production, it would use managed identity for authentication.
In dev mode, it uses DEV_AUTH_BYPASS headers.
"""
import os
import logging
import requests
from datetime import datetime, date
import azure.functions as func

app = func.FunctionApp()


def get_api_headers():
    """Get headers for API calls — dev bypass or managed identity (production)."""
    if os.environ.get("DEV_AUTH_BYPASS", "false").lower() == "true":
        return {
            "X-Dev-Role": os.environ.get("DEV_ROLE", "Admin"),
            "X-Dev-Tenant": os.environ.get("DEV_TENANT", "dev-tenant-001"),
        }
    
    # Production: acquire token via managed identity (Azure Functions) or
    # Azure CLI credentials (local development without bypass).
    from azure.identity import DefaultAzureCredential
    client_id = os.environ["API_APP_CLIENT_ID"]
    credential = DefaultAzureCredential()
    token = credential.get_token(f"api://{client_id}/.default")
    return {"Authorization": f"Bearer {token.token}"}


def call_notification_api(phase: str, year: int, month: int):
    """Call the notification run endpoint."""
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    url = f"{base_url}/notifications/run"
    
    params = {
        "phase": phase,
        "year": year,
        "month": month,
    }
    
    headers = get_api_headers()
    
    try:
        response = requests.post(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to call notification API: {e}")
        raise


PHASES = ["PM_RO", "Finance", "Employee", "RO_Director"]


def get_phase_deadline(phase: str, year: int, month: int) -> date:
    """Get the calculated deadline for a phase from the API."""
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    url = f"{base_url}/notifications/deadline"

    params = {
        "phase": phase,
        "year": year,
        "month": month,
    }

    headers = get_api_headers()
    response = requests.get(url, params=params, headers=headers, timeout=30)
    response.raise_for_status()
    payload = response.json()
    return date.fromisoformat(payload["deadline"])


def get_due_phases(today: date) -> list[str]:
    """Return phases that should run today based on API-calculated deadlines."""
    due = []
    for phase in PHASES:
        try:
            deadline = get_phase_deadline(phase, today.year, today.month)
            if deadline == today:
                due.append(phase)
        except Exception as exc:
            logging.error(f"Failed to evaluate phase {phase}: {exc}")
    return due


# Timer trigger: Run daily at 8:00 AM UTC, then fire phases due today
@app.timer_trigger(schedule="0 0 8 * * *", arg_name="mytimer", run_on_startup=False)
def notification_daily(mytimer: func.TimerRequest) -> None:
    """
    Daily trigger to run phases due today.

    Cadence:
    - PM_RO: 1st Friday
    - Finance: 3rd Friday
    - Employee: 4th Monday
    - RO_Director: 4th Tuesday
    """
    now = datetime.utcnow()
    today = now.date()
    logging.info(f"Notification scheduler triggered at {now} UTC")

    due_phases = get_due_phases(today)
    if not due_phases:
        logging.info("No notification phases due today.")
        return

    for phase in due_phases:
        try:
            result = call_notification_api(phase, today.year, today.month)
            logging.info(f"{phase} notifications result: {result}")
        except Exception as e:
            logging.error(f"{phase} notifications failed: {e}")


# Timer trigger: Run nightly at 2:00 AM UTC — refresh all user profiles and manager
# relationships from Microsoft Graph for every tenant user.
@app.timer_trigger(schedule="0 0 2 * * *", arg_name="synctimer", run_on_startup=False)
def graph_sync_daily(synctimer: func.TimerRequest) -> None:
    """
    Nightly Graph background sync.

    Calls POST /admin/sync/graph-users on the API, which refreshes email,
    display_name, and manager_object_id for all users in the tenant from
    Microsoft Graph (client credentials / app-only flow).

    Requires the app registration to have User.Read.All application permission
    with admin consent, and the scheduler's DEV_ROLE to be 'Admin'.
    """
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    url = f"{base_url}/admin/sync/graph-users"
    headers = get_api_headers()

    logging.info("Graph sync daily timer triggered.")
    try:
        response = requests.post(url, headers=headers, timeout=120)
        response.raise_for_status()
        result = response.json()
        logging.info(
            "Graph sync completed: total=%s synced=%s missing=%s deactivated=%s "
            "manager_changes=%s errors=%s",
            result.get("total_users"),
            result.get("synced"),
            result.get("missing_from_graph"),
            result.get("deactivated"),
            result.get("manager_changes"),
            result.get("errors"),
        )
    except Exception as e:
        logging.error("Graph sync daily failed: %s", e)


# HTTP trigger for manual on-demand Graph sync
@app.route(route="sync-trigger", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def manual_sync_trigger(req: func.HttpRequest) -> func.HttpResponse:
    """
    HTTP endpoint for manually triggering the Graph user sync.

    No query params required — always syncs the tenant associated with the
    configured DEV_ROLE / managed identity credentials.
    """
    base_url = os.environ.get("API_BASE_URL", "http://localhost:8000")
    url = f"{base_url}/admin/sync/graph-users"
    headers = get_api_headers()

    logging.info("Manual Graph sync trigger called.")
    try:
        response = requests.post(url, headers=headers, timeout=120)
        response.raise_for_status()
        return func.HttpResponse(
            body=response.text,
            status_code=200,
            mimetype="application/json",
        )
    except Exception as e:
        return func.HttpResponse(
            body=f"Error: {str(e)}",
            status_code=500,
        )


# HTTP trigger for manual testing
@app.route(route="trigger", methods=["POST"], auth_level=func.AuthLevel.FUNCTION)
def manual_trigger(req: func.HttpRequest) -> func.HttpResponse:
    """
    HTTP endpoint for manually triggering notifications.
    
    Query params:
    - phase: PM_RO, Finance, Employee, RO_Director
    - year: Year (optional, defaults to current)
    - month: Month (optional, defaults to current)
    """
    now = datetime.utcnow()
    
    phase = req.params.get("phase", "PM_RO")
    year = int(req.params.get("year", now.year))
    month = int(req.params.get("month", now.month))
    
    logging.info(f"Manual trigger: phase={phase}, year={year}, month={month}")
    
    try:
        result = call_notification_api(phase, year, month)
        return func.HttpResponse(
            body=str(result),
            status_code=200,
            mimetype="application/json"
        )
    except Exception as e:
        return func.HttpResponse(
            body=f"Error: {str(e)}",
            status_code=500
        )
