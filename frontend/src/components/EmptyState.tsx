/**
 * Empty state component
 */
import { ReactNode } from 'react';
import { makeStyles, tokens, Title3, Body1 } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
    textAlign: 'center',
    minHeight: '300px',
  },
  icon: {
    fontSize: '64px',
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalL,
  },
  title: {
    marginBottom: tokens.spacingVerticalS,
  },
  message: {
    color: tokens.colorNeutralForeground3,
    marginBottom: tokens.spacingVerticalL,
    maxWidth: '400px',
  },
});

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, message, action }: EmptyStateProps) {
  const styles = useStyles();

  return (
    <div className={styles.container}>
      <div className={styles.icon}>{icon}</div>
      <Title3 className={styles.title}>{title}</Title3>
      {message && <Body1 className={styles.message}>{message}</Body1>}
      {action && <div>{action}</div>}
    </div>
  );
}
