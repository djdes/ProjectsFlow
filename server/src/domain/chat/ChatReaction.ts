// Реакция-эмодзи на сообщение. PK (messageId, userId, emoji) — один юзер ставит
// конкретную эмодзи максимум один раз.
export type ChatReaction = {
  readonly messageId: string;
  readonly userId: string;
  readonly emoji: string;
};

// Агрегат для read-модели/wire: сколько и кто поставил конкретную эмодзи на сообщение.
// reactedByMe НЕ хранится здесь — SSE-события viewer-agnostic, клиент выводит его из userIds.
export type ChatReactionAggregate = {
  readonly emoji: string;
  readonly count: number;
  readonly userIds: readonly string[];
};
