import { makeStyles, tokens, Skeleton, SkeletonItem } from '@fluentui/react-components';

export interface KpiTile {
  label: string;
  value: string | number;
  color?: 'default' | 'danger' | 'success' | 'warning';
  onClick?: () => void;
  active?: boolean;
}

export interface FinanceKpiStripProps {
  tiles: KpiTile[];
  loading?: boolean;
}

const useStyles = makeStyles({
  strip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
    gap: tokens.spacingHorizontalM,
    marginBottom: tokens.spacingVerticalL,
  },
  tile: {
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    borderRadius: tokens.borderRadiusLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow2,
    textAlign: 'center' as const,
    cursor: 'default',
    userSelect: 'none' as const,
  },
  tileClickable: {
    cursor: 'pointer',
    '&:hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  tileActive: {
    borderTopColor: tokens.colorBrandStroke1,
    borderRightColor: tokens.colorBrandStroke1,
    borderBottomColor: tokens.colorBrandStroke1,
    borderLeftColor: tokens.colorBrandStroke1,
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  label: {
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: tokens.spacingVerticalXXS,
  },
  value: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightBold,
    lineHeight: '1.2',
    color: tokens.colorNeutralForeground1,
  },
  valueDanger: { color: tokens.colorPaletteRedForeground1 },
  valueSuccess: { color: tokens.colorPaletteGreenForeground1 },
  valueWarning: { color: tokens.colorPaletteDarkOrangeForeground1 },
});

export function FinanceKpiStrip({ tiles, loading }: FinanceKpiStripProps) {
  const styles = useStyles();

  if (loading) {
    return (
      <div className={styles.strip}>
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} style={{ height: 72 }}><SkeletonItem style={{ height: '100%' }} /></Skeleton>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.strip}>
      {tiles.map((tile, i) => {
        const classes = [
          styles.tile,
          tile.onClick ? styles.tileClickable : '',
          tile.active ? styles.tileActive : '',
        ].filter(Boolean).join(' ');

        const valueClass = [
          styles.value,
          tile.color === 'danger' ? styles.valueDanger : '',
          tile.color === 'success' ? styles.valueSuccess : '',
          tile.color === 'warning' ? styles.valueWarning : '',
        ].filter(Boolean).join(' ');

        return (
          <div
            key={i}
            className={classes}
            onClick={tile.onClick}
            role={tile.onClick ? 'button' : undefined}
            tabIndex={tile.onClick ? 0 : undefined}
            onKeyDown={tile.onClick ? (e) => e.key === 'Enter' && tile.onClick!() : undefined}
          >
            <div className={styles.label}>{tile.label}</div>
            <div className={valueClass}>{tile.value}</div>
          </div>
        );
      })}
    </div>
  );
}
