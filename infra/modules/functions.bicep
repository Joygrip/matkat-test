@description('Short project name used in resource naming')
param projectName string

@description('Environment name (dev or uat)')
param environmentName string

@description('Azure region for all resources')
param location string

@description('Storage Account connection string for AzureWebJobsStorage')
param storageConnectionString string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Backend Web App hostname (used as API_BASE_URL)')
param webAppHostname string

@description('Key Vault secret URI for API_APP_CLIENT_ID (used by managed identity token acquisition)')
param kvSecretUriApiClientId string

var consumptionPlanName = '${projectName}-fnplan-${environmentName}'
var funcAppName = '${projectName}-fn-${environmentName}'

resource consumptionPlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: consumptionPlanName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource functionApp 'Microsoft.Web/sites@2023-01-01' = {
  name: funcAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: consumptionPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'Python|3.11'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'python'
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'API_BASE_URL'
          value: 'https://${webAppHostname}'
        }
        {
          name: 'DEV_AUTH_BYPASS'
          value: 'false'
        }
        {
          name: 'API_APP_CLIENT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriApiClientId})'
        }
        {
          name: 'APPINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
      ]
    }
  }
}

output funcAppName string = functionApp.name
output funcAppHostname string = functionApp.properties.defaultHostName
output funcAppPrincipalId string = functionApp.identity.principalId
