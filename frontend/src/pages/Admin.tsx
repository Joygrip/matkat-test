/**
 * Admin page for managing master data.
 */
import { useState, useEffect, useCallback } from 'react';
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
  Text,
} from '@fluentui/react-components';
import {
  AddRegular,
  EditRegular,
  DeleteRegular,
  OrganizationRegular,
  FolderRegular,
  PersonRegular,
  PersonQuestionMarkRegular,
  CalendarRegular,
  SettingsRegular,
  PeopleTeamRegular,
  ChevronRightRegular,
} from '@fluentui/react-icons';
import {
  adminApi,
  CostCenter,
  Project,
  Resource,
  Placeholder,
  Holiday,
  Setting,
  ManagerOverride,
  ApprovalDelegate,
  AdminUser,
  AdminUserDetail,
} from '../api/admin';
import type { UserRole } from '../types';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../auth/AuthProvider';
import { AdminToolbar } from '../components/admin/AdminToolbar';
import { StatusPill, projectStatus, resourceStatus } from '../components/admin/StatusPill';

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
    marginBottom: tokens.spacingVerticalM,
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
  clickableRow: {
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  statusToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
  },
  detailGrid: {
    display: 'grid',
    gap: tokens.spacingVerticalS,
    gridTemplateColumns: '140px 1fr',
  },
  detailLabel: {
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
  },
  sectionTitle: {
    fontWeight: 600,
    marginBottom: tokens.spacingVerticalS,
    marginTop: tokens.spacingVerticalM,
    color: tokens.colorNeutralForeground1,
  },
  resourceChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalXS,
    padding: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalS}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
    margin: `0 ${tokens.spacingHorizontalXS} ${tokens.spacingVerticalXS} 0`,
    fontSize: tokens.fontSizeBase200,
  },
  emptyHint: {
    color: tokens.colorNeutralForeground3,
    fontStyle: 'italic',
    fontSize: tokens.fontSizeBase200,
  },
  nativeSelect: {
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: tokens.fontSizeBase300,
    width: '100%',
  },
});

type TabValue =
  | 'cost-centers'
  | 'projects'
  | 'resources'
  | 'placeholders'
  | 'holidays'
  | 'settings'
  | 'manager-overrides'
  | 'delegates'
  | 'users';

