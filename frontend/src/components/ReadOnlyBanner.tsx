/**
 * Read-only banner component for pages where user lacks edit permissions.
 */
import { MessageBar, MessageBarBody } from '@fluentui/react-components';
import { LockClosedRegular } from '@fluentui/react-icons';

interface ReadOnlyBannerProps {
  message?: string;
}

export function ReadOnlyBanner({ message = 'You have read-only access to this page.' }: ReadOnlyBannerProps) {
  return (
    <MessageBar intent="info" icon={<LockClosedRegular />}>
      <MessageBarBody>
        <strong>Read-only mode:</strong> {message}
      </MessageBarBody>
    </MessageBar>
  );
}
