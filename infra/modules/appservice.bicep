@description('Short project name used in resource naming')
param projectName string

@description('Environment name (dev or uat)')
param environmentName string

@description('Azure region for all resources')
param location string

@description('App Service Plan SKU (e.g. B1, B2, S1)')
param appServiceSkuName string = 'B1'

@description('Container registry name (without .azurecr.io)')
param containerRegistryName string

@description('Container image name and tag (e.g. matkat-api:latest)')
param backendImageName string

@description('Application Insights connection string')
param appInsightsConnectionString string

@description('Key Vault secret URI for AZURE_TENANT_ID')
param kvSecretUriTenantId string

@description('Key Vault secret URI for API_APP_CLIENT_ID')
param kvSecretUriApiClientId string

@description('Key Vault secret URI for API_APP_ID_URI')
param kvSecretUriApiIdUri string

@description('Key Vault secret URI for DATABASE_URL')
param kvSecretUriDatabaseUrl string

@description('Key Vault secret URI for GRAPH_CLIENT_ID')
param kvSecretUriGraphClientId string

@description('Key Vault secret URI for GRAPH_CLIENT_SECRET')
param kvSecretUriGraphClientSecret string

var appServicePlanName = '${projectName}-plan-${environmentName}'
var webAppName = '${projectName}-api-${environmentName}'

resource appServicePlan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  kind: 'Linux'
  sku: {
    name: appServiceSkuName
  }
  properties: {
    reserved: true // required for Linux
  }
}

resource webApp 'Microsoft.Web/sites@2023-01-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${containerRegistryName}.azurecr.io/${backendImageName}'
      alwaysOn: true
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${containerRegistryName}.azurecr.io'
        }
        {
          name: 'WEBSITES_PORT'
          value: '8000'
        }
        {
          name: 'ENV'
          value: environmentName
        }
        {
          name: 'DEV_AUTH_BYPASS'
          value: 'false'
        }
        {
          name: 'NOTIFY_MODE'
          value: 'email'
        }
        {
          name: 'APPINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // Key Vault references — values populated post-deploy by filling KV secrets
        {
          name: 'AZURE_TENANT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriTenantId})'
        }
        {
          name: 'API_APP_CLIENT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriApiClientId})'
        }
        {
          name: 'API_APP_ID_URI'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriApiIdUri})'
        }
        {
          name: 'DATABASE_URL'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriDatabaseUrl})'
        }
        {
          name: 'GRAPH_CLIENT_ID'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriGraphClientId})'
        }
        {
          name: 'GRAPH_CLIENT_SECRET'
          value: '@Microsoft.KeyVault(SecretUri=${kvSecretUriGraphClientSecret})'
        }
      ]
    }
  }
}

output webAppName string = webApp.name
output webAppHostname string = webApp.properties.defaultHostName
output webAppPrincipalId string = webApp.identity.principalId
