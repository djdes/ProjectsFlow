// Задачи, перечисленные в сообщении бота со списком (db/160): сводки по людям, «На
// утверждении», напоминание перед уходом, сверка коммитов, ответ на «@бот @человек».
// Reply на такое сообщение становится комментарием к одной из этих задач.
export type TelegramMessageTask = {
  readonly taskId: string;
  readonly projectId: string;
};

export interface TelegramMessageTaskRepository {
  // Запомнить задачи сообщения в порядке показа. Повторная запись того же сообщения
  // дополняет список (дубли задач игнорируются).
  attach(input: {
    readonly chatId: number;
    readonly messageId: number;
    readonly tasks: readonly TelegramMessageTask[];
  }): Promise<void>;
  // Задачи сообщения в порядке показа. Пусто — reply не на сообщение со списком.
  listByMessage(chatId: number, messageId: number): Promise<TelegramMessageTask[]>;
  // Хвост старше даты: на месячной давности сводку уже не комментируют.
  deleteOlderThan(cutoff: Date): Promise<number>;
}
