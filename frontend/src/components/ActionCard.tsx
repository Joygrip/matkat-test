/**
 * Action card / KPI card component
 * Supports an optional left-side accent color bar.
 */
import { ReactNode } from 'react';
import { Card, makeStyles, tokens, Body1, Body2 } from '@fluentui/react-components';

const useStyles = makeStyles({
  card: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalM}`,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow2,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    transition: 'transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
    cursor: 'pointer',
    position: 'relative' as const,
    overflow: 'hidden',
    '&:hover': {
      transform: 'translateY(-1px)',
      boxShadow: tokens.shadow8,
    },
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '4px',
    borderRadius: '4px 0 0 4px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalS,
    marginBottom: tokens.spacingVerticalS,
  },
  icon: {
    width: '36px',
    height: '36px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    flexShrink: 0,
  },
  title: {
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.3',
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    paddingLeft: '4px',
  },
  value: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    color: tokens.colorNeutralForeground1,
    lineHeight: '1.1',
  },
  subtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    lineHeight: '1.4',
  },
});

interface ActionCardProps {
  icon: ReactNode;
  title: string;
  value?: string | number;
  subtitle?: string;
  /** Optional left-side accent bar color */
  accentColor?: string;
  onClick?: () => void;
}

export function ActionCard({ icon, title, value, subtitle, accentColor, onClick }: ActionCardProps) {
  const styles = useStyles();

  return (
    <Card className={styles.card} onClick={onClick}>
      {accentColor && (
        <div className={styles.accentBar} style={{ backgroundColor: accentColor }} />
      )}
      <div className={styles.header}>
        <div className={styles.icon}>{icon}</div>
        <Body1 className={styles.title}>{title}</Body1>
      </div>
      {(value !== undefined || subtitle) && (
        <div className={styles.content}>
          {value !== undefined && <div className={styles.value}>{value}</div>}
          {subtitle && <Body2 className={styles.subtitle}>{subtitle}</Body2>}
        </div>
      )}
    </Card>
  );
}
