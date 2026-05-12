import { makeStyles, tokens } from '@fluentui/react-components';

type Sev = 'good' | 'warn' | 'bad' | 'pending' | 'default';

interface BarSegment {
  pct: number;
  sev: 'good' | 'warn' | 'bad';
}

export interface KPIStripItem {
  label: string;
  value: React.ReactNode;
  subtitle?: string;
  severity?: Sev;
  bar?: {
    fill?: number;
    fillSev?: 'good' | 'warn' | 'bad';
    segments?: BarSegment[];
  };
}

interface Props {
  items: KPIStripItem[];
}

const SEV_FORE: Record<Sev, string> = {
  good:    tokens.colorPaletteGreenForeground2,
  warn:    tokens.colorPaletteMarigoldForeground2,
  bad:     tokens.colorPaletteRedForeground2,
  pending: tokens.colorBrandForeground1,
  default: tokens.colorNeutralForeground1,
};

const SEV_BAR: Record<'good' | 'warn' | 'bad', string> = {
  good: tokens.colorPaletteGreenBackground2,
  warn: tokens.colorPaletteMarigoldBackground2,
  bad:  tokens.colorPaletteRedBackground2,
};

const useStyles = makeStyles({
  strip: {
    display: 'grid',
    gridTemplateColumns: 'repeat(5, 1fr)',
    gap: tokens.spacingHorizontalM,
  },
  card: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusLarge,
    padding: `${tokens.spacingVerticalM} ${tokens.spacingHorizontalL}`,
    boxShadow: tokens.shadow2,
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalXXS,
  },
  label: {
    fontSize: '11px',
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  value: {
    fontSize: '28px',
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: '1.2',
  },
  subtitle: {
    fontSize: '12px',
    color: tokens.colorNeutralForeground3,
  },
  barTrack: {
    marginTop: tokens.spacingVerticalXXS,
    height: '4px',
    borderRadius: '2px',
    backgroundColor: tokens.colorNeutralBackground4,
    overflow: 'hidden',
    display: 'flex',
  },
  barFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
});

export function DashboardKPIStrip({ items }: Props) {
  const styles = useStyles();

  return (
    <div className={styles.strip}>
      {items.map((item, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.label}>{item.label}</div>
          <div
            className={styles.value}
            style={{ color: item.severity ? SEV_FORE[item.severity] : tokens.colorNeutralForeground1 }}
          >
            {item.value}
          </div>
          {item.subtitle && <div className={styles.subtitle}>{item.subtitle}</div>}
          {item.bar && (
            <div className={styles.barTrack}>
              {item.bar.segments
                ? item.bar.segments.filter(s => s.pct > 0).map((seg, si) => (
                    <div
                      key={si}
                      className={styles.barFill}
                      style={{ width: `${seg.pct}%`, backgroundColor: SEV_BAR[seg.sev] }}
                    />
                  ))
                : (
                    <div
                      className={styles.barFill}
                      style={{
                        width: `${Math.min(100, item.bar!.fill ?? 0)}%`,
                        backgroundColor: item.bar!.fillSev ? SEV_BAR[item.bar!.fillSev] : tokens.colorBrandBackground,
                      }}
                    />
                  )
              }
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
