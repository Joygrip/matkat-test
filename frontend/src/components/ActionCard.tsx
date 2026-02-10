/**
 * Action card / KPI card component
 */
import { ReactNode } from 'react';
import { Card, makeStyles, tokens, Title3, Body1 } from '@fluentui/react-components';

const useStyles = makeStyles({
  card: {
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow8,
    background: 'white',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    cursor: 'pointer',
    '&:hover': {
      transform: 'translateY(-2px)',
      boxShadow: tokens.shadow16,
    },
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalM,
  },
  icon: {
    width: '44px',
    height: '44px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    background: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
  },
  content: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXS,
  },
  value: {
    fontSize: tokens.fontSizeBase600,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  subtitle: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
  },
});

interface ActionCardProps {
  icon: ReactNode;
  title: string;
  value?: string | number;
  subtitle?: string;
  onClick?: () => void;
}

export function ActionCard({ icon, title, value, subtitle, onClick }: ActionCardProps) {
  const styles = useStyles();

  return (
    <Card className={styles.card} onClick={onClick}>
      <div className={styles.header}>
        <div className={styles.icon}>{icon}</div>
        <Title3>{title}</Title3>
      </div>
      {(value !== undefined || subtitle) && (
        <div className={styles.content}>
          {value !== undefined && <div className={styles.value}>{value}</div>}
          {subtitle && <Body1 className={styles.subtitle}>{subtitle}</Body1>}
        </div>
      )}
    </Card>
  );
}
