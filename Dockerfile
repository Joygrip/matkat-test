FROM python:3.12-slim-bookworm

# ── System deps: unixODBC + Microsoft ODBC Driver 18 ─────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl gnupg apt-transport-https \
    && curl -sSL https://packages.microsoft.com/keys/microsoft.asc \
       | gpg --dearmor > /usr/share/keyrings/microsoft-prod.gpg \
    && curl -sSL https://packages.microsoft.com/config/debian/12/prod.list \
       > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y --no-install-recommends \
        msodbcsql18 unixodbc-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python dependencies (cached layer) ───────────────────────────────────────
COPY api/requirements.txt       api/requirements.txt
COPY api/requirements.azure.txt api/requirements.azure.txt
RUN pip install --no-cache-dir -r api/requirements.azure.txt

# ── Application code ──────────────────────────────────────────────────────────
COPY api/ api/

EXPOSE 8000

# 2 workers: avoids single-process serialization under peak load. The
# notification scheduler runs in each worker but dispatch is deduplicated
# via an atomic last_run_at claim (see api/app/services/scheduler.py).
CMD ["uvicorn", "api.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
