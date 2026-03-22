# Matkat Azure Migration Guide

End-to-end deployment guide for the first rollout to Azure (dev / uat / prod).
Follow steps in order — several steps produce values required by later steps.

---

## Deployment Order

1. [Entra App Registration](#step-1--entra-app-registration)
2. [ACR — build + push image](#step-2--acr-build--push)
3. [Bicep deploy](#step-3--bicep-deploy)
4. [ACR pull role assignment (manual)](#step-4--acr-pull-role-assignment)
5. [Key Vault secrets — populate all REPLACE_ME values](#step-5--key-vault-secrets)
6. [App Service restart](#step-6--app-service-restart)
7. [Alembic migration against Azure SQL](#step-7--alembic-migration)
8. [Frontend build + SWA deploy](#step-8--frontend-build--swa-deploy)
9. [Function App deploy](#step-9--function-app-deploy)
10. [CORS update — re-deploy Bicep with SWA hostname](#step-10--cors-update)
11. [Smoke tests](#step-11--smoke-tests)

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Azure CLI | >= 2.57 | https://learn.microsoft.com/en-us/cli/azure/install-azure-cli |
| Bicep CLI | >= 0.25 | `az bicep install` |
| Docker Desktop | any | https://www.docker.com/products/docker-desktop |
| Azure Functions Core Tools | v4 | `npm i -g azure-functions-core-tools@4 --unsafe-perm true` |
| Node.js + npm | >= 20 | https://nodejs.org |
| Python | >= 3.12 | https://python.org |
| ODBC Driver 18 for SQL Server | any | https://learn.microsoft.com/en-us/sql/connect/odbc/download-odbc-driver-for-sql-server |

**Azure permissions required:**
- Contributor + User Access Administrator on the target resource group
- Application Administrator on the Entra tenant

**Convention used throughout this guide:**

```bash
export AZURE_ENV=dev   # or: uat, prod
export RG=rg-matkat-$AZURE_ENV
export ACR_NAME=<your-acr-name>   # globally unique, lowercase, no hyphens
```

---

## Step 1 — Entra App Registration

One app registration serves both the API backend and MSAL frontend.

### 1.1 Create the registration

```bash
API_APP_CLIENT_ID=$(az ad app create \
  --display-name "matkat-api-$AZURE_ENV" \
  --sign-in-audience AzureADMyOrg \
  --query appId -o tsv)

echo "API_APP_CLIENT_ID=$API_APP_CLIENT_ID"
```

### 1.2 Set the Application ID URI

```bash
az ad app update \
  --id $API_APP_CLIENT_ID \
  --identifier-uris "api://$API_APP_CLIENT_ID"
```

`API_APP_ID_URI` = `api://$API_APP_CLIENT_ID`

### 1.3 Create a client secret (for Graph OBO flow)

```bash
GRAPH_CLIENT_SECRET=$(az ad app credential reset \
  --id $API_APP_CLIENT_ID \
  --display-name "graph-obo-secret" \
  --query password -o tsv)

echo "GRAPH_CLIENT_SECRET=$GRAPH_CLIENT_SECRET"
```

`GRAPH_CLIENT_ID` = `$API_APP_CLIENT_ID` (same registration unless you create a dedicated Graph app).

### 1.4 Grant admin consent for User.Read.All (application permission)

Required for the nightly Graph background sync (`graph_sync_daily`).

In the Azure Portal:
1. Entra ID → App registrations → `matkat-api-$AZURE_ENV`
2. API permissions → Add a permission → Microsoft Graph → Application permissions
3. Select `User.Read.All`
4. Click **Grant admin consent for \<tenant\>**

### 1.5 Note your tenant ID

```bash
TENANT_ID=$(az account show --query tenantId -o tsv)
echo "TENANT_ID=$TENANT_ID"
```

---

## Step 2 — ACR: Build + Push

### 2.1 Create ACR (skip if already exists)

```bash
az acr create \
  --resource-group rg-matkat-shared \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled false
```

### 2.2 Log in

```bash
az acr login --name $ACR_NAME
```

### 2.3 Build and push

From the repo root (the Dockerfile is at root level):

```bash
IMAGE_TAG=$(git rev-parse --short HEAD)

docker build -t $ACR_NAME.azurecr.io/matkat-api:$IMAGE_TAG .
docker push $ACR_NAME.azurecr.io/matkat-api:$IMAGE_TAG

# Also tag as latest for dev convenience
docker tag $ACR_NAME.azurecr.io/matkat-api:$IMAGE_TAG \
           $ACR_NAME.azurecr.io/matkat-api:latest
docker push $ACR_NAME.azurecr.io/matkat-api:latest
```

Update `backendImageName` in `infra/$AZURE_ENV.parameters.json` with
`matkat-api:$IMAGE_TAG` (use a versioned tag for uat/prod, not `latest`).

---

## Step 3 — Bicep Deploy

### 3.1 Fill in the parameters file

Edit `infra/$AZURE_ENV.parameters.json`. Replace all `REPLACE_BEFORE_DEPLOY` values:

| Parameter | Value |
|-----------|-------|
| `sqlAdminPassword` | Strong password (16+ chars, mixed case, numbers, symbols) — save it; needed again in Step 5 |
| `containerRegistryName` | `$ACR_NAME` (without `.azurecr.io`) |
| `frontendAuthClientId` | `$API_APP_CLIENT_ID` |
| `frontendAuthAuthority` | `https://login.microsoftonline.com/$TENANT_ID` |
| `frontendApiScope` | `api://$API_APP_CLIENT_ID/.default` |
| `azureTenantAllowlist` | `$TENANT_ID` (uat/prod only) |
| `corsOrigins` | Leave as `REPLACE_AFTER_SWA_DEPLOY` — updated in Step 10 |

### 3.2 Create resource group

```bash
az group create \
  --name $RG \
  --location westeurope
```

### 3.3 Deploy

```bash
DEPLOY_NAME=matkat-infra-$(date +%Y%m%d-%H%M)

az deployment group create \
  --resource-group $RG \
  --template-file infra/main.bicep \
  --parameters infra/$AZURE_ENV.parameters.json \
  --name $DEPLOY_NAME
```

### 3.4 Capture outputs

```bash
az deployment group show \
  --resource-group $RG \
  --name $DEPLOY_NAME \
  --query properties.outputs

# Key values to note:
# webAppHostname      → App Service hostname (e.g. matkat-api-dev.azurewebsites.net)
# funcAppHostname     → Function App hostname
# staticWebAppHostname → SWA hostname (populated after Step 8)
# keyVaultUri         → Key Vault URI
# sqlServerFqdn       → SQL Server FQDN
# sqlDatabaseName     → Database name
```

---

## Step 4 — ACR Pull Role Assignment

The App Service uses its **system-assigned managed identity** to pull from ACR
(`acrUseManagedIdentity: true` is set in the Bicep). The `AcrPull` role
assignment must be done manually because the ACR lives outside this resource group.

```bash
APP_SERVICE_PRINCIPAL=$(az webapp identity show \
  --resource-group $RG \
  --name matkat-api-$AZURE_ENV \
  --query principalId -o tsv)

ACR_ID=$(az acr show --name $ACR_NAME --query id -o tsv)

az role assignment create \
  --assignee $APP_SERVICE_PRINCIPAL \
  --role AcrPull \
  --scope $ACR_ID
```

Wait 1–2 minutes for the role assignment to propagate before restarting the App Service.

---

## Step 5 — Key Vault Secrets

The Bicep deploy creates all secrets with placeholder value `REPLACE_ME`.
Replace every one before restarting the App Service.

```bash
KV_NAME=matkat-kv-$AZURE_ENV

az keyvault secret set --vault-name $KV_NAME \
  --name AzureTenantId       --value "$TENANT_ID"

az keyvault secret set --vault-name $KV_NAME \
  --name ApiAppClientId      --value "$API_APP_CLIENT_ID"

az keyvault secret set --vault-name $KV_NAME \
  --name ApiAppIdUri         --value "api://$API_APP_CLIENT_ID"

az keyvault secret set --vault-name $KV_NAME \
  --name GraphClientId       --value "$API_APP_CLIENT_ID"

az keyvault secret set --vault-name $KV_NAME \
  --name GraphClientSecret   --value "$GRAPH_CLIENT_SECRET"

az keyvault secret set --vault-name $KV_NAME \
  --name SqlAdminPassword    --value "<SQL_ADMIN_PASSWORD>"

az keyvault secret set --vault-name $KV_NAME \
  --name DatabaseUrl         --value "mssql+pyodbc://sqladmin:<SQL_ADMIN_PASSWORD>@matkat-sql-$AZURE_ENV.database.windows.net/matkat-db-$AZURE_ENV?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no"
```

Replace `<SQL_ADMIN_PASSWORD>` with the value chosen in Step 3.1.

The `DatabaseUrl` format above is the exact SQLAlchemy `mssql+pyodbc://` connection
string that the pyodbc driver in the Docker image expects.

---

## Step 6 — App Service Restart

Force the App Service to resolve the Key Vault references:

```bash
az webapp restart \
  --resource-group $RG \
  --name matkat-api-$AZURE_ENV
```

Check the logs:

```bash
az webapp log tail \
  --resource-group $RG \
  --name matkat-api-$AZURE_ENV
```

Look for: `Starting Resource Allocation API in dev mode` (or `uat`/`prod`).
If you see `REPLACE_ME` in any error, a Key Vault secret was not set correctly.
If the container fails to start, check ACR pull (Step 4).

---

## Step 7 — Alembic Migration

Run the migrations from your local machine against Azure SQL.
The `alembic/env.py` reads `DATABASE_URL` from the environment.

### 7.1 Add a temporary firewall rule for your IP

```bash
MY_IP=$(curl -s https://api.ipify.org)

az sql server firewall-rule create \
  --resource-group $RG \
  --server matkat-sql-$AZURE_ENV \
  --name local-migration \
  --start-ip-address $MY_IP \
  --end-ip-address $MY_IP
```

### 7.2 Run migrations

```bash
cd api

export DATABASE_URL="mssql+pyodbc://sqladmin:<SQL_ADMIN_PASSWORD>@matkat-sql-$AZURE_ENV.database.windows.net/matkat-db-$AZURE_ENV?driver=ODBC+Driver+18+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no"

alembic upgrade head
alembic current   # should show the latest revision hash
```

### 7.3 Remove the firewall rule

```bash
az sql server firewall-rule delete \
  --resource-group $RG \
  --server matkat-sql-$AZURE_ENV \
  --name local-migration
```

---

## Step 8 — Frontend Build + SWA Deploy

> **Critical:** `VITE_*` environment variables are baked into the Vite bundle
> at **build time**. The SWA portal app settings (set by the Bicep module) are
> only injected automatically when using the SWA GitHub Actions CI/CD workflow.
> For a **manual deploy**, you must set the variables in your shell (or in
> `frontend/.env.production`) before running `npm run build`.

### 8.1 Set VITE vars and build

```bash
cd frontend

export VITE_AUTH_CLIENT_ID="$API_APP_CLIENT_ID"
export VITE_AUTH_AUTHORITY="https://login.microsoftonline.com/$TENANT_ID"
export VITE_API_SCOPE="api://$API_APP_CLIENT_ID/.default"
export VITE_API_BASE_URL="https://matkat-api-$AZURE_ENV.azurewebsites.net"
export VITE_DEV_AUTH_BYPASS="false"
export VITE_DEV_SEED_ENABLED="false"

npm ci
npm run build
```

Alternatively, create `frontend/.env.production` with those values (do **not**
commit this file):

```
VITE_AUTH_CLIENT_ID=<API_APP_CLIENT_ID>
VITE_AUTH_AUTHORITY=https://login.microsoftonline.com/<TENANT_ID>
VITE_API_SCOPE=api://<API_APP_CLIENT_ID>/.default
VITE_API_BASE_URL=https://matkat-api-dev.azurewebsites.net
VITE_DEV_AUTH_BYPASS=false
VITE_DEV_SEED_ENABLED=false
```

### 8.2 Get the SWA deployment token

```bash
SWA_DEPLOY_TOKEN=$(az staticwebapp secrets list \
  --name matkat-web-$AZURE_ENV \
  --resource-group $RG \
  --query properties.apiKey -o tsv)
```

### 8.3 Deploy

```bash
# From frontend/
npx @azure/static-web-apps-cli deploy dist \
  --deployment-token $SWA_DEPLOY_TOKEN \
  --env production
```

Note the SWA hostname from the CLI output (e.g. `<random>.azurestaticapps.net`).

---

## Step 9 — Function App Deploy

```bash
cd scheduler

func azure functionapp publish matkat-fn-$AZURE_ENV --python
```

Verify all functions are registered:

```bash
az functionapp function list \
  --resource-group $RG \
  --name matkat-fn-$AZURE_ENV \
  --query "[].name"
# Expected: notification_daily, graph_sync_daily, manual_sync_trigger, manual_trigger
```

---

## Step 10 — CORS Update

Now that you have the SWA hostname, update `corsOrigins` in the parameters file
and re-run the Bicep deploy.

Edit `infra/$AZURE_ENV.parameters.json`:
```json
"corsOrigins": {
  "value": "https://<random>.azurestaticapps.net"
}
```

Re-deploy:

```bash
az deployment group create \
  --resource-group $RG \
  --template-file infra/main.bicep \
  --parameters infra/$AZURE_ENV.parameters.json \
  --name matkat-cors-$(date +%Y%m%d-%H%M)
```

Restart the App Service to apply the updated `CORS_ORIGINS` app setting:

```bash
az webapp restart --resource-group $RG --name matkat-api-$AZURE_ENV
```

---

## Step 11 — Smoke Tests

### Health check

```bash
curl -f https://matkat-api-$AZURE_ENV.azurewebsites.net/health
# Expected: {"status": "ok", ...}
```

### Auth enforcement (unauthenticated request must be rejected)

```bash
curl -i https://matkat-api-$AZURE_ENV.azurewebsites.net/me
# Expected: HTTP 401
```

### Frontend login

Open `https://<swa-hostname>.azurestaticapps.net` in a browser.
The MSAL login page should appear. Log in with a tenant user — you should
reach the dashboard without errors.

### Manual function trigger (requires function key)

```bash
FUNC_KEY=$(az functionapp keys list \
  --resource-group $RG \
  --name matkat-fn-$AZURE_ENV \
  --query functionKeys.default -o tsv)

# Notification trigger (adjust year/month to match existing data)
curl -s -X POST \
  "https://matkat-fn-$AZURE_ENV.azurewebsites.net/api/trigger?code=$FUNC_KEY&phase=PM_RO&year=2026&month=1"

# Graph sync trigger
curl -s -X POST \
  "https://matkat-fn-$AZURE_ENV.azurewebsites.net/api/sync-trigger?code=$FUNC_KEY"
# Expected: JSON with synced/total counts
```

---

## Required Settings by Component

### Backend App Service (`matkat-api-$AZURE_ENV`)

| App Setting | Source |
|-------------|--------|
| `ENV` | Bicep — `environmentName` parameter |
| `DEV_AUTH_BYPASS` | Bicep — hardcoded `false` |
| `AZURE_TENANT_ID` | Key Vault secret `AzureTenantId` |
| `API_APP_CLIENT_ID` | Key Vault secret `ApiAppClientId` |
| `API_APP_ID_URI` | Key Vault secret `ApiAppIdUri` |
| `DATABASE_URL` | Key Vault secret `DatabaseUrl` |
| `GRAPH_CLIENT_ID` | Key Vault secret `GraphClientId` |
| `GRAPH_CLIENT_SECRET` | Key Vault secret `GraphClientSecret` |
| `CORS_ORIGINS` | Bicep — `corsOrigins` parameter (SWA hostname) |
| `AZURE_TENANT_ALLOWLIST` | Bicep — `azureTenantAllowlist` parameter |
| `APPINSIGHTS_CONNECTION_STRING` | Bicep — from monitoring module |
| `NOTIFY_MODE` | Bicep — hardcoded `email` |
| `DOCKER_REGISTRY_SERVER_URL` | Bicep — `https://<acr>.azurecr.io` |
| `WEBSITES_PORT` | Bicep — `8000` |

### Frontend SWA (baked into the build)

| Variable | Value |
|----------|-------|
| `VITE_AUTH_CLIENT_ID` | `$API_APP_CLIENT_ID` |
| `VITE_AUTH_AUTHORITY` | `https://login.microsoftonline.com/$TENANT_ID` |
| `VITE_API_SCOPE` | `api://$API_APP_CLIENT_ID/.default` |
| `VITE_API_BASE_URL` | `https://matkat-api-$AZURE_ENV.azurewebsites.net` |
| `VITE_DEV_AUTH_BYPASS` | `false` |
| `VITE_DEV_SEED_ENABLED` | `false` |

### Function App (`matkat-fn-$AZURE_ENV`)

| App Setting | Source |
|-------------|--------|
| `AzureWebJobsStorage` | Bicep — storage connection string |
| `FUNCTIONS_WORKER_RUNTIME` | Bicep — `python` |
| `FUNCTIONS_EXTENSION_VERSION` | Bicep — `~4` |
| `API_BASE_URL` | Bicep — `https://<webAppHostname>` |
| `DEV_AUTH_BYPASS` | Bicep — `false` |
| `API_APP_CLIENT_ID` | Key Vault secret `ApiAppClientId` |
| `APPINSIGHTS_CONNECTION_STRING` | Bicep — from monitoring module |

---

## Entra Values Needed

| Value | Where used |
|-------|-----------|
| Tenant ID | `AzureTenantId` KV secret · `frontendAuthAuthority` param · `azureTenantAllowlist` param · `VITE_AUTH_AUTHORITY` |
| API App Client ID | `ApiAppClientId` KV secret · `frontendAuthClientId` param · `frontendApiScope` param · `VITE_AUTH_CLIENT_ID` · `VITE_API_SCOPE` |
| App ID URI (`api://<clientId>`) | `ApiAppIdUri` KV secret · `frontendApiScope` · `VITE_API_SCOPE` |
| Graph Client ID | `GraphClientId` KV secret (usually same as API App Client ID) |
| Graph Client Secret | `GraphClientSecret` KV secret (from Step 1.3) |

---

## Note on `AZURE_TENANT_ALLOWLIST`

`AZURE_TENANT_ALLOWLIST` is stored as an app setting and parsed by `api/app/config.py`
into `tenant_allowlist`. However, the authentication middleware
(`SingleTenantAzureAuthorizationCodeBearer`) enforces the tenant via
`AZURE_TENANT_ID` directly — the allowlist is never checked by the auth code path.
For single-tenant deployments, only `AZURE_TENANT_ID` matters for enforcement.
The allowlist setting is harmless and may be left empty or pre-populated for future use.

---

## UAT / PROD Promotion Checklist

- [ ] All `REPLACE_BEFORE_DEPLOY` values filled in the parameters file
- [ ] `corsOrigins` initially `""` — updated after SWA deploy (Step 10)
- [ ] `sqlAdminPassword` is strong, unique, and stored securely
- [ ] `backendImageName` uses a versioned tag (not `latest`)
- [ ] Docker push completed for that exact tag
- [ ] Separate (or same with prod secrets) Entra app registration for UAT/PROD
- [ ] All 7 Key Vault secrets populated
- [ ] Alembic migration run against the UAT/PROD database
- [ ] `func azure functionapp publish` targeting the UAT/PROD function app
- [ ] Smoke tests passing (Steps 11.1–11.4)
- [ ] Timer trigger schedule confirmed: Azure Portal → Function App → Functions

---

## Rollback Notes

### App Service — image rollback

```bash
# Roll back to a previous image tag
az webapp config appsettings set \
  --resource-group $RG \
  --name matkat-api-$AZURE_ENV \
  --settings "linuxFxVersion=DOCKER|$ACR_NAME.azurecr.io/matkat-api:<previous-tag>"

az webapp restart --resource-group $RG --name matkat-api-$AZURE_ENV
```

Alternatively, update `backendImageName` in the parameters file and re-run the Bicep deploy.

### Database — Alembic downgrade

```bash
cd api
export DATABASE_URL="<azure-sql-connection-string>"
alembic downgrade -1   # roll back one migration
alembic current        # confirm
```

### SWA — deployment history

In the Azure Portal: Static Web App → Environments → production →
Deployment history → select a previous deployment → **Re-deploy**.

### Function App — previous version

```bash
git stash   # or use the previous commit sha
cd scheduler
func azure functionapp publish matkat-fn-$AZURE_ENV --python
git stash pop
```