export function Admin() {
  const styles = useStyles();
  const { showSuccess, showApiError } = useToast();
  const { user } = useAuth();
  const [selectedTab, setSelectedTab] = useState<TabValue>('cost-centers');
  const [loading, setLoading] = useState(true);

  const canManageMasterData = user?.role === 'Admin' || user?.role === 'Finance';
  const canManageSettings = user?.role === 'Admin';
  const canManageDelegates = user?.role === 'Admin' || user?.role === 'Finance' || user?.role === 'Manager';

  // Data
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [managerOverrides, setManagerOverrides] = useState<ManagerOverride[]>([]);
  const [delegates, setDelegates] = useState<ApprovalDelegate[]>([]);
  const [pmUsers, setPmUsers] = useState<AdminUser[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUserDetail[]>([]);

  // Filter state
  const [searchText, setSearchText] = useState('');
  const [filterCostCenter, setFilterCostCenter] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editItem, setEditItem] = useState<unknown>(null);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  // Detail dialog state (cost center resources, resource/placeholder details)
  const [detailItem, setDetailItem] = useState<CostCenter | Resource | Placeholder | null>(null);
  const [detailType, setDetailType] = useState<'cost-center' | 'resource' | 'placeholder' | null>(null);
  const [detailResources, setDetailResources] = useState<Resource[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      switch (selectedTab) {
        case 'cost-centers':
          setCostCenters(await adminApi.listCostCenters());
          break;
        case 'projects': {
          const [projs, pms] = await Promise.all([
            adminApi.listProjects(),
            canManageMasterData ? adminApi.listUsers('PM') : Promise.resolve([]),
          ]);
          setProjects(projs);
          setPmUsers(pms);
          break;
        }
        case 'resources': {
          const [resData, ccData] = await Promise.all([
            adminApi.listResources(),
            adminApi.listCostCenters(),
          ]);
          setResources(resData);
          setCostCenters(ccData);
          break;
        }
        case 'placeholders': {
          const [phData, ccData2] = await Promise.all([
            adminApi.listPlaceholders(),
            adminApi.listCostCenters(),
          ]);
          setPlaceholders(phData);
          setCostCenters(ccData2);
          break;
        }
        case 'holidays':
          setHolidays(await adminApi.listHolidays());
          break;
        case 'settings':
          if (canManageSettings) setSettings(await adminApi.listSettings());
          break;
        case 'manager-overrides':
          if (canManageSettings) setManagerOverrides(await adminApi.listManagerOverrides());
          break;
        case 'delegates':
          if (canManageDelegates) {
            const [dels, mgrs] = await Promise.all([adminApi.listDelegates(), adminApi.listUsers()]);
            setDelegates(dels);
            setPmUsers(mgrs);
          }
          break;
        case 'users':
          if (canManageSettings) setAdminUsers(await adminApi.listAdminUsers());
          break;
      }
    } catch (error) {
      showApiError(error as Error, 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [selectedTab, canManageMasterData, canManageSettings]);

  useEffect(() => {
    loadData();
    setSearchText('');
    setFilterCostCenter('');
    setFilterStatus('');
  }, [selectedTab]);

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

  const openCostCenterDetail = async (cc: CostCenter) => {
    setDetailItem(cc);
    setDetailType('cost-center');
    setDetailResources([]);
    setDetailLoading(true);
    try {
      const res = await adminApi.listResources();
      setDetailResources(res.filter((r) => r.cost_center_id === cc.id));
    } catch {
      setDetailResources([]);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      switch (selectedTab) {
        case 'cost-centers':
          if (editItem) {
            await adminApi.updateCostCenter((editItem as CostCenter).id, formData as Partial<CostCenter>);
          } else {
            await adminApi.createCostCenter(formData as { code: string; name: string; ro_user_id?: string; director_user_id?: string });
          }
          break;
        case 'projects':
          if (editItem) {
            await adminApi.updateProject((editItem as Project).id, formData as Partial<Project>);
          } else {
            await adminApi.createProject(formData as { code: string; name: string; pm_user_ids?: string[] });
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
              initials?: string;
              resource_type?: string;
            });
          }
          break;
        case 'placeholders':
          if (editItem) {
            await adminApi.updatePlaceholder((editItem as Placeholder).id, formData as Partial<Placeholder>);
          } else {
            const cost_center_id = formData.cost_center_id as string;
            if (!cost_center_id?.trim()) {
              showApiError(new Error('Cost center is required'), 'Validation');
              return;
            }
            await adminApi.createPlaceholder({
              cost_center_id: cost_center_id.trim(),
              name: (formData.name as string) || undefined,
              description: (formData.description as string) || undefined,
              skill_profile: (formData.skill_profile as string) || undefined,
            });
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
        case 'manager-overrides':
          if (!canManageSettings) {
            showApiError(new Error('Only Admin can manage overrides'), 'Permission denied');
            return;
          }
          if (editItem) {
            await adminApi.patchManagerOverride(
              (editItem as ManagerOverride).id,
              { is_active: formData.is_active as boolean, note: formData.note as string | undefined },
            );
          } else {
            await adminApi.createManagerOverride(formData as { employee_object_id: string; manager_object_id: string; note?: string });
          }
          break;
        case 'delegates':
          if (editItem) {
            await adminApi.patchDelegate(
              (editItem as ApprovalDelegate).id,
              { is_active: formData.is_active as boolean, note: formData.note as string | undefined },
            );
          } else {
            let delegatorId = formData.delegator_id as string;
            if (user?.role === 'Manager') {
              // Manager always delegates their own approvals — find own db User.id by email
              const me = pmUsers.find((u) => u.email?.toLowerCase() === user.email?.toLowerCase());
              delegatorId = me?.id ?? '';
            }
            if (!delegatorId || !(formData.delegate_id as string)) {
              showApiError(new Error('Delegator and delegate are required'), 'Validation');
              return;
            }
            await adminApi.createDelegate({
              delegator_id: delegatorId,
              delegate_id: formData.delegate_id as string,
              note: formData.note as string | undefined,
            });
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
        case 'manager-overrides':
          await adminApi.deleteManagerOverride((item as ManagerOverride).id);
          break;
        case 'delegates':
          await adminApi.deleteDelegate((item as ApprovalDelegate).id);
          break;
      }
      showSuccess('Deleted', 'Item deleted successfully');
      loadData();
    } catch (error) {
      showApiError(error as Error, 'Failed to delete');
    }
  };

  // ── Filter helpers ────────────────────────────────────────────────────────

  const filterCostCenterOptions = costCenters.map((cc) => ({ value: cc.id, label: cc.name }));

  const filteredCostCenters = costCenters.filter((cc) => {
    const q = searchText.toLowerCase();
    return !q || cc.code.toLowerCase().includes(q) || cc.name.toLowerCase().includes(q);
  });

  const filteredProjects = projects.filter((p) => {
    const q = searchText.toLowerCase();
    const matchSearch = !q || p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
    const matchStatus =
      !filterStatus ||
      (filterStatus === 'active' && p.is_active) ||
      (filterStatus === 'on_hold' && !p.is_active);
    return matchSearch && matchStatus;
  });

  const filteredResources = resources.filter((r) => {
    const q = searchText.toLowerCase();
    const matchSearch =
      !q ||
      r.display_name.toLowerCase().includes(q) ||
      r.employee_id.toLowerCase().includes(q) ||
      (r.email ?? '').toLowerCase().includes(q);
    const matchCC = !filterCostCenter || r.cost_center_id === filterCostCenter;
    return matchSearch && matchCC;
  });

  const filteredPlaceholders = placeholders.filter((ph) => {
    const q = searchText.toLowerCase();
    const matchSearch =
      !q ||
      ph.name.toLowerCase().includes(q) ||
      (ph.skill_profile ?? '').toLowerCase().includes(q) ||
      (ph.cost_center_name ?? '').toLowerCase().includes(q);
    const matchCC = !filterCostCenter || ph.cost_center_id === filterCostCenter;
    return matchSearch && matchCC;
  });

  const filteredAdminUsers = adminUsers.filter((u) => {
    const q = searchText.toLowerCase();
    const matchSearch = !q || u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    const matchRole = !filterStatus || u.role === filterStatus;
    return matchSearch && matchRole;
  });

  const clearFilters = () => {
    setSearchText('');
    setFilterCostCenter('');
    setFilterStatus('');
  };

  const pmNamesForProject = (ids: string[]) =>
    ids.length === 0
      ? '—'
      : ids.map((id) => pmUsers.find((u) => u.id === id)?.display_name ?? id).join(', ');

  // ── Table renderers ──────────────────────────────────────────────────────

  const renderTable = () => {
    if (loading) return <Spinner label="Loading..." />;

    switch (selectedTab) {
      case 'cost-centers':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by code or name…"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCostCenters.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <Text className={styles.emptyHint}>No cost centers match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredCostCenters.map((cc) => (
                  <TableRow
                    key={cc.id}
                    className={styles.clickableRow}
                    onClick={() => openCostCenterDetail(cc)}
                  >
                    <TableCell>{cc.code}</TableCell>
                    <TableCell>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {cc.name}
                        <ChevronRightRegular style={{ color: tokens.colorNeutralForeground3, fontSize: 14 }} />
                      </span>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
          </>
        );

      case 'projects':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by code or name…"
              filterValue={filterStatus}
              onFilterChange={setFilterStatus}
              filterOptions={[
                { value: 'active', label: 'Active' },
                { value: 'on_hold', label: 'On Hold' },
              ]}
              filterPlaceholder="All statuses"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Code</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Project Manager</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text className={styles.emptyHint}>No projects match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredProjects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>{project.code}</TableCell>
                    <TableCell>{project.name}</TableCell>
                    <TableCell>{pmNamesForProject(project.pm_user_ids)}</TableCell>
                    <TableCell>
                      {canManageMasterData ? (
                        <div className={styles.statusToggle}>
                          <StatusPill status={projectStatus(project.is_active)} />
                          <Select
                            size="small"
                            value={project.is_active ? 'active' : 'on_hold'}
                            onChange={async (_, d) => {
                              const newStatus = d.value === 'active';
                              try {
                                await adminApi.updateProject(project.id, { is_active: newStatus });
                                setProjects((prev) =>
                                  prev.map((p) => (p.id === project.id ? { ...p, is_active: newStatus } : p))
                                );
                                showSuccess('Status updated');
                              } catch (err) {
                                showApiError(err);
                              }
                            }}
                            style={{ minWidth: 100 }}
                          >
                            <option value="active">Active</option>
                            <option value="on_hold">On Hold</option>
                          </Select>
                        </div>
                      ) : (
                        <StatusPill status={projectStatus(project.is_active)} />
                      )}
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
          </>
        );

      case 'resources':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by name or employee ID…"
              filterValue={filterCostCenter}
              onFilterChange={setFilterCostCenter}
              filterOptions={filterCostCenterOptions}
              filterPlaceholder="All cost centers"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Employee ID</TableHeaderCell>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Initials</TableHeaderCell>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResources.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Text className={styles.emptyHint}>No resources match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredResources.map((resource) => (
                  <TableRow
                    key={resource.id}
                    className={styles.clickableRow}
                    onClick={() => { setDetailItem(resource); setDetailType('resource'); }}
                  >
                    <TableCell>{resource.employee_id}</TableCell>
                    <TableCell>{resource.display_name}</TableCell>
                    <TableCell>{resource.initials ?? '—'}</TableCell>
                    <TableCell>{costCenters.find((cc) => cc.id === resource.cost_center_id)?.name || '—'}</TableCell>
                    <TableCell>
                      <Badge color={resource.resource_type === 'Employee' ? 'brand' : 'warning'}>
                        {resource.resource_type}
                      </Badge>
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
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
          </>
        );

      case 'placeholders':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by name or skill profile…"
              filterValue={filterCostCenter}
              onFilterChange={setFilterCostCenter}
              filterOptions={filterCostCenterOptions}
              filterPlaceholder="All cost centers"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Placeholder Name</TableHeaderCell>
                  <TableHeaderCell>Skill Profile</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPlaceholders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text className={styles.emptyHint}>No placeholders match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredPlaceholders.map((ph) => (
                  <TableRow
                    key={ph.id}
                    className={styles.clickableRow}
                    onClick={() => { setDetailItem(ph); setDetailType('placeholder'); }}
                  >
                    <TableCell>{ph.cost_center_name || '—'}</TableCell>
                    <TableCell>{ph.name}</TableCell>
                    <TableCell>{ph.skill_profile || '—'}</TableCell>
                    <TableCell>
                      <StatusPill status={resourceStatus(ph.is_active)} />
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {canManageMasterData && (
                        <>
                          <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(ph)} />
                          <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(ph)} title="Deactivate" />
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
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
                  <TableCell>{setting.description || '—'}</TableCell>
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

      case 'manager-overrides':
        return (
          <>
            <div style={{ marginBottom: tokens.spacingVerticalM, display: 'flex', gap: tokens.spacingHorizontalS }}>
              <Button
                appearance="secondary"
                onClick={async () => {
                  try {
                    const result = await adminApi.syncReportingCache();
                    showSuccess('Cache rebuilt', result.message);
                  } catch (error) {
                    showApiError(error as Error, 'Failed to rebuild cache');
                  }
                }}
              >
                Rebuild Reporting Cache
              </Button>
              <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: 'auto 0' }}>
                Rebuilds the manager hierarchy from current Graph data. Run after any org chart changes.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Employee (object ID)</TableHeaderCell>
                  <TableHeaderCell>Manager (object ID)</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                  <TableHeaderCell>Note</TableHeaderCell>
                  <TableHeaderCell>Actions</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {managerOverrides.map((override) => (
                  <TableRow key={override.id}>
                    <TableCell>{override.employee_object_id}</TableCell>
                    <TableCell>{override.manager_object_id}</TableCell>
                    <TableCell>
                      <Badge appearance="filled" color={override.is_active ? 'success' : 'danger'}>
                        {override.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>{override.note || '—'}</TableCell>
                    <TableCell>
                      <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(override)} />
                      <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(override)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );

      case 'delegates':
        return (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Delegator (approvals owner)</TableHeaderCell>
                <TableHeaderCell>Delegate (acts on their behalf)</TableHeaderCell>
                <TableHeaderCell>Active</TableHeaderCell>
                <TableHeaderCell>Note</TableHeaderCell>
                <TableHeaderCell>Actions</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {delegates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Text className={styles.emptyHint}>No approval delegates configured.</Text>
                  </TableCell>
                </TableRow>
              )}
              {delegates.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>{d.delegator_name || d.delegator_id}</TableCell>
                  <TableCell>{d.delegate_name || d.delegate_id}</TableCell>
                  <TableCell>
                    <Badge appearance="filled" color={d.is_active ? 'success' : 'danger'}>
                      {d.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{d.note || '—'}</TableCell>
                  <TableCell>
                    <Button icon={<EditRegular />} appearance="subtle" onClick={() => openEditDialog(d)} />
                    <Button icon={<DeleteRegular />} appearance="subtle" onClick={() => handleDelete(d)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case 'users':
        return (
          <>
            <AdminToolbar
              searchValue={searchText}
              onSearchChange={setSearchText}
              searchPlaceholder="Search by name or email…"
              filterValue={filterStatus}
              onFilterChange={setFilterStatus}
              filterOptions={[
                { value: 'Admin', label: 'Admin' },
                { value: 'Finance', label: 'Finance' },
                { value: 'PM', label: 'PM' },
                { value: 'Manager', label: 'Manager' },
                { value: 'Employee', label: 'Employee' },
              ]}
              filterPlaceholder="All roles"
              onClear={clearFilters}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Email</TableHeaderCell>
                  <TableHeaderCell>Role</TableHeaderCell>
                  <TableHeaderCell>Cost Center</TableHeaderCell>
                  <TableHeaderCell>Active</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAdminUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text className={styles.emptyHint}>No users match the current filter.</Text>
                    </TableCell>
                  </TableRow>
                )}
                {filteredAdminUsers.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell>{u.display_name}</TableCell>
                    <TableCell>{u.email}</TableCell>
                    <TableCell>
                      <select
                        className={styles.nativeSelect}
                        value={u.role}
                        disabled={u.object_id === user?.object_id}
                        onChange={async (e) => {
                          const newRole = e.target.value as UserRole;
                          if (newRole === 'Admin' && !confirm('Assign Admin role? This gives full system access.')) return;
                          try {
                            const updated = await adminApi.updateAdminUser(u.id, { role: newRole });
                            setAdminUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
                            showSuccess('Role updated');
                          } catch (err) {
                            showApiError(err as Error, 'Failed to update role');
                          }
                        }}
                      >
                        {(['Admin', 'Finance', 'PM', 'Manager', 'Employee'] as UserRole[]).map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>{u.cost_center_name || '—'}</TableCell>
                    <TableCell>
                      <select
                        className={styles.nativeSelect}
                        value={u.is_active ? 'active' : 'inactive'}
                        disabled={u.object_id === user?.object_id}
                        onChange={async (e) => {
                          try {
                            const updated = await adminApi.updateAdminUser(u.id, { is_active: e.target.value === 'active' });
                            setAdminUsers((prev) => prev.map((x) => (x.id === u.id ? updated : x)));
                            showSuccess('Status updated');
                          } catch (err) {
                            showApiError(err as Error, 'Failed to update status');
                          }
                        }}
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        );
    }
  };

  // ── Dialog form renderers ────────────────────────────────────────────────

  const renderDialogForm = () => {
    switch (selectedTab) {
      case 'cost-centers':
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
            <div className={styles.dialogField}>
              <Label>Project Managers (hold Ctrl/Cmd to select multiple)</Label>
              <select
                className={styles.nativeSelect}
                multiple
                value={(formData.pm_user_ids as string[]) ?? []}
                onChange={(e) => {
                  const selected = Array.from(e.target.selectedOptions, (o) => o.value);
                  setFormData({ ...formData, pm_user_ids: selected });
                }}
              >
                {pmUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.display_name} ({u.email})
                  </option>
                ))}
              </select>
            </div>
          </>
        );

      case 'resources':
        return (
          <>
            <div className={styles.dialogField}>
              <Label required>Cost Center</Label>
              <select
                className={styles.nativeSelect}
                value={String(formData.cost_center_id || '')}
                onChange={(e) => setFormData({ ...formData, cost_center_id: e.target.value })}
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
              <Label>Initials</Label>
              <Input
                value={String(formData.initials ?? '')}
                onChange={(_, d) => setFormData({ ...formData, initials: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Email</Label>
              <Input
                value={String(formData.email || '')}
                onChange={(_, d) => setFormData({ ...formData, email: d.value })}
              />
            </div>
            <div className={styles.dialogField}>
              <Label>Resource Type</Label>
              <select
                className={styles.nativeSelect}
                value={String(formData.resource_type || 'Employee')}
                onChange={(e) => setFormData({ ...formData, resource_type: e.target.value })}
              >
                <option value="Employee">Employee</option>
                <option value="External">External</option>
                <option value="Student">Student</option>
                <option value="OOP">OOP</option>
              </select>
            </div>
          </>
        );

      case 'placeholders':
        return (
          <>
            {editItem ? (
              <div className={styles.dialogField}>
                <Label>Cost Center</Label>
                <Input value={String((editItem as Placeholder).cost_center_name || '—')} readOnly disabled />
              </div>
            ) : (
              <div className={styles.dialogField}>
                <Label required>Cost Center</Label>
                <select
                  className={styles.nativeSelect}
                  value={String(formData.cost_center_id || '')}
                  onChange={(e) => setFormData({ ...formData, cost_center_id: e.target.value })}
                >
                  <option value="">Select Cost Center</option>
                  {costCenters.map((cc) => (
                    <option key={cc.id} value={cc.id}>{cc.name}</option>
                  ))}
                </select>
              </div>
            )}
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

      case 'manager-overrides':
        return (
          <>
            {!editItem ? (
              <>
                <div className={styles.dialogField}>
                  <Label required>Employee Entra Object ID</Label>
                  <Input
                    value={String(formData.employee_object_id || '')}
                    onChange={(_, d) => setFormData({ ...formData, employee_object_id: d.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
                <div className={styles.dialogField}>
                  <Label required>Manager Entra Object ID</Label>
                  <Input
                    value={String(formData.manager_object_id || '')}
                    onChange={(_, d) => setFormData({ ...formData, manager_object_id: d.value })}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  />
                </div>
              </>
            ) : (
              <Checkbox
                label="Active"
                checked={formData.is_active !== false}
                onChange={(_, d) => setFormData({ ...formData, is_active: d.checked })}
              />
            )}
            <div className={styles.dialogField}>
              <Label>Note</Label>
              <Input
                value={String(formData.note || '')}
                onChange={(_, d) => setFormData({ ...formData, note: d.value })}
              />
            </div>
          </>
        );

      case 'delegates':
        return (
          <>
            {!editItem ? (
              <>
                {user?.role !== 'Manager' && (
                  <div className={styles.dialogField}>
                    <Label required>Delegator (whose approvals to delegate)</Label>
                    <Select
                      value={String(formData.delegator_id || '')}
                      onChange={(_, d) => setFormData({ ...formData, delegator_id: d.value })}
                    >
                      <option value="">— select manager —</option>
                      {pmUsers.filter((u) => u.role === 'Manager' || u.role === 'Admin').map((u) => (
                        <option key={u.id} value={u.id}>{u.display_name}</option>
                      ))}
                    </Select>
                  </div>
                )}
                {user?.role === 'Manager' && (
                  <div className={styles.dialogField}>
                    <Label>Delegator</Label>
                    <Input value={user.display_name} readOnly />
                  </div>
                )}
                <div className={styles.dialogField}>
                  <Label required>Delegate (who will approve on their behalf)</Label>
                  <Select
                    value={String(formData.delegate_id || '')}
                    onChange={(_, d) => setFormData({ ...formData, delegate_id: d.value })}
                  >
                    <option value="">— select delegate —</option>
                    {pmUsers.map((u) => (
                      <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>
                    ))}
                  </Select>
                </div>
              </>
            ) : (
              <Checkbox
                label="Active"
                checked={formData.is_active !== false}
                onChange={(_, d) => setFormData({ ...formData, is_active: d.checked })}
              />
            )}
            <div className={styles.dialogField}>
              <Label>Note</Label>
              <Input
                value={String(formData.note || '')}
                onChange={(_, d) => setFormData({ ...formData, note: d.value })}
              />
            </div>
          </>
        );
    }
  };

  // ── Detail dialog content ────────────────────────────────────────────────

  const renderDetailContent = () => {
    if (!detailItem || !detailType) return null;

    if (detailType === 'cost-center') {
      const cc = detailItem as CostCenter;
      return (
        <>
          <div className={styles.detailGrid}>
            <span className={styles.detailLabel}>Code</span><span>{cc.code}</span>
            <span className={styles.detailLabel}>Name</span><span>{cc.name}</span>
            <span className={styles.detailLabel}>Status</span>
            <span><StatusPill status={resourceStatus(cc.is_active)} /></span>
          </div>
          <div className={styles.sectionTitle}>Resources in this cost center</div>
          {detailLoading ? (
            <Spinner size="tiny" label="Loading resources…" />
          ) : detailResources.length === 0 ? (
            <Text className={styles.emptyHint}>No active resources assigned to this cost center.</Text>
          ) : (
            <div>
              {detailResources.map((r) => (
                <span key={r.id} className={styles.resourceChip}>
                  <Badge color={r.resource_type === 'Employee' ? 'brand' : 'warning'} size="small">
                    {r.resource_type[0]}
                  </Badge>
                  {r.display_name}
                  {r.initials ? ` (${r.initials})` : ''}
                </span>
              ))}
            </div>
          )}
        </>
      );
    }

    if (detailType === 'resource') {
      const r = detailItem as Resource;
      return (
        <div className={styles.detailGrid}>
          <span className={styles.detailLabel}>Employee ID</span><span>{r.employee_id}</span>
          <span className={styles.detailLabel}>Display Name</span><span>{r.display_name}</span>
          <span className={styles.detailLabel}>Initials</span><span>{r.initials ?? '—'}</span>
          <span className={styles.detailLabel}>Email</span><span>{r.email ?? '—'}</span>
          <span className={styles.detailLabel}>Cost Center</span>
          <span>{costCenters.find((cc) => cc.id === r.cost_center_id)?.name ?? '—'}</span>
          <span className={styles.detailLabel}>Type</span>
          <span><Badge color={r.resource_type === 'Employee' ? 'brand' : 'warning'}>{r.resource_type}</Badge></span>
          <span className={styles.detailLabel}>Hourly Cost</span><span>{r.hourly_cost != null ? r.hourly_cost : '—'}</span>
          <span className={styles.detailLabel}>Status</span>
          <span><StatusPill status={resourceStatus(r.is_active)} /></span>
        </div>
      );
    }

    if (detailType === 'placeholder') {
      const ph = detailItem as Placeholder;
      return (
        <div className={styles.detailGrid}>
          <span className={styles.detailLabel}>Name</span><span>{ph.name}</span>
          <span className={styles.detailLabel}>Cost Center</span><span>{ph.cost_center_name ?? '—'}</span>
          <span className={styles.detailLabel}>Description</span><span>{ph.description ?? '—'}</span>
          <span className={styles.detailLabel}>Skill Profile</span><span>{ph.skill_profile ?? '—'}</span>
          <span className={styles.detailLabel}>Estimated Cost</span><span>{ph.estimated_cost != null ? ph.estimated_cost : '—'}</span>
          <span className={styles.detailLabel}>Status</span>
          <span><StatusPill status={resourceStatus(ph.is_active)} /></span>
        </div>
      );
    }

    return null;
  };

  // ── Tab labels ───────────────────────────────────────────────────────────

  const tabLabels: Record<TabValue, string> = {
    'cost-centers': 'Cost Centers',
    'projects': 'Projects',
    'resources': 'Resources',
    'placeholders': 'Placeholders',
    'holidays': 'Holidays',
    'settings': 'Settings',
    'manager-overrides': 'Manager Overrides',
    'delegates': 'Approval Delegates',
    'users': 'Users',
  };

  const detailDialogTitle =
    detailType === 'cost-center'
      ? `Cost Center: ${(detailItem as CostCenter)?.name ?? ''}`
      : detailType === 'resource'
      ? 'Resource Details'
      : 'Placeholder Details';

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      <Card className={styles.card}>
        <TabList selectedValue={selectedTab} onTabSelect={handleTabSelect}>
          <Tab value="cost-centers" icon={<OrganizationRegular />}>Cost Centers</Tab>
          <Tab value="projects" icon={<FolderRegular />}>Projects</Tab>
          <Tab value="resources" icon={<PersonRegular />}>Resources</Tab>
          <Tab value="placeholders" icon={<PersonQuestionMarkRegular />}>Placeholders</Tab>
          <Tab value="holidays" icon={<CalendarRegular />}>Holidays</Tab>
          {canManageSettings && (
            <Tab value="settings" icon={<SettingsRegular />}>Settings</Tab>
          )}
          {canManageSettings && (
            <Tab value="manager-overrides" icon={<PeopleTeamRegular />}>Manager Overrides</Tab>
          )}
          {canManageDelegates && (
            <Tab value="delegates" icon={<PeopleTeamRegular />}>Approval Delegates</Tab>
          )}
          {canManageSettings && (
            <Tab value="users" icon={<PeopleTeamRegular />}>Users</Tab>
          )}
        </TabList>

        <div className={styles.tabContent}>
          <div className={styles.header}>
            <div>
              <Title3>{tabLabels[selectedTab]}</Title3>
              {selectedTab === 'cost-centers' && (
                <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: '4px 0 0 0' }}>
                  A placeholder is created automatically for each cost center. Click a row to see assigned resources.
                </p>
              )}
              {selectedTab === 'placeholders' && (
                <p style={{ fontSize: '12px', color: tokens.colorNeutralForeground3, margin: '4px 0 0 0' }}>
                  One placeholder per cost center. Edit name and details here; create cost centers to add placeholders.
                </p>
              )}
            </div>
            {selectedTab !== 'users' && (canManageMasterData ||
              ((selectedTab === 'settings' || selectedTab === 'manager-overrides') && canManageSettings) ||
              (selectedTab === 'delegates' && canManageDelegates)) && (
              <Button appearance="primary" icon={<AddRegular />} onClick={openCreateDialog}>
                Add {tabLabels[selectedTab].replace(/s$/, '')}
              </Button>
            )}
          </div>

          {renderTable()}
        </div>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(_, data) => setDialogOpen(data.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>
              {editItem ? 'Edit' : 'Create'} {tabLabels[selectedTab].replace(/s$/, '')}
            </DialogTitle>
            <DialogContent>{renderDialogForm()}</DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={handleSave}>Save</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      {/* Detail Dialog (cost center resources / resource / placeholder) */}
      <Dialog
        open={detailItem != null}
        onOpenChange={(_, data) => {
          if (!data.open) {
            setDetailItem(null);
            setDetailType(null);
          }
        }}
      >
        <DialogSurface style={{ minWidth: 480 }}>
          <DialogBody>
            <DialogTitle>{detailDialogTitle}</DialogTitle>
            <DialogContent>{renderDetailContent()}</DialogContent>
            <DialogActions>
              <Button appearance="primary" onClick={() => { setDetailItem(null); setDetailType(null); }}>
                Close
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
