@description('Short project name used in resource naming')
param projectName string

@description('Environment name (dev or uat)')
param environmentName string

@description('SKU for Static Web App: Free (dev) or Standard (uat/prod)')
@allowed(['Free', 'Standard'])
param staticWebAppSku string = 'Free'

@description('Azure AD client ID used by the frontend (MSAL)')
param frontendAuthClientId string

@description('MSAL authority URL, e.g. https://login.microsoftonline.com/<tenant-id>')
param frontendAuthAuthority string

@description('API scope for MSAL token requests, e.g. api://<api-app-id-uri>/.default')
param frontendApiScope string

@description('Base URL of the backend API, e.g. https://<app-service-hostname>')
param apiBaseUrl string

// Static Web Apps have limited region support; eastus2 is broadly available
var staticWebAppLocation = 'westeurope'
var staticWebAppName = '${projectName}-web-${environmentName}'

resource staticWebApp 'Microsoft.Web/staticSites@2023-01-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: {
    name: staticWebAppSku
    tier: staticWebAppSku
  }
  properties: {
    // Build is handled externally (npm run build + deploy token)
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
  }
}

resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2023-01-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    VITE_AUTH_CLIENT_ID: frontendAuthClientId
    VITE_AUTH_AUTHORITY: frontendAuthAuthority
    VITE_API_SCOPE: frontendApiScope
    VITE_API_BASE_URL: apiBaseUrl
    VITE_DEV_AUTH_BYPASS: 'false'
    VITE_DEV_SEED_ENABLED: 'false'
  }
}

output staticWebAppHostname string = staticWebApp.properties.defaultHostname
output staticWebAppName string = staticWebApp.name
// Deployment token — use with: az staticwebapp secrets list or SWA CLI
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
