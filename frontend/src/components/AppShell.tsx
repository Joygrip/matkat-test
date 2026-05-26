/**
 * Enterprise AppShell with MatKat branding
 */
import { ReactNode, useState } from 'react';
import { usePeriod } from '../contexts/PeriodContext';
import { MONTH_NAMES } from '../utils/format';
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
} from '@fluentui/react-components';
import {
  HomeRegular,
  HomeFilled,
  ClipboardTaskRegular,
  ClipboardTaskFilled,
  ChartMultipleRegular,
  ChartMultipleFilled,
  SettingsRegular,
  SettingsFilled,
  DocumentBulletListRegular,
  DocumentBulletListFilled,
  SignOutRegular,
  PeopleTeamRegular,
  PeopleTeamFilled,
  bundleIcon,
} from '@fluentui/react-icons';
import { useAuth } from '../auth/AuthProvider';

const Home = bundleIcon(HomeFilled, HomeRegular);

const Actuals = bundleIcon(ClipboardTaskFilled, ClipboardTaskRegular);
const Consolidation = bundleIcon(ChartMultipleFilled, ChartMultipleRegular);
const Admin = bundleIcon(SettingsFilled, SettingsRegular);
const AuditLogsIcon = bundleIcon(DocumentBulletListFilled, DocumentBulletListRegular);
const ResourcePlanningIcon = bundleIcon(PeopleTeamFilled, PeopleTeamRegular);

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
    padding: '16px 12px 12px 12px',
    borderBottom: `1px solid rgba(255, 255, 255, 0.1)`,
    display: 'flex',
    alignItems: 'center',
  },
  logoSlot: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    flex: 1,
    minWidth: 0,
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
  navSectionLabel: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightSemibold,
    textTransform: 'uppercase',
    letterSpacing: '1px',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL} ${tokens.spacingVerticalXS}`,
    marginTop: tokens.spacingVerticalS,
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
    width: '140px',
    height: 'auto',
    opacity: 0.85,
    display: 'block',
    backgroundColor: 'transparent',
    filter: 'drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3))',
  },
  logoContainer: {
    display: 'flex',
    justifyContent: 'center',
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderTop: '1px solid rgba(255, 255, 255, 0.1)',
  },
  periodDisplay: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground1,
    userSelect: 'none',
  },
  periodLabel: {
    fontWeight: tokens.fontWeightSemibold,
  },
  statusOpen: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForegroundOnBrand,
    fontWeight: tokens.fontWeightSemibold,
    background: tokens.colorPaletteGreenBackground3,
    borderRadius: tokens.borderRadiusCircular,
    padding: '2px 8px',
  },
  statusLocked: {
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground3,
    fontWeight: tokens.fontWeightRegular,
    background: tokens.colorNeutralBackground4,
    borderRadius: tokens.borderRadiusCircular,
    padding: '2px 8px',
  },
});

interface NavItem {
  path: string;
  label: string;
  icon: typeof Home;
  roles?: string[];
  section: 'overview' | 'planning' | 'operations' | 'admin';
}

const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: Home, section: 'overview' },
  { path: '/resource-planning', label: 'Resource Planning', icon: ResourcePlanningIcon, roles: ['Admin', 'Finance', 'PM', 'Manager'], section: 'planning' },
  { path: '/actuals', label: 'FTE Approval', icon: Actuals, roles: ['Admin', 'Finance', 'Manager'], section: 'operations' },
  { path: '/finance', label: 'Finance', icon: Consolidation, roles: ['Admin', 'Finance', 'Manager', 'PM'], section: 'operations' },
  { path: '/admin?tab=delegates', label: 'My Delegates', icon: PeopleTeamRegular, roles: ['Manager'], section: 'operations' },
  { path: '/admin', label: 'Admin', icon: Admin, roles: ['Admin', 'Finance'], section: 'admin' },
  { path: '/audit-logs', label: 'Audit logs', icon: AuditLogsIcon, roles: ['Admin', 'Finance'], section: 'admin' },
];

const sectionLabels: Record<string, string> = {
  overview: '',
  planning: 'Planning',
  operations: 'Operations',
  admin: 'Management',
};

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/resource-planning': 'Resource Planning',
  '/demand': 'Demand Planning',
  '/supply': 'Supply Planning',
  '/actuals': 'FTE Approval',
  '/finance': 'Finance',
  '/project-costs': 'OoP + Equipment',
  '/admin': 'Administration',
  '/audit-logs': 'Audit logs',
};

export function AppShell({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const location = useLocation();
  const { user, logout } = useAuth();

  const { selectedPeriod } = usePeriod();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const visibleNavItems = navItems.filter((item) => {
    if (!item.roles) return true;
    if (!user) return false;
    if (item.roles.includes(user.role)) return true;
    // Manager+Reader also gets Finance access
    if (user.secondary_role === 'Reader' && item.path.startsWith('/finance')) return true;
    return false;
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
            <img
                src="/MatKatLog.png"
                alt="MatKat"
                style={{
                  height: '72px',
                  width: 'auto',
                  maxWidth: '210px',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
          </div>
        </div>

        <nav className={styles.nav}>
          {(() => {
            let lastSection = '';
            return visibleNavItems.map((item) => {
              const showLabel = item.section !== lastSection && sectionLabels[item.section];
              lastSection = item.section;
              return (
                <div key={item.path}>
                  {showLabel && (
                    <div className={styles.navSectionLabel}>{sectionLabels[item.section]}</div>
                  )}
                  <NavLink
                    to={item.path}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`
                    }
                  >
                    <item.icon style={{ fontSize: 20 }} />
                    {item.label}
                  </NavLink>
                </div>
              );
            });
          })()}
        </nav>

        <div className={styles.logoContainer}>
          <img
            src="/logo.svg"
            alt="Ferrosan Medical Devices Logo"
            className={styles.logoImage}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              console.error('Logo failed to load. Attempted path:', target.src);
            }}
          />
        </div>

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
            {selectedPeriod && (
              <div className={styles.periodDisplay}>
                <span className={styles.periodLabel}>
                  {MONTH_NAMES[selectedPeriod.month - 1]} {selectedPeriod.year}
                </span>
                <span className={selectedPeriod.status === 'open' ? styles.statusOpen : styles.statusLocked}>
                  {selectedPeriod.status}
                </span>
              </div>
            )}
          </div>
        </header>

        <div className={styles.content}>
          {children}
        </div>
      </main>
    </div>
  );
}
