import { escapeHtml } from '../../domain/task/digestFormat.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type {
  CommitSyncBatchStatus,
  CommitSyncJobRepository,
} from './CommitSyncJobRepository.js';
import type { CommitSyncBatchProgressRepository } from './CommitSyncBatchProgressRepository.js';

type Deps = {
  readonly telegram: Pick<TelegramClient, 'sendMessage' | 'editMessageText' | 'deleteMessages'>;
  readonly commitSyncJobs: Pick<CommitSyncJobRepository, 'listBatchStatuses'>;
  readonly progress: CommitSyncBatchProgressRepository;
};

// Живой прогресс сверки коммитов в Telegram-группе (db/145). ОДНО редактируемое сообщение на
// многопроектный плановый батч: заголовок «🔍 Сверяю коммиты…» + список проектов со статус-эмодзи
// ⏳ (в очереди/в работе) → ✅ (готово) → ⚠️ (не удалось/таймаут). По мере завершения заданий
// сообщение переписывается из АКТУАЛЬНОГО состояния БД; когда весь батч терминален — сообщение
// удаляется, а вместо него уходит свёрнутый итог (FlushCommitSyncBatch).
//
// Прогресс показываем ТОЛЬКО для многопроектных батчей: одиночный проект (в т.ч. ручная «Сверить
// сейчас») сразу получает итог, промежуточное сообщение для одной строки — лишний шум.
export class CommitSyncBatchProgress {
  constructor(private readonly deps: Deps) {}

  // Старт: вызывается планировщиком, когда все job'ы батча уже поставлены. Атомарно столбит прогресс
  // (ровно один на батч даже при гонке enqueue), затем шлёт одно сообщение со списком ⏳. Best-effort.
  async start(batchKey: string): Promise<void> {
    const chatId = parseBatchKeyChatId(batchKey);
    if (chatId === null) return;

    const statuses = await this.deps.commitSyncJobs.listBatchStatuses(batchKey);
    // Прогресс только для многопроектных батчей — одиночный проект сразу получает итог.
    if (statuses.length < 2) return;

    // Атомарный claim по PK: конфликт → прогресс уже начат кем-то (гонка enqueue) → молчок.
    const claimed = await this.deps.progress.tryClaim(batchKey, chatId).catch(() => false);
    if (!claimed) return;

    const result = await this.deps.telegram
      .sendMessage({
        chatId,
        text: renderProgress(statuses),
        parseMode: 'HTML',
        disableWebPagePreview: true,
      })
      .catch(() => null);
    if (result?.kind === 'ok') {
      await this.deps.progress.setMessageId(batchKey, result.messageId).catch(() => {});
    }
  }

  // Обновление: вызывается при завершении КАЖДОГО задания батча. Пересобирает список из актуального
  // состояния всех заданий и редактирует сообщение. Каждый edit строит полный список из БД, поэтому
  // потерянный из-за rate-limit edit самозалечивается следующим. «not modified»/429 глотаем.
  async refresh(batchKey: string): Promise<void> {
    const state = await this.deps.progress.get(batchKey).catch(() => null);
    if (!state || state.messageId === null) return;
    const statuses = await this.deps.commitSyncJobs.listBatchStatuses(batchKey);
    if (statuses.length === 0) return;
    await this.deps.telegram
      .editMessageText({
        chatId: state.chatId,
        messageId: state.messageId,
        text: renderProgress(statuses),
        parseMode: 'HTML',
        disableWebPagePreview: true,
      })
      .catch(() => {});
  }

  // Финал: вызывается сборщиком батча (FlushCommitSyncBatch), когда весь батч терминален. Удаляет
  // прогресс-сообщение и чистит строку — сразу после этого сборщик шлёт итоговый дайджест (или
  // молчит, если показывать нечего). Best-effort; строку чистим в любом случае.
  async clear(batchKey: string): Promise<void> {
    const state = await this.deps.progress.get(batchKey).catch(() => null);
    if (!state) return;
    if (state.messageId !== null && this.deps.telegram.deleteMessages) {
      await this.deps.telegram
        .deleteMessages({ chatId: state.chatId, messageIds: [state.messageId] })
        .catch(() => {});
    }
    await this.deps.progress.delete(batchKey).catch(() => {});
  }
}

const STATUS_EMOJI: Record<CommitSyncBatchStatus['status'], string> = {
  queued: '⏳',
  running: '⏳',
  succeeded: '✅',
  failed: '⚠️',
  cancelled: '⚠️',
};

// Заголовок + строка на проект: «<эмодзи> <Название проекта>». Обычный HTML — сообщение
// редактируемое (rich для прогресса не нужен). Настоящего анимированного спиннера в обычном
// TG-сообщении нет — используем ⏳.
function renderProgress(statuses: readonly CommitSyncBatchStatus[]): string {
  const lines = statuses.map(
    (s) => `${STATUS_EMOJI[s.status]} ${escapeHtml(s.projectName ?? 'Проект')}`,
  );
  return [`<b>🔍 Сверяю коммиты…</b>`, '', ...lines].join('\n');
}

// chatId зашит первым сегментом ключа '<chatId>:<YYYY-MM-DD>:<HH>:<MM>'. Группы — отрицательные id,
// поэтому берём подстроку до первого ':' и парсим как целое. Битый ключ → null (прогресс не шлём).
export function parseBatchKeyChatId(batchKey: string): number | null {
  const head = batchKey.slice(0, batchKey.indexOf(':'));
  if (head.length === 0) return null;
  const n = Number(head);
  return Number.isInteger(n) ? n : null;
}
