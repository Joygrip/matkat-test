/**
 * Development-only login panel for testing different roles.
 */
import {
  Card,
  Button,
  Dropdown,
  Option,
  Input,
  Label,
  makeStyles,
  tokens,
  Title2,
  Body1,
  Badge,
} from '@fluentui/react-components';
import { PersonRegular, BuildingRegular, KeyRegular, PeopleRegular } from '@fluentui/react-icons';
import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { UserRole, DevAuthState } from '../types';
import { apiClient } from '../api/client';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    padding: tokens.spacingHorizontalXXL,
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  },
  card: {
    width: '100%',
    maxWidth: '420px',
    padding: tokens.spacingHorizontalXL,
    borderRadius: tokens.borderRadiusXLarge,
    boxShadow: tokens.shadow64,
    background: 'rgba(255, 255, 255, 0.98)',
    backdropFilter: 'blur(10px)',
  },
  header: {
    textAlign: 'center',
    marginBottom: tokens.spacingVerticalXL,
  },
  title: {
    color: '#0f3460',
    marginBottom: tokens.spacingVerticalS,
  },
  subtitle: {
    color: tokens.colorNeutralForeground3,
  },
  devBadge: {
    marginLeft: tokens.spacingHorizontalS,
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  button: {
    marginTop: tokens.spacingVerticalM,
    height: '44px',
    background: 'linear-gradient(135deg, #0f3460 0%, #16213e 100%)',
  },
  warning: {
    padding: tokens.spacingHorizontalM,
    background: tokens.colorPaletteYellowBackground1,
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorPaletteYellowForeground2,
    marginTop: tokens.spacingVerticalM,
  },
});

const roles: UserRole[] = ['Admin', 'Finance', 'PM', 'RO', 'Director', 'Employee'];

export function DevLoginPanel() {
  const styles = useStyles();
  const { setDevAuth } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole>('Admin');
  const [tenantId, setTenantId] = useState('dev-tenant-001');
  const [email, setEmail] = useState('dev@example.com');
  const [displayName, setDisplayName] = useState('Dev User');
  const [resources, setResources] = useState<Array<{
    resource_id: string;
    display_name: string;
    employee_id: string;
    email: string | null;
    user_object_id: string;
    user_id: string;
  }>>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [loadingResources, setLoadingResources] = useState(false);

  // Load resources when Employee role is selected
  useEffect(() => {
    if (selectedRole === 'Employee') {
      loadResources();
    } else {
      setResources([]);
      setSelectedResourceId('');
    }
  }, [selectedRole]);

  const loadResources = async () => {
    try {
      setLoadingResources(true);
      // Try to load resources with user info - might fail if backend not running, that's ok
      const data = await apiClient.getResourcesWithUsers().catch(() => []);
      setResources(data);
      // Auto-select first resource if available
      if (data.length > 0 && !selectedResourceId) {
        setSelectedResourceId(data[0].resource_id);
        const firstResource = data[0];
        setEmail(firstResource.email || `emp-${firstResource.employee_id}@example.com`);
        setDisplayName(firstResource.display_name);
      }
    } catch (err) {
      console.error('Failed to load resources:', err);
      setResources([]);
    } finally {
      setLoadingResources(false);
    }
  };

  const handleLogin = () => {
    // For employees, use the resource's user_object_id if available
    let userId = `${selectedRole.toLowerCase()}-001`;
    let finalEmail = email;
    let finalDisplayName = displayName;

    if (selectedRole === 'Employee' && selectedResourceId) {
      const selectedResource = resources.find(r => r.resource_id === selectedResourceId);
      if (selectedResource) {
        // Use the user's object_id (which is what the backend uses to find the user)
        userId = selectedResource.user_object_id;
        finalEmail = selectedResource.email || email;
        finalDisplayName = selectedResource.display_name || displayName;
      } else {
        // Resource not found, show error
        alert('Please select a valid resource');
        return;
      }
    }

    const auth: DevAuthState = {
      role: selectedRole,
      tenantId,
      userId,
      email: finalEmail,
      displayName: finalDisplayName,
      resourceId: selectedRole === 'Employee' ? selectedResourceId : undefined,
    };
    setDevAuth(auth);
  };

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Title2 className={styles.title}>
            MatKat 2.0
            <Badge className={styles.devBadge} appearance="filled" color="warning">
              DEV
            </Badge>
          </Title2>
          <Body1 className={styles.subtitle}>Resource Allocation System</Body1>
        </div>

        <div className={styles.form}>
          <div className={styles.field}>
            <Label htmlFor="role">
              <PersonRegular /> Role
            </Label>
            <Dropdown
              id="role"
              value={selectedRole}
              selectedOptions={[selectedRole]}
              onOptionSelect={(_, data) => setSelectedRole(data.optionValue as UserRole)}
            >
              {roles.map((role) => (
                <Option key={role} value={role}>
                  {role}
                </Option>
              ))}
            </Dropdown>
          </div>

          <div className={styles.field}>
            <Label htmlFor="tenant">
              <BuildingRegular /> Tenant ID
            </Label>
            <Input
              id="tenant"
              value={tenantId}
              onChange={(_, data) => setTenantId(data.value)}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(_, data) => setEmail(data.value)}
            />
          </div>

          <div className={styles.field}>
            <Label htmlFor="name">Display Name</Label>
            <Input
              id="name"
              value={displayName}
              onChange={(_, data) => setDisplayName(data.value)}
              disabled={selectedRole === 'Employee' && selectedResourceId !== ''}
            />
          </div>

          {selectedRole === 'Employee' && (
            <div className={styles.field}>
              <Label htmlFor="resource">
                <PeopleRegular /> Resource
              </Label>
              {loadingResources ? (
                <Body1 style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                  Loading resources...
                </Body1>
              ) : resources.length === 0 ? (
                <Body1 style={{ color: tokens.colorNeutralForeground3, fontStyle: 'italic' }}>
                  No resources available. Make sure backend is running and example data is created.
                </Body1>
              ) : (
                <Dropdown
                  id="resource"
                  value={selectedResourceId}
                  selectedOptions={selectedResourceId ? [selectedResourceId] : []}
                  onOptionSelect={(_, data) => {
                    const resourceId = data.optionValue as string;
                    setSelectedResourceId(resourceId);
                    const resource = resources.find(r => r.resource_id === resourceId);
                    if (resource) {
                      setEmail(resource.email || `emp-${resource.employee_id}@example.com`);
                      setDisplayName(resource.display_name);
                    }
                  }}
                >
                  {resources.map((resource) => (
                    <Option key={resource.resource_id} value={resource.resource_id}>
                      {resource.display_name} ({resource.employee_id})
                    </Option>
                  ))}
                </Dropdown>
              )}
            </div>
          )}

          <Button
            className={styles.button}
            appearance="primary"
            size="large"
            icon={<KeyRegular />}
            onClick={handleLogin}
          >
            Login as {selectedRole}
          </Button>

          <div className={styles.warning}>
            ⚠️ This is a development-only login. In production, Azure AD authentication is used.
          </div>
        </div>
      </Card>
    </div>
  );
}
