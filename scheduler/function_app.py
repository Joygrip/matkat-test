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
    """Get headers for API calls - dev bypass or future managed identity."""
    if os.environ.get("DEV_AUTH_BYPASS", "false").lower() == "true":
        return {
            "X-Dev-Role": os.environ.get("DEV_ROLE", "Admin"),
            "X-Dev-Tenant": os.environ.get("DEV_TENANT", "dev-tenant-001"),
        }
    
    # TODO: Implement managed identity token acquisition for production
    # from azure.identity import DefaultAzureCredential
    # credential = DefaultAzureCredential()
    # token = credential.get_token("api://your-api-scope/.default")
    # return {"Authorization": f"Bearer {token.token}"}
    
    return {}


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


# HTTP trigger for manual testing
@app.route(route="trigger", methods=["POST"])
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
