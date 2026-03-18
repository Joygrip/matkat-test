@description('Short project name used in resource naming')
param projectName string

@description('Environment name (dev or uat)')
param environmentName string

@description('Azure region for all resources')
param location string

// Storage account names must be 3-24 chars, lowercase alphanumeric only
var storageAccountName = toLower('st${projectName}${environmentName}')

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// Build connection string for Function App AzureWebJobsStorage
var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

output storageAccountName string = storageAccount.name
output storageConnectionString string = storageConnectionString
