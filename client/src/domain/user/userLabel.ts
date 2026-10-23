export function userLabel(user: { displayName?: string | null; email?: string | null }): string {
  return user.displayName?.trim() || user.email?.trim() || 'Без имени';
}
