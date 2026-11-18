// Рабочая Telegram-группа пространства: в ней бот принимает задачи пространства и подключает
// людей без аккаунта или вне пространства (db/181).
// draft — бот сам добавлен в группу, ждёт подтверждения владельца/руководителя;
// active — рабочая группа; disconnected — бота удалили из группы (db/189).
export type TelegramWorkGroupStatus = 'draft' | 'active' | 'disconnected';

// standard — обычная рабочая группа; incident — группа инцидентов (замена CSharpFixer-чата):
// писать может любой, задача молча уходит воркеру, ответ — простым языком в группу.
export type TelegramWorkGroupMode = 'standard' | 'incident';

export type TelegramWorkGroup = {
  readonly chatId: number;
  readonly title: string | null;
  readonly createdAt: string;
  readonly status: TelegramWorkGroupStatus;
  readonly mode: TelegramWorkGroupMode;
  // Проекты группы: задачи из неё ставятся только в них. Пусто — все проекты пространства.
  readonly projectIds: readonly string[];
  // Другое пространство просит забрать отключённую группу: решает владелец этого пространства.
  readonly transferRequest: { readonly workspaceName: string | null; readonly requestedAt: string } | null;
};

// work — рабочая группа; main — основная группа сводок (карточка Telegram-расписания).
export type TelegramGroupLinkPurpose = 'work' | 'main';

export type TelegramWorkGroups = {
  readonly groups: readonly TelegramWorkGroup[];
  // Основная группа сводок — чтобы предложить сделать её рабочей.
  readonly mainGroup: { readonly chatId: number; readonly title: string | null } | null;
  readonly botUsername: string | null;
};

// Участники рабочей группы (db/191). Полного списка Telegram не даёт: бот знает
// администраторов, вступивших/вышедших (если он сам администратор) и авторов сообщений.
export type TelegramGroupLinkedMember = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly status: 'member' | 'admin';
};

export type TelegramGroupMembers = {
  // Сколько участников группы знает бот (без вышедших).
  readonly telegramCount: number;
  // Из них — с аккаунтом PF (они молча добавляются в пространство редактором).
  readonly linked: readonly TelegramGroupLinkedMember[];
  // false — бот не администратор группы: о вступлениях и выходах Telegram ему не сообщает.
  // null — неизвестно.
  readonly botIsAdmin: boolean | null;
};
