// Порт: привязка группового TG-чата к аккаунту-владельцу (db/099). Владелец — тот аккаунт,
// в чьи «Входящие» падают задачи от участников, которые не действуют «как отправитель»
// (не привязаны или без своего +Проекта). См.
// spec 2026-07-08-telegram-group-multi-user-tasks-design.
export interface TelegramGroupOwnerRepository {
  // userId владельца группы или null, если группа ещё не привязана.
  getOwnerUserId(tgChatId: number): Promise<string | null>;

  // Привязывает владельца, если группа ещё свободна (first-writer-wins). Возвращает
  // действующего владельца (нового или уже существовавшего) и флаг, была ли создана привязка.
  bindIfAbsent(
    tgChatId: number,
    ownerUserId: string,
  ): Promise<{ ownerUserId: string; created: boolean }>;
}
