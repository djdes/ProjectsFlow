import type { TelegramGroupMembers } from '@/domain/workspace/TelegramWorkGroup';

// Подпись по образцу spec 2026-11-17 §4: «Участники: N в Telegram, M связаны с PF».
export function groupMembersLabel(members: Pick<TelegramGroupMembers, 'telegramCount' | 'linked'>): string {
  return `Участники: ${members.telegramCount} в Telegram, ${members.linked.length} связаны с PF`;
}

/**
 * Участники рабочей группы (db/191): сколько знает бот, кто из них связан с PF (они молча
 * добавлены в пространство редактором) и подсказка, если бот не администратор группы — тогда
 * Telegram не сообщает ему о вступлениях и выходах, видны только администраторы и авторы.
 */
export function TelegramGroupMembersView({
  members,
}: {
  members: TelegramGroupMembers | null;
}): React.ReactElement {
  if (!members) {
    return <div className="mbs-1.5 text-xs text-muted-foreground">Участники: загрузка…</div>;
  }
  return (
    <div className="mbs-1.5 space-y-1" data-pf="telegram-group-members">
      <div className="text-xs">{groupMembersLabel(members)}</div>
      {members.linked.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Связаны с PF">
          {members.linked.map((member) => (
            <li key={member.userId} className="pf-tag pf-tone-gray text-2xs">
              {member.displayName}
              {member.status === 'admin' && <span className="text-muted-foreground"> · админ группы</span>}
            </li>
          ))}
        </ul>
      )}
      {members.botIsAdmin === false && (
        <div className="text-xs text-muted-foreground" role="note">
          Бот не администратор группы — о вступлениях и выходах Telegram ему не сообщает: видны только
          администраторы и те, кто пишет. Сделайте бота администратором, чтобы список был полнее.
        </div>
      )}
    </div>
  );
}
