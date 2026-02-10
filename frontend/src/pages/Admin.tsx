/**
 * Admin page for managing master data.
 */
import { useState, useEffect } from 'react';
import {
  Card,
  TabList,
  Tab,
  Table,
  TableHeader,
  TableRow,
  TableHeaderCell,
  TableBody,
  TableCell,
  Button,
  Badge,
  Spinner,
  Dialog,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogActions,
  DialogContent,
  Input,
  Label,
  Checkbox,
  makeStyles,
  tokens,
  Title3,
  SelectTabEventHandler,
  Select,
  MessageBar,
  MessageBarBody,
} from '@fluentui/react-components';
import {
  AddRegular,
  EditRegular,
  DeleteRegular,
  BuildingRegular,
  OrganizationRegular,
  FolderRegular,
  PersonRegular,
  PersonQuestionMarkRegular,
  CalendarRegular,
  SettingsRegular,
} from '@fluentui/react-icons';
import { adminApi, Department, CostCenter, Project, Resource, Placeholder, Holiday, Setting } from '../api/admin';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../auth/AuthProvider';
import { config } from '../config';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
  },
  card: {
    padding: tokens.spacingHorizontalL,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacingVerticalL,
  },
  tabContent: {
    marginTop: tokens.spacingVerticalL,
  },
  dialogField: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    marginBottom: tokens.spacingVerticalM,
  },
  checkboxGroup: {
    display: 'flex',
    gap: tokens.spacingHorizontalL,
    flexWrap: 'wrap',
  },
});

type TabValue = 'departments' | 'cost-centers' | 'projects' | 'resources' | 'placeholders' | 'holidays' | 'settings';

