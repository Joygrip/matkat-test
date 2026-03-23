/**
 * Consistent status pill for admin tables.
 */
import { Badge } from '@fluentui/react-components';

type StatusValue = 'active' | 'on_hold' | 'inactive';

interface StatusPillProps {
  status: StatusValue;
}

const STATUS_CONFIG: Record<StatusValue, { label: string; color: 'success' | 'warning' | 'subtle' }> = {
  active: { label: 'Active', color: 'success' },
  on_hold: { label: 'On Hold', color: 'warning' },
  inactive: { label: 'Inactive', color: 'subtle' },
};

export function StatusPill({ status }: StatusPillProps) {
  const { label, color } = STATUS_CONFIG[status];
  return (
    <Badge appearance="filled" color={color} shape="rounded">
      {label}
    </Badge>
  );
}

/** Derive StatusValue from a boolean is_active + optional "on hold" semantics. */
export function projectStatus(isActive: boolean): StatusValue {
  return isActive ? 'active' : 'on_hold';
}

export function resourceStatus(isActive: boolean): StatusValue {
  return isActive ? 'active' : 'inactive';
}
