/**
 * Status banner component for displaying alerts and status messages
 */
import { MessageBar, MessageBarBody, makeStyles, tokens } from '@fluentui/react-components';
import { InfoRegular, CheckmarkCircleRegular, WarningRegular, ErrorCircleRegular } from '@fluentui/react-icons';

const useStyles = makeStyles({
  banner: {
    marginBottom: tokens.spacingVerticalL,
  },
});

interface StatusBannerProps {
  intent?: 'success' | 'warning' | 'error' | 'info';
  title: string;
  message?: string;
}

export function StatusBanner({ intent = 'info', title, message }: StatusBannerProps) {
  const styles = useStyles();

  const iconMap = {
    success: CheckmarkCircleRegular,
    warning: WarningRegular,
    error: ErrorCircleRegular,
    info: InfoRegular,
  };

  const Icon = iconMap[intent];

  return (
    <MessageBar intent={intent} className={styles.banner}>
      <MessageBarBody>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: tokens.spacingHorizontalS }}>
          <Icon style={{ fontSize: 20, marginTop: '2px' }} />
          <div>
            <strong>{title}</strong>
            {message && <div style={{ marginTop: tokens.spacingVerticalXS }}>{message}</div>}
          </div>
        </div>
      </MessageBarBody>
    </MessageBar>
  );
}
