@description('Short project name used in resource naming')
param projectName string

@description('Environment name (dev or uat)')
param environmentName string

@description('Azure region for all resources')
param location string

@description('Principal ID of the Web App managed identity')
param webAppPrincipalId string

@description('Principal ID of the Function App managed identity')
param funcAppPrincipalId string

var keyVaultName = '${projectName}-kv-${environmentName}'

// Built-in role: Key Vault Secrets User
var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
    enableRbacAuthorization: true
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
  }
}

// --- Secret placeholders (replace values post-deploy) ---

resource secretTenantId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'AzureTenantId'
  properties: {
    value: 'REPLACE_ME'
  }
}

resource secretApiClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ApiAppClientId'
  properties: {
    value: 'REPLACE_ME'
  }
}

resource secretApiIdUri 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'ApiAppIdUri'
  properties: {
    value: 'REPLACE_ME'
  }
}

resource secretGraphClientId 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GraphClientId'
  properties: {
    value: 'REPLACE_ME'
  }
}

resource secretGraphClientSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'GraphClientSecret'
  properties: {
    value: 'REPLACE_ME'
  }
}

resource secretDatabaseUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'DatabaseUrl'
  properties: {
    value: 'REPLACE_ME'
  }
}

resource secretSqlAdminPassword 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'SqlAdminPassword'
  properties: {
    value: 'REPLACE_ME'
  }
}

// --- RBAC: Grant Web App managed identity read access to secrets ---

resource webAppKvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webAppPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: webAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// --- RBAC: Grant Function App managed identity read access to secrets ---

resource funcAppKvRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, funcAppPrincipalId, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
    principalId: funcAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output keyVaultUri string = keyVault.properties.vaultUri
output keyVaultName string = keyVault.name

// Outputs: secret URIs for use in App Settings KV references
output secretUriTenantId string = secretTenantId.properties.secretUri
output secretUriApiClientId string = secretApiClientId.properties.secretUri
output secretUriApiIdUri string = secretApiIdUri.properties.secretUri
output secretUriGraphClientId string = secretGraphClientId.properties.secretUri
output secretUriGraphClientSecret string = secretGraphClientSecret.properties.secretUri
output secretUriDatabaseUrl string = secretDatabaseUrl.properties.secretUri
