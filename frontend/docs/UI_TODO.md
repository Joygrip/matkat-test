Work only on backend authentication.

Context:
- Current file: api/app/auth/dependencies.py
- In dev mode, get_current_user builds CurrentUser from X-Dev-* headers when ENV=dev and DEV_AUTH_BYPASS=true.
- In non-dev mode, it currently returns 501 AUTH_NOT_CONFIGURED.
- The app uses CurrentUser with fields:
  tenant_id, object_id, email, display_name, role
- Keep dev bypass for local dev only.
- Do NOT modify unrelated frontend or deployment files.

Your task:
1. Inspect:
   - api/app/auth/dependencies.py
   - api/app/config.py
   - any backend user/core model files needed to understand role/user mapping
2. Implement a production-ready auth path skeleton that replaces the 501 branch.
3. Prefer a design where:
   - token claims are validated
   - object_id is extracted
   - user is looked up in app DB
   - role and tenant_id come from app data if possible
4. Preserve current dev bypass behavior exactly for local development.
5. If full token validation library integration is too big for one pass, implement the cleanest minimal production-ready structure and clearly mark the remaining TODOs.

Constraints:
- Minimize changes.
- Do not refactor unrelated code.
- Do not remove dev bypass.
- Keep CurrentUser shape intact if possible.

Output:
- show exact files changed
- explain the auth flow in 8 bullet points max
- list any new env vars required
- list any follow-up step required before UAT



Work only on database configuration and Alembic alignment.

Context:
- Runtime DB config comes from api/app/config.py -> database_url
- Runtime engine is built in api/app/db/engine.py using settings.database_url
- Alembic env currently uses sqlalchemy.url from alembic config instead of app settings
- Goal: runtime and migrations must use the same DATABASE_URL
- Do NOT work on auth or frontend in this phase

Inspect only:
- api/app/db/engine.py
- api/app/config.py
- alembic/env.py
- alembic.ini
- model import structure needed for Alembic metadata completeness

Tasks:
1. Update Alembic env so migrations use the same DATABASE_URL source as runtime.
2. Verify Alembic imports all model modules that define tables.
3. Keep SQLite local dev support working.
4. Do not redesign the DB layer.
5. Minimize code changes.

Output:
- exact files changed
- exact reason each change was needed
- short checklist for testing locally against Azure SQL
- mention any likely Azure SQL / SQLAlchemy caveat you see from the code


Create Bicep infrastructure only.

Context:
- Backend target: Azure App Service (Python/FastAPI)
- Scheduler target: Azure Functions (Python timer trigger)
- Frontend target: Azure Static Web Apps (React/Vite)
- Database target: Azure SQL Database
- Supporting resources: Key Vault, Storage Account, Application Insights, Log Analytics
- The backend config uses env vars such as DATABASE_URL, ENV, DEV_AUTH_BYPASS, APPINSIGHTS_CONNECTION_STRING
- Do NOT create CI/CD yet
- Do NOT modify application code in this phase

Tasks:
1. Create a clean infra folder with:
   - main.bicep
   - modular resource files if helpful
   - dev parameter file
2. Provision the minimum v1 resources:
   - App Service plan
   - Web App
   - Function App
   - Storage Account
   - Azure SQL server + database
   - Static Web App
   - Key Vault
   - Log Analytics + Application Insights
3. Add app settings placeholders for backend/function where appropriate.
4. Prefer simple v1 security defaults suitable for DEV/UAT, not full private networking yet.
5. Keep naming consistent and environment-driven.

Output:
- show file tree created
- summarize what each Bicep file deploys
- list all required deployment parameters
- list follow-up tasks still needed after infra deploy


Work only on backend deployment readiness for Azure App Service.

Context:
- Infra/Bicep already exists or is being created separately
- Backend is FastAPI under api.app.main:app
- Config is env-driven
- Goal is to deploy backend to Azure App Service and run against Azure SQL
- Do NOT work on frontend or scheduler here

