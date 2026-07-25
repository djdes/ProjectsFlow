// Порт хранилища «прогресс-сообщения» батча сверки коммитов (db/145). Одна строка на batch_key.
// Гарантирует «ровно один прогресс на батч»: tryClaim атомарно вставляет строку и возвращает false,
// если прогресс для этого батча уже начат (конфликт по PK).

export type CommitSyncBatchProgress = {
  readonly chatId: number;
  // id отправленного прогресс-сообщения. null между claim и первой успешной отправкой.
  readonly messageId: number | null;
};

export type CommitSyncBatchProgressRepository = {
  /**
   * Атомарно застолбить прогресс для батча (INSERT одной строки). true — этот вызов застолбил и
   * ДОЛЖЕН отправить прогресс-сообщение; false — прогресс уже начат кем-то (конфликт по PK).
   */
  tryClaim(batchKey: string, chatId: number): Promise<boolean>;
  /** Записать message_id отправленного прогресс-сообщения. */
  setMessageId(batchKey: string, messageId: number): Promise<void>;
  /** Текущее состояние прогресса батча (chatId + message_id) или null, если его нет. */
  get(batchKey: string): Promise<CommitSyncBatchProgress | null>;
  /** Удалить строку прогресса (после удаления сообщения и отправки итога). */
  delete(batchKey: string): Promise<void>;
};
