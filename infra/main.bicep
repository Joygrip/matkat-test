// ============================================================
// main.bicep — Matkat Azure Infrastructure Orchestrator
// Deploy with:
//   az deployment group create \
//     --resource-group rg-matkat-dev \
//     --template-file infra/main.bicep \
//     --parameters infra/dev.parameters.json
// ============================================================

@description('Short project name used in all resource naming (lowercase, no hyphens)')
param projectName string

@description('Environment name: dev, uat or prod')
@allowed(['dev', 'uat', 'prod'])
param environmentName string

@description('Azure region for all resources (Static Web App always deploys to eastus2)')
param location string = resourceGroup().location

@description('SQL Server administrator login name')
param sqlAdminLogin string

@description('SQL Server administrator login password')
@secure()
param sqlAdminPassword string

@description('Container registry name without the .azurecr.io suffix')
param containerRegistryName string

@description('Container image name and tag, e.g. matkat-api:latest')
param backendImageName string

@description('App Service Plan SKU name (e.g. B1, B2, S1)')
param appServiceSkuName string = 'B1'

@description('Azure SQL Database SKU (Basic, S0, GP_S_Gen5_1, etc.)')
param sqlDatabaseSku string = 'Basic'

@description('Static Web App SKU (Free or Standard)')
@allowed(['Free', 'Standard'])
param staticWebAppSku string = 'Free'

@description('Azure AD client ID used by the frontend (MSAL)')
param frontendAuthClientId string

@description('MSAL authority URL, e.g. https://login.microsoftonline.com/<tenant-id>')
param frontendAuthAuthority string

@description('API scope for MSAL token requests, e.g. api://<api-app-id-uri>/.default')
param frontendApiScope string

@description('Comma-separated Entra tenant GUIDs allowed to authenticate against the API')
param azureTenantAllowlist string = ''

@description('Comma-separated CORS origins for the API backend, e.g. "https://app.azurestaticapps.net". Set after Static Web App is first deployed.')
param corsOrigins string = ''

// ── Derive Key Vault name upfront to break circular dependency ──────────────
var keyVaultName = '${projectName}-kv-${environmentName}'
var kvBaseUri = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets'

var kvSecretUriTenantId          = '${kvBaseUri}/AzureTenantId/'
var kvSecretUriApiClientId       = '${kvBaseUri}/ApiAppClientId/'
var kvSecretUriApiIdUri          = '${kvBaseUri}/ApiAppIdUri/'
var kvSecretUriDatabaseUrl       = '${kvBaseUri}/DatabaseUrl/'
var kvSecretUriGraphClientId     = '${kvBaseUri}/GraphClientId/'
var kvSecretUriGraphClientSecret = '${kvBaseUri}/GraphClientSecret/'

// ── 1. Storage Account ──────────────────────────────────────
module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    projectName: projectName
    environmentName: environmentName
    location: location
  }
}

// ── 2. Monitoring (Log Analytics + App Insights) ────────────
module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    projectName: projectName
    environmentName: environmentName
    location: location
  }
}

// ── 3. Database (SQL Server + Database) ─────────────────────
module database 'modules/database.bicep' = {
  name: 'database'
  params: {
    projectName: projectName
    environmentName: environmentName
    location: location
    sqlAdminLogin: sqlAdminLogin
    sqlAdminPassword: sqlAdminPassword
    sqlDatabaseSku: sqlDatabaseSku
  }
}

// ── 4. Static Web App (frontend) ────────────────────────────
module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticWebApp'
  params: {
    projectName: projectName
    environmentName: environmentName
    staticWebAppSku: staticWebAppSku
    frontendAuthClientId: frontendAuthClientId
    frontendAuthAuthority: frontendAuthAuthority
    frontendApiScope: frontendApiScope
    apiBaseUrl: 'https://${appService.outputs.webAppHostname}'
  }
  dependsOn: [appService]
}

// ── 5. App Service (backend container) ──────────────────────
module appService 'modules/appservice.bicep' = {
  name: 'appService'
  params: {
    projectName: projectName
    environmentName: environmentName
    location: location
    appServiceSkuName: appServiceSkuName
    containerRegistryName: containerRegistryName
    backendImageName: backendImageName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    kvSecretUriTenantId: kvSecretUriTenantId
    kvSecretUriApiClientId: kvSecretUriApiClientId
    kvSecretUriApiIdUri: kvSecretUriApiIdUri
    kvSecretUriDatabaseUrl: kvSecretUriDatabaseUrl
    kvSecretUriGraphClientId: kvSecretUriGraphClientId
    kvSecretUriGraphClientSecret: kvSecretUriGraphClientSecret
    corsOrigins: corsOrigins
    azureTenantAllowlist: azureTenantAllowlist
  }
}

// ── 6. Function App (scheduler) — deployed separately in rg-matkat-dev-fn ──
// module functionApp 'modules/functions.bicep' = {
//   name: 'functionApp'
//   params: {
//     projectName: projectName
//     environmentName: environmentName
//     location: location
//     storageConnectionString: storage.outputs.storageConnectionString
//     appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
//     webAppHostname: appService.outputs.webAppHostname
//     kvSecretUriApiClientId: kvSecretUriApiClientId
//   }
// }

// ── 7. Key Vault — already deployed separately ──────────────
// module keyVault 'modules/keyvault.bicep' = {
//   name: 'keyVault'
//   params: {
//     projectName: projectName
//     environmentName: environmentName
//     location: location
//     webAppPrincipalId: appService.outputs.webAppPrincipalId
//     funcAppPrincipalId: functionApp.outputs.funcAppPrincipalId
//   }
// }

// ── Outputs ──────────────────────────────────────────────────
output webAppHostname string = appService.outputs.webAppHostname
// output funcAppHostname string = functionApp.outputs.funcAppHostname
output staticWebAppHostname string = staticWebApp.outputs.staticWebAppHostname
// output keyVaultUri string = keyVault.outputs.keyVaultUri
output sqlServerFqdn string = database.outputs.sqlServerFqdn
output sqlDatabaseName string = database.outputs.sqlDatabaseName
output appInsightsConnectionString string = monitoring.outputs.appInsightsConnectionString
