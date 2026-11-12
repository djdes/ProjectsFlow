import type { InviteCandidate } from '@/domain/workspace/InviteCandidate';

// Поиск в окне «Из соседних пространств»: по имени, почте и названию пространства.
export function filterCandidates(
  candidates: readonly InviteCandidate[],
  query: string,
): InviteCandidate[] {
  const needle = query.trim().toLocaleLowerCase('ru');
  if (!needle) return [...candidates];
  return candidates.filter((candidate) =>
    [candidate.displayName ?? '', candidate.email, ...candidate.workspaces.map((w) => w.name)].some((value) =>
      value.toLocaleLowerCase('ru').includes(needle),
    ),
  );
}

// Тост после отправки: сколько ушло и что пропущено.
export function neighborInviteSummary(
  statuses: ReadonlyArray<'queued' | 'reused' | 'member' | 'not_neighbor' | 'error'>,
): { readonly kind: 'success' | 'warning' | 'error'; readonly text: string } {
  const sent = statuses.filter((s) => s === 'queued' || s === 'reused').length;
  const failed = statuses.length - sent;
  if (sent === 0) return { kind: 'error', text: 'Не удалось отправить приглашения' };
  const head = `Отправили приглашений: ${sent} — почта, сайт и Telegram`;
  return failed > 0 ? { kind: 'warning', text: `${head}. Не получилось: ${failed}` } : { kind: 'success', text: head };
}