export function Admin() {
  const styles = useStyles();
  const { showSuccess, showApiError } = useToast();
  const { user } = useAuth();
  const [selectedTab, setSelectedTab] = useState<TabValue>('departments');
  const [loading, setLoading] = useState(true);
  
  // Finance and Admin can manage master data; Finance cannot manage Settings
  const canManageMasterData = user?.role === 'Admin' || user?.role === 'Finance';
  const canManageSettings = user?.role === 'Admin';
  
  // Data states
  const [departments, setDepartments] = useState<Department[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  
  // Dialog states
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<unknown>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  
  useEffect(() => {
    loadData();
  }, [selectedTab]);
  
  const loadData = async () => {
    setLoading(true);
    try {
      switch (selectedTab) {
        case 'departments':
          setDepartments(await adminApi.listDepartments());
          break;
        case 'cost-centers':
          const [ccData, deptData] = await Promise.all([
            adminApi.listCostCenters(),
            adminApi.listDepartments(),
          ]);
          setCostCenters(ccData);
          setDepartments(deptData);
          break;
        case 'projects':
          setProjects(await adminApi.listProjects());
          break;
        case 'resources':
          const [resData, ccData2] = await Promise.all([
            adminApi.listResources(),
            adminApi.listCostCenters(),
          ]);
          setResources(resData);
          setCostCenters(ccData2);
          break;
        case 'placeholders':
          setPlaceholders(await adminApi.listPlaceholders());
          break;
        case 'holidays':
          setHolidays(await adminApi.listHolidays());
          break;
        case 'settings':
          if (canManageSettings) {
            setSettings(await adminApi.listSettings());
          }
          break;
      }
    } catch (error) {
      console.error('Admin loadData error:', error);
      showApiError(error as Error, 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  };
  
  const handleTabSelect: SelectTabEventHandler = (_, data) => {
    setSelectedTab(data.value as TabValue);
  };
  
  const openCreateDialog = () => {
    setEditItem(null);
    setFormData({});
    setDialogOpen(true);
  };
  
  const openEditDialog = (item: unknown) => {
    setEditItem(item);
    setFormData(item as Record<string, unknown>);
    setDialogOpen(true);
  };
  
  const handleSave = async () => {
    try {
      switch (selectedTab) {
        case 'departments':
          if (editItem) {
            await adminApi.updateDepartment((editItem as Department).id, formData as Partial<Department>);
          } else {
            await adminApi.createDepartment(formData as { code: string; name: string });
          }
          break;
        case 'cost-centers':
          if (editItem) {
            await adminApi.updateCostCenter((editItem as CostCenter).id, formData as Partial<CostCenter>);
          } else {
            await adminApi.createCostCenter(formData as { department_id: string; code: string; name: string });
          }
          break;
        case 'projects':
          if (editItem) {
            await adminApi.updateProject((editItem as Project).id, formData as Partial<Project>);
          } else {
            await adminApi.createProject(formData as { code: string; name: string });
          }
          break;
        case 'resources':
          if (editItem) {
            await adminApi.updateResource((editItem as Resource).id, formData as Partial<Resource>);
          } else {
            await adminApi.createResource(formData as {
              cost_center_id: string;
              employee_id: string;
              display_name: string;
            });
          }
          break;
        case 'placeholders':
          if (editItem) {
            await adminApi.updatePlaceholder((editItem as Placeholder).id, formData as Partial<Placeholder>);
          } else {
            await adminApi.createPlaceholder(formData as { name: string });
          }
          break;
        case 'holidays':
          await adminApi.createHoliday(formData as { date: string; name: string });
          break;
        case 'settings':
          if (!canManageSettings) {
            showApiError(new Error('Only Admin can manage settings'), 'Permission denied');
            return;
          }
          if (editItem) {
            await adminApi.updateSetting((editItem as Setting).key, formData as { value: string });
          } else {
            await adminApi.createSetting(formData as { key: string; value: string });
          }
          break;
      }
      
      showSuccess('Saved', `${selectedTab} saved successfully`);
      setDialogOpen(false);
      loadData();
    } catch (error) {
      showApiError(error as Error, 'Failed to save');
    }
  };
  
  const handleDelete = async (item: unknown) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      switch (selectedTab) {
        case 'departments':
          await adminApi.deleteDepartment((item as Department).id);
          break;
        case 'cost-centers':
          await adminApi.deleteCostCenter((item as CostCenter).id);
          break;
        case 'projects':
          await adminApi.deleteProject((item as Project).id);
          break;
        case 'resources':
          await adminApi.deleteResource((item as Resource).id);
          break;
        case 'placeholders':
          await adminApi.deletePlaceholder((item as Placeholder).id);
          break;
        case 'holidays':
          await adminApi.deleteHoliday((item as Holiday).id);
          break;
        case 'settings':
          if (!canManageSettings) {
            showApiError(new Error('Only Admin can manage settings'), 'Permission denied');
            return;
          }
          await adminApi.deleteSetting((item as Setting).key);
          break;
      }
      
      showSuccess('Deleted', 'Item deleted successfully');
      loadData();
    } catch (error) {
      showApiError(error as Error, 'Failed to delete');
    }
  };
  
  const renderTable = () => {
    if (loading) return <Spinner label="Loading..." />;
    
    switch (selectedTab) {
      case 'departments':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {departments.map((dept) => (
                <TableRow key={dept.id}>
                  <TableCell>{dept.code}</TableCell>
                  <TableCell>{dept.name}</TableCell>
                  <TableCell>
                    <Badge color={dept.is_active ? 'success' : 'danger'}>
                      {dept.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManageMasterData && (
                      <>
                        <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(dept)} />
                        <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(dept)} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      
      case 'cost-centers':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Department</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costCenters.map((cc) => (
                <TableRow key={cc.id}>
                  <TableCell>{cc.code}</TableCell>
                  <TableCell>{cc.name}</TableCell>
                  <TableCell>{departments.find(d => d.id === cc.department_id)?.name || '-'}</TableCell>
                  <TableCell>
                    <Badge color={cc.is_active ? 'success' : 'danger'}>
                      {cc.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManageMasterData && (
                      <>
                        <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(cc)} />
                        <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(cc)} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      
      case 'projects':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Code</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>{project.code}</TableCell>
                  <TableCell>{project.name}</TableCell>
                  <TableCell>
                    <Badge color={project.is_active ? 'success' : 'danger'}>
                      {project.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManageMasterData && (
                      <>
                        <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(project)} />
                        <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(project)} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      
      case 'resources':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Employee ID</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Cost Center</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resources.map((resource) => (
                <TableRow key={resource.id}>
                  <TableCell>{resource.employee_id}</TableCell>
                  <TableCell>{resource.display_name}</TableCell>
                  <TableCell>{costCenters.find(cc => cc.id === resource.cost_center_id)?.name || '-'}</TableCell>
                  <TableCell>
                    {resource.is_oop ? (
                      <Badge color="warning">OoP</Badge>
                    ) : (
                      <Badge color="brand">Internal</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {canManageMasterData && (
                      <>
                        <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(resource)} />
                        <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(resource)} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      
      case 'placeholders':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Skill Profile</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {placeholders.map((ph) => (
                <TableRow key={ph.id}>
                  <TableCell>{ph.name}</TableCell>
                  <TableCell>{ph.skill_profile || '-'}</TableCell>
                  <TableCell>
                    <Badge color={ph.is_active ? 'success' : 'danger'}>
                      {ph.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {canManageMasterData && (
                      <>
                        <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(ph)} />
                        <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(ph)} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      
      case 'holidays':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Company-Wide</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidays.map((holiday) => (
                <TableRow key={holiday.id}>
                  <TableCell>{new Date(holiday.date).toLocaleDateString()}</TableCell>
                  <TableCell>{holiday.name}</TableCell>
                  <TableCell>{holiday.is_company_wide ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    {canManageMasterData && (
                      <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(holiday)} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
      
      case 'settings':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Key</TableHeaderCell>
                <TableHeaderCell>Value</TableHeaderCell>
                <TableHeaderCell>Description</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {settings.map((setting) => (
                <TableRow key={setting.id}>
                  <TableCell>{setting.key}</TableCell>
                  <TableCell>{setting.value}</TableCell>
                  <TableCell>{setting.description || '-'}</TableCell>
                  <TableCell>
                    {canManageSettings && (
                      <>
                        <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(setting)} />
                        <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(setting)} />
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );
    }
  };
  
  const renderDialogForm = () => {
    switch (selectedTab) {
      case 'departments':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Code</Label>
              <Input
                value={String(formData.code || '')}
                onChange={(_, d) => setFormData({ ...formData, code: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
          </>
        );
      
      case 'cost-centers':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Department</Label>
              <select
                value={String(formData.department_id || '')}
                onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                style={{ padding: '8px', borderRadius: '4px' }}
              >
                <option value="">Select Department</option>
                {departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>{dept.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.dialogField}>
              <Label required>Code</Label>
              <Input
                value={String(formData.code || '')}
                onChange={(_, d) => setFormData({ ...formData, code: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
          </>
        );
      
      case 'projects':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Code</Label>
              <Input
                value={String(formData.code || '')}
                onChange={(_, d) => setFormData({ ...formData, code: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
          </>
        );
      
      case 'resources':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Cost Center</Label>
              <select
                value={String(formData.cost_center_id || '')}
                onChange={(e) => setFormData({ ...formData, cost_center_id: e.target.value })}
                style={{ padding: '8px', borderRadius: '4px' }}
              >
                <option value="">Select Cost Center</option>
                {costCenters.map((cc) => (
                  <option key={cc.id} value={cc.id}>{cc.name}</option>
                ))}
              </select>
            </div>
            <div className={styles.dialogField}>
              <Label required>Employee ID</Label>
              <Input
                value={String(formData.employee_id || '')}
                onChange={(_, d) => setFormData({ ...formData, employee_id: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Display Name</Label>
              <Input
                value={String(formData.display_name || '')}
                onChange={(_, d) => setFormData({ ...formData, display_name: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Email</Label>
              <Input
                value={String(formData.email || '')}
                onChange={(_, d) => setFormData({ ...formData, email: d.value })}
              />
            </div>
            <div className={styles.checkboxGroup}>
              <Checkbox
                label="External"
                checked={Boolean(formData.is_external)}
                onChange={(_, d) => setFormData({ ...formData, is_external: d.checked })}
              />
              <Checkbox
                label="Student"
                checked={Boolean(formData.is_student)}
                onChange={(_, d) => setFormData({ ...formData, is_student: d.checked })}
              />
              <Checkbox
                label="Operator"
                checked={Boolean(formData.is_operator)}
                onChange={(_, d) => setFormData({ ...formData, is_operator: d.checked })}
              />
              <Checkbox
                label="Equipment"
                checked={Boolean(formData.is_equipment)}
                onChange={(_, d) => setFormData({ ...formData, is_equipment: d.checked })}
              />
            </div>
          </>
        );
      
      case 'placeholders':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Skill Profile</Label>
              <Input
                value={String(formData.skill_profile || '')}
                onChange={(_, d) => setFormData({ ...formData, skill_profile: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Description</Label>
              <Input
                value={String(formData.description || '')}
                onChange={(_, d) => setFormData({ ...formData, description: d.value })}
              />
            </div>
          </>
        );
      
      case 'holidays':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Date</Label>
              <Input
                type="date"
                value={String(formData.date || '').split('T')[0]}
                onChange={(_, d) => setFormData({ ...formData, date: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label required>Name</Label>
              <Input
                value={String(formData.name || '')}
                onChange={(_, d) => setFormData({ ...formData, name: d.value })}
              />
            </div>
            <Checkbox
              label="Company-Wide"
              checked={formData.is_company_wide !== false}
              onChange={(_, d) => setFormData({ ...formData, is_company_wide: d.checked })}
            />
          </>
        );
      
      case 'settings':
        return (
          <>
            {!editItem && (
              <div className={styles.dialogField}>
                <Label required>Key</Label>
                <Input
                  value={String(formData.key || '')}
                  onChange={(_, d) => setFormData({ ...formData, key: d.value })}
                />
              </div>
            )}
            <div className={styles.dialogField}>
              <Label required>Value</Label>
              <Input
                value={String(formData.value || '')}
                onChange={(_, d) => setFormData({ ...formData, value: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Description</Label>
              <Input
                value={String(formData.description || '')}
                onChange={(_, d) => setFormData({ ...formData, description: d.value })}
              />
            </div>
          </>
        );
    }
  };
  
  const tabLabels: Record<TabValue, string> = {
    'departments': 'Departments',
    'cost-centers': 'Cost Centers',
    'projects': 'Projects',
    'resources': 'Resources',
    'placeholders': 'Placeholders',
    'holidays': 'Holidays',
    'settings': 'Settings',
  };
  
  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <TabList selectedValue={selectedTab} onTabSelect={handleTabSelect}>
          <Tab value="departments" icon={<BuildingRegular />}>Departments</Tab>
          <Tab value="cost-centers" icon={<OrganizationRegular />}>Cost Centers</Tab>
          <Tab value="projects" icon={<FolderRegular />}>Projects</Tab>
          <Tab value="resources" icon={<PersonRegular />}>Resources</Tab>
          <Tab value="placeholders" icon={<PersonQuestionMarkRegular />}>Placeholders</Tab>
          <Tab value="holidays" icon={<CalendarRegular />}>Holidays</Tab>
          {canManageSettings && (
            <Tab value="settings" icon={<SettingsRegular />}>Settings</Tab>
          )}
        </TabList>
        
        <div className={styles.tabContent}>
          <div className={styles.header}>
            <Title3>{tabLabels[selectedTab]}</Title3>
            {(canManageMasterData || (selectedTab === 'settings' && canManageSettings)) && (
              <Button
                appearance="primary"
                icon={<AddRegular />}
                onClick={openCreateDialog}
              >
                Add {tabLabels[selectedTab].slice(0, -1)}
              </Button>
            )}
          </div>
          
          {renderTable()}
        </div>
      </Card>
      
      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(_, data) => setDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {editItem ? 'Edit' : 'Create'} {tabLabels[selectedTab].slice(0, -1)}
            </DialogTitle>
            <DialogContent>
              {renderDialogForm()}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={handleSave}>
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      
    </div>
  );
}