Inspect only:
- backend startup files
- requirements files
- any deployment/start scripts
- config.py
- engine.py
- health router

Tasks:
1. Determine the exact production startup command for App Service.
2. Identify all required backend app settings for Azure.
3. Identify whether built-in Linux App Service runtime is enough or whether current dependencies imply a custom container is safer.
4. If a Dockerfile is clearly needed, create a minimal production Dockerfile for backend only.
5. Do not create CI/CD workflow yet unless absolutely necessary for explaining deployment.

Output:
- exact startup command
- exact app settings required
- whether to use built-in App Service runtime or custom container, with reason
- files changed/created


Work only on the scheduler / Azure Functions part of the repo.

Context:
- Scheduler entrypoint is function_app.py
- Timer trigger already exists
- In dev it may use X-Dev-* style auth behavior
- Goal is to make scheduler deployment-ready for Azure Functions without depending on dev bypass in production
- Do NOT change frontend or unrelated backend files

Inspect only:
- function_app.py
- host.json
- local.settings.json
- any scheduler config helpers

Tasks:
1. Identify all required Function App settings for Azure.
2. Remove or isolate any dependency on dev-only auth behavior for production.
3. Keep local dev convenience where possible.
4. Confirm timer trigger schedule and API-calling flow.
5. Minimize changes and avoid large refactors.

Output:
- exact required Function App settings
- exact production auth approach for scheduler -> API calls
- files changed
- short deployment checklist for Azure Functions


Work only on frontend auth and deployment readiness.

Context:
- Frontend is React + Vite
- Backend auth path is being implemented separately
- Goal: make frontend able to authenticate properly and call backend with bearer token
- Deployment target: Azure Static Web Apps
- Do NOT modify backend business logic here

Inspect only:
- package.json
- vite config
- frontend env/config files
- API client files
- auth-related frontend files if present

Tasks:
1. Identify the exact frontend env vars required for Azure.
2. Implement or complete the real frontend auth flow needed to call the backend.
3. Make sure dev mode can still call local backend cleanly.
4. Confirm build command and output directory for Static Web Apps.
5. Minimize changes and avoid UI refactors unrelated to auth/config.

Output:
- exact frontend env vars required
- exact build command
- exact output directory
- files changed
- short Azure Static Web Apps deployment checklist




Work only on secrets/config hardening and monitoring readiness.

Context:
- Azure resources include Key Vault and Application Insights
- Backend and Function App configs are environment-driven
- Goal is to identify which settings should move to Key Vault and what monitoring hooks/config should exist
- Do NOT redesign business logic

Inspect only:
- config.py
- any telemetry/logging code
- function settings usage
- deployment/config files created so far

Tasks:
1. List which settings should remain plain app settings and which should become Key Vault secrets.
2. Identify where Application Insights connection string should be used.
3. Suggest the minimal code/config changes needed for telemetry readiness.
4. Keep this phase lightweight; no huge logging refactor.

Output:
- secret inventory
- recommended Key Vault candidates
- monitoring readiness notes
- files changed (if any)

Work only on UAT / production readiness review.

Context:
- Auth, DB alignment, infra, backend deploy, scheduler deploy, and frontend deploy have already been worked on
- Goal is not to add new features, but to identify final rollout blockers and production hardening gaps
- Do NOT do broad refactors

Inspect only:
- current auth/config/deployment files
- any environment-specific settings or scripts
- health/monitoring endpoints
- role/tenant-related backend dependencies

Tasks:
1. Identify what must be true in UAT and PROD environment settings.
2. Identify any remaining risk of dev bypass leaking into non-dev.
3. Produce a concise rollout checklist:
   - backend
   - frontend
   - scheduler
   - database
   - secrets
   - monitoring
4. Identify the top 5 production blockers if any remain.

Output:
- UAT checklist
- PROD checklist
- top 5 blockers
- files that would still need changes before go-live