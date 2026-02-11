/**
 * Enterprise AppShell with MatKat branding
 */
import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  makeStyles,
  tokens,
  Button,
  Avatar,
  Menu,
  MenuTrigger,
  MenuList,
  MenuItem,
  MenuPopover,
  Badge,
  Tooltip,
  Select,
} from '@fluentui/react-components';
import {
  HomeRegular,
  HomeFilled,
  CalendarRegular,
  CalendarFilled,
  PeopleRegular,
  PeopleFilled,
  ClipboardTaskRegular,
  ClipboardTaskFilled,
  CheckmarkCircleRegular,
  CheckmarkCircleFilled,
  ChartMultipleRegular,
  ChartMultipleFilled,
  SettingsRegular,
  SettingsFilled,
  SignOutRegular,
  PersonRegular,
  bundleIcon,
  MoneyRegular,
} from '@fluentui/react-icons';
import { useAuth } from '../auth/AuthProvider';
import { config } from '../config';
import { periodsApi, Period } from '../api/periods';

const Home = bundleIcon(HomeFilled, HomeRegular);
const Demand = bundleIcon(CalendarFilled, CalendarRegular);
const Supply = bundleIcon(PeopleFilled, PeopleRegular);
const Actuals = bundleIcon(ClipboardTaskFilled, ClipboardTaskRegular);
const Approvals = bundleIcon(CheckmarkCircleFilled, CheckmarkCircleRegular);
const Consolidation = bundleIcon(ChartMultipleFilled, ChartMultipleRegular);
const Admin = bundleIcon(SettingsFilled, SettingsRegular);

const useStyles = makeStyles({
  container: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  sidebar: {
    width: '240px',
    background: 'linear-gradient(180deg, #1a1a2e 0%, #16213e 100%)',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: tokens.shadow16,
    zIndex: 10,
  },
  logoSection: {
    padding: `${tokens.spacingVerticalL} ${tokens.spacingHorizontalL}`,
    borderBottom: `1px solid rgba(255, 255, 255, 0.1)`,
    minHeight: '72px',
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  logoSlot: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    flex: 1,
  },
  logoIcon: {
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.1) 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    color: 'white',
    fontWeight: tokens.fontWeightBold,
    border: `1px solid rgba(255, 255, 255, 0.2)`,
  },
  logoTextContainer: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  logoText: {
    color: 'white',
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightBold,
    letterSpacing: '-0.5px',
    lineHeight: 1.2,
    margin: 0,
  },
  logoSubtext: {
    color: 'rgba(255, 255, 255, 0.75)',
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightMedium,
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
    flex: 1,
    padding: tokens.spacingVerticalM,
    overflowY: 'auto',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusMedium,
    color: 'rgba(255, 255, 255, 0.7)',
    textDecoration: 'none',
    fontSize: tokens.fontSizeBase300,
    transition: 'all 0.2s ease',
    position: 'relative',
    '&:hover': {
      background: 'rgba(255, 255, 255, 0.1)',
      color: 'white',
    },
  },
  navLinkActive: {
    background: 'rgba(255, 255, 255, 0.15)',
    color: 'white',
    fontWeight: tokens.fontWeightSemibold,
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 0,
      width: '3px',
      height: '24px',
      background: tokens.colorBrandForeground1,
      borderRadius: '0 4px 4px 0',
    },
  },
  userSection: {
    borderTop: `1px solid rgba(255, 255, 255, 0.1)`,
    padding: tokens.spacingVerticalM,
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    padding: tokens.spacingHorizontalS,
  },
  userName: {
    color: 'white',
    fontSize: tokens.fontSizeBase300,
    fontWeight: tokens.fontWeightMedium,
  },
  userRole: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: tokens.fontSizeBase200,
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: tokens.colorNeutralBackground2,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalXL}`,
    background: 'white',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: tokens.shadow4,
    minHeight: '64px',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalL,
  },
  pageTitle: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    margin: 0,
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: tokens.spacingHorizontalXL,
    background: tokens.colorNeutralBackground2,
    position: 'relative',
  },
  logoImage: {
    width: '200px',
    height: 'auto',
    opacity: 1,
    transition: 'opacity 0.2s ease, transform 0.2s ease',
    filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.2))',
    display: 'block',
    backgroundColor: 'transparent',
    '&:hover': {
      opacity: 0.9,
      transform: 'scale(1.05)',
    },
  },
  logoContainer: {
    position: 'fixed',
    bottom: '20px',
    right: '24px',
    zIndex: 9999,
    pointerEvents: 'none',
    backgroundColor: 'transparent',
    '& img': {
      pointerEvents: 'auto',
    },
  },
});

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  roles?: string[];
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: Home },
  { path: '/demand', label: 'Demand', icon: Demand, roles: ['Admin', 'Finance', 'PM', 'RO'] },
  { path: '/supply', label: 'Supply', icon: Supply, roles: ['Admin', 'Finance', 'PM', 'RO'] },
  { path: '/actuals', label: 'Actuals', icon: Actuals, roles: ['Admin', 'Finance', 'RO', 'Employee'] },
  { path: '/finance-dashboard', label: 'Finance', icon: MoneyRegular, roles: ['Finance'] },
  { path: '/approvals', label: 'Approvals', icon: Approvals, roles: ['Admin', 'RO', 'Director'] },
  { path: '/consolidation', label: 'Consolidation', icon: Consolidation, roles: ['Admin', 'Finance', 'Director'] },
  { path: '/admin', label: 'Admin', icon: Admin, roles: ['Admin', 'Finance'] },
];

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/demand': 'Demand Planning',
  '/supply': 'Supply Planning',
  '/actuals': 'Actuals Entry',
  '/finance-dashboard': 'Finance Dashboard',
  '/approvals': 'Approvals',
  '/consolidation': 'Consolidation',
  '/admin': 'Administration',
};

export function AppShell({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const location = useLocation();
  const { user, logout } = useAuth();

  // Period selector state
  const [periods, setPeriods] = useState<Period[]>([]);
  const [selectedPeriod, setSelectedPeriod] = useState<string>('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    periodsApi.list().then((data) => {
      setPeriods(data);
      if (data.length > 0) {
        const openPeriod = data.find((p: Period) => p.status === 'open');
        setSelectedPeriod(openPeriod?.id || data[0].id);
      }
    });
  }, []);

  const visibleNavItems = navItems.filter((item) => {
    if (!item.roles) return true;
    return user && item.roles.includes(user.role);
  });

  const pageTitle = pageTitles[location.pathname] || 'MatKat 2.0';

  // Responsive sidebar toggle
  const handleSidebarToggle = () => setSidebarOpen((open) => !open);

  return (
    <div className={styles.container}>
      {/* Responsive sidebar: hide on small screens */}
      <aside className={styles.sidebar} style={{ display: sidebarOpen ? 'flex' : 'none' }}>
        <div className={styles.logoSection}>
          <div className={styles.logoSlot}>
            <div className={styles.logoIcon}>MK</div>
            <div className={styles.logoTextContainer}>
              <div className={styles.logoText}>MatKat</div>
              <div className={styles.logoSubtext}>2.0</div>
            </div>
            {config.devAuthBypass && (
              <Badge appearance="filled" color="warning" size="small">
                DEV
              </Badge>
            )}
          </div>
        </div>

        <nav className={styles.nav}>
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
              }
            >
              <item.icon style={{ fontSize: 20 }} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.userSection}>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button appearance="subtle" style={{ width: '100%', justifyContent: 'flex-start', background: 'transparent' }}>
                <div className={styles.userInfo}>
                  <Avatar
                    name={user?.display_name || 'User'}
                    color="colorful"
                    size={36}
                  />
                  <div style={{ textAlign: 'left', flex: 1 }}>
                    <div className={styles.userName}>{user?.display_name}</div>
                    <div className={styles.userRole}>{user?.role}</div>
                  </div>
                </div>
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuItem icon={<PersonRegular />}>Profile</MenuItem>
                <MenuItem icon={<SignOutRegular />} onClick={logout}>
                  Sign Out
                </MenuItem>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </aside>

      <main className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            {/* Hamburger for mobile */}
            <Button
              icon={<span style={{ fontSize: 24 }}>&#9776;</span>}
              appearance="subtle"
              onClick={handleSidebarToggle}
              style={{ display: 'inline-flex', marginRight: 16 }}
            />
            <h1 className={styles.pageTitle}>{pageTitle}</h1>
          </div>
          <div className={styles.headerRight}>
            <Tooltip content={`Tenant: ${user?.tenant_id}`} relationship="description">
              <Badge appearance="outline">{user?.tenant_id}</Badge>
            </Tooltip>
            <Tooltip content={`Role: ${user?.role}`} relationship="description">
              <Badge appearance="outline" color="brand">{user?.role}</Badge>
            </Tooltip>
            {/* Period selector */}
            <Select
              value={selectedPeriod}
              onChange={(_, data) => setSelectedPeriod(data.value)}
              style={{ minWidth: 120 }}
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.year}-{String(p.month).padStart(2, '0')} ({p.status})
                </option>
              ))}
            </Select>
          </div>
        </header>

        <div className={styles.content}>
          {children}
        </div>
        <div className={styles.logoContainer}>
          <img
            src="/logo.svg"
            alt="Ferrosan Medical Devices Logo"
            className={styles.logoImage}
            style={{ 
              display: 'block',
              width: '200px',
              height: 'auto'
            }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              console.error('Logo failed to load. Attempted path:', target.src);
              console.error('Error event:', e);
              // Don't hide, just log the error
            }}
            onLoad={() => {
              console.log('Logo loaded successfully from /logo.svg');
            }}
          />
        </div>
      </main>
    </div>
  );
}
