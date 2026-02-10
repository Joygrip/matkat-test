/**
 * Loading state component
 */
import { Spinner, makeStyles, tokens, Body1 } from '@fluentui/react-components';

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: tokens.spacingVerticalXXL,
    minHeight: '200px',
    gap: tokens.spacingVerticalM,
  },
});

interface LoadingStateProps {
  message?: string;
}

export function LoadingState({ message = 'Loading...' }: LoadingStateProps) {
  const styles = useStyles();

  return (
    <div className={styles.container}>
      <Spinner size="large" />
      <Body1>{message}</Body1>
    </div>
  );
}
