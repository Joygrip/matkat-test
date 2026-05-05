import { makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    boxShadow: tokens.shadow2,
    cursor: 'default',
    transition: 'box-shadow 0.15s ease',
  },
  cardClickable: {
    cursor: 'pointer',
    '&:hover': { boxShadow: tokens.shadow8 },
  },
  label: {
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXXS,
  },
  value: {
    fontSize: '32px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
    color: tokens.colorNeutralForeground1,
  },
  valueSuccess: { color: tokens.colorPaletteGreenForeground2 },
  valueWarning: { color: tokens.colorPaletteMarigoldForeground2 },
  valueDanger: { color: tokens.colorPaletteRedForeground2 },
  subtitle: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
    marginTop: tokens.spacingVerticalXXS,
  },
});

type KpiColor = 'default' | 'success' | 'warning' | 'danger';

interface Props {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  color?: KpiColor;
  onClick?: () => void;
}

export function DashboardKPICard({ label, value, subtitle, color = 'default', onClick }: Props) {
  const styles = useStyles();

  const valueColor =
    color === 'success' ? styles.valueSuccess :
    color === 'warning' ? styles.valueWarning :
    color === 'danger'  ? styles.valueDanger  :
    styles.value;

  return (
    <div
      className={`${styles.card}${onClick ? ` ${styles.cardClickable}` : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={styles.label}>{label}</div>
      <div className={`${styles.value} ${valueColor}`}>{value}</div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
    </div>
  );
}
