// Контекст Telegram-чата для выбора пространства задач (см. resolveDraftWorkspace, db/164).

// Последний выбор пространства пользователем в этом чате (кнопкой конструктора задач).
export type TelegramChatWorkspaceChoice = {
  readonly workspaceId: string;
  readonly chosenAt: Date;
};

export interface TelegramChatWorkspaceRepository {
  // Пространства, к которым привязана Telegram-группа: через сводку проекта (группа указана в
  // настройках сводки проекта → пространство проекта) или через сводку пространства. Пусто —
  // группа ни к чему не привязана (или это личный чат с ботом).
  linkedWorkspaceIds(tgChatId: number): Promise<string[]>;
  getChoice(tgChatId: number, userId: string): Promise<TelegramChatWorkspaceChoice | null>;
  saveChoice(tgChatId: number, userId: string, workspaceId: string): Promise<void>;
}
