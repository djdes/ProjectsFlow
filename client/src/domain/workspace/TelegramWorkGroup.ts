// Рабочая Telegram-группа пространства: в ней бот принимает задачи пространства и подключает
// людей без аккаунта или вне пространства (db/181).
export type TelegramWorkGroup = {
  readonly chatId: number;
  readonly title: string | null;
  readonly createdAt: string;
};

// work — рабочая группа; main — основная группа сводок (карточка Telegram-расписания).
export type TelegramGroupLinkPurpose = 'work' | 'main';

export type TelegramWorkGroups = {
  readonly groups: readonly TelegramWorkGroup[];
  // Основная группа сводок — чтобы предложить сделать её рабочей.
  readonly mainGroup: { readonly chatId: number; readonly title: string | null } | null;
  readonly botUsername: string | null;
};
