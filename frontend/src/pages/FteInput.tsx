import { makeStyles, tokens } from '@fluentui/react-components';
import { usePeriod } from '../contexts/PeriodContext';
import { MyActualsMatrix } from '../components/actuals/MyActualsMatrix';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: tokens.spacingVerticalL,
    maxWidth: '1800px',
    margin: '0 auto',
    padding: `0 ${tokens.spacingHorizontalXXL} ${tokens.spacingVerticalXL}`,
  },
  subtitle: {
    fontSize: tokens.fontSizeBase300,
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalXS,
  },
});

export function FteInput() {
  const styles = useStyles();
  const { periods } = usePeriod();

  return (
    <div className={styles.container}>
      <p className={styles.subtitle}>Submit and manage your own monthly actuals.</p>
      <MyActualsMatrix periods={periods} />
    </div>
  );
}
