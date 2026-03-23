import { Badge } from '@fluentui/react-components';

export function GapBadge({ gap }: { gap: number }) {
  const color = gap < 0 ? 'danger' : gap > 0 ? 'success' : 'informative';
  return (
    <Badge appearance="filled" color={color}>
      {gap > 0 ? '+' : ''}{gap}%
    </Badge>
  );
}

export function GapStatusBadge({ status }: { status: string }) {
  if (status === 'under') return <Badge appearance="outline" color="danger" size="small">Under-staffed</Badge>;
  if (status === 'over') return <Badge appearance="outline" color="warning" size="small">Over-staffed</Badge>;
  return <Badge appearance="outline" color="success" size="small">Balanced</Badge>;
}

export function ApprovalBadge({ status }: { status: string }) {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return <Badge color="success" appearance="filled">Approved</Badge>;
    case 'PENDING':
      return <Badge color="warning" appearance="filled">Pending</Badge>;
    case 'REJECTED':
      return <Badge color="danger" appearance="filled">Rejected</Badge>;
    default:
      return <Badge color="informative" appearance="outline">Unsigned</Badge>;
  }
}

export function PlaceholderTypeBadge({ type = 'TBH' }: { type?: 'TBH' | 'TBD' }) {
  return <Badge appearance="outline" color="warning" size="small">{type}</Badge>;
}
