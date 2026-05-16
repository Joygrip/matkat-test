const AVATAR_COLORS = ['#0078d4', '#107c10', '#d13438', '#ff8c00', '#8764b8', '#00b294', '#ca5010'];

export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Returns assignedInitials when provided, otherwise computes from name (first + last word). */
export function getInitials(name: string, assignedInitials?: string | null): string {
  if (assignedInitials) return assignedInitials;
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}
