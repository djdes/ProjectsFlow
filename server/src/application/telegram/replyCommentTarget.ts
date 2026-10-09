// Reply на сообщение бота со списком задач (сводка, «На утверждении», напоминание перед
// уходом): к какой из задач относится комментарий. Чистые функции — без Telegram и БД.

export type ReplyCommentCandidate = {
  readonly taskId: string;
  readonly projectId: string;
  // Заголовок задачи (первая строка описания без markdown) — как он виден в сообщении.
  readonly title: string;
};

export type ReplyCommentTarget =
  | { readonly kind: 'one'; readonly task: ReplyCommentCandidate }
  // Однозначно выбрать нельзя — спросить кнопками среди options.
  | { readonly kind: 'choose'; readonly options: readonly ReplyCommentCandidate[] };

// Короче — цитата вроде «и» или «на» совпала бы с половиной заголовков.
const MIN_QUOTE_LENGTH = 3;

// Сравниваем буквы и цифры: в цитате бывают «…» усечённого заголовка, значки ✓ ↗,
// кавычки и соседние ячейки таблицы (исполнитель, дедлайн).
export function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Цитата содержит заголовок целиком (выделили строку таблицы) или сама — часть заголовка
// (выделили несколько слов или усечённый «…» заголовок). Совпало несколько — берём задачи
// с самым длинным заголовком внутри цитаты; если и так не один — спрашиваем среди совпавших.
export function matchQuotedTasks(
  candidates: readonly ReplyCommentCandidate[],
  quote: string,
): ReplyCommentCandidate[] {
  const q = normalizeForMatch(quote);
  if (q.length < MIN_QUOTE_LENGTH) return [];
  const containing: Array<{ candidate: ReplyCommentCandidate; length: number }> = [];
  const contained: ReplyCommentCandidate[] = [];
  for (const candidate of candidates) {
    const title = normalizeForMatch(candidate.title);
    if (title.length === 0) continue;
    if (q.includes(title)) containing.push({ candidate, length: title.length });
    else if (title.includes(q)) contained.push(candidate);
  }
  if (containing.length > 0) {
    const longest = Math.max(...containing.map((item) => item.length));
    return containing.filter((item) => item.length === longest).map((item) => item.candidate);
  }
  return contained;
}

export function resolveReplyCommentTarget(
  candidates: readonly ReplyCommentCandidate[],
  quote: string | null,
): ReplyCommentTarget {
  if (quote) {
    const matched = matchQuotedTasks(candidates, quote);
    if (matched.length === 1) return { kind: 'one', task: matched[0]! };
    if (matched.length > 1) return { kind: 'choose', options: matched };
  }
  if (candidates.length === 1) return { kind: 'one', task: candidates[0]! };
  return { kind: 'choose', options: candidates };
}

// Комментарий ждёт, пока автор выберет задачу кнопкой. Хранится в памяти процесса: кнопки
// короткоживущие, а после перезапуска сервера достаточно ответить на сводку ещё раз.
export type PendingReplyComment = {
  readonly tgUserId: number;
  readonly senderUserId: string;
  readonly chatId: number;
  readonly text: string;
  readonly options: readonly ReplyCommentCandidate[];
  readonly expiresAt: number;
};

const PENDING_TTL_MS = 30 * 60 * 1000;
const PENDING_LIMIT = 500;

export class PendingReplyComments {
  private readonly items = new Map<string, PendingReplyComment>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly newId: () => string = () => Math.random().toString(36).slice(2, 10),
  ) {}

  add(input: Omit<PendingReplyComment, 'expiresAt'>): string {
    this.purge();
    let id = this.newId();
    while (this.items.has(id)) id = this.newId();
    this.items.set(id, { ...input, expiresAt: this.now() + PENDING_TTL_MS });
    // Защита памяти: при лавине ответов отбрасываем самые старые.
    while (this.items.size > PENDING_LIMIT) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    return id;
  }

  get(id: string): PendingReplyComment | null {
    const item = this.items.get(id);
    if (!item) return null;
    if (item.expiresAt <= this.now()) {
      this.items.delete(id);
      return null;
    }
    return item;
  }

  delete(id: string): void {
    this.items.delete(id);
  }

  private purge(): void {
    const at = this.now();
    for (const [id, item] of this.items) if (item.expiresAt <= at) this.items.delete(id);
  }
}
