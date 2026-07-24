import { escapeHtml } from '../../domain/task/digestFormat.js';
import type { SendMessageResult, TelegramClient } from '../telegram/TelegramClient.js';
import type { TelegramDigestActionDeliveryRepository } from '../digest/TelegramDigestActionDeliveryRepository.js';
import { extractTelegramDigestActionTokens } from '../digest/TelegramDigestActionService.js';
import type { CommitReviewResult, CommitReviewRow } from './CommitReviewResult.js';

type Deps = {
  readonly telegram: TelegramClient;
  readonly telegramDigestActions: TelegramDigestActionDeliveryRepository;
};

export type SendWorkspaceCommitReviewInput = {
  // Telegram-группа пространства (общая у всех проектов батча по построению batch_key).
  readonly chatId: number;
  // Готовые per-project payload'ы одного батча (день+время+группа совпадают). Пустой — молчок.
  readonly results: readonly CommitReviewResult[];
  // Подменяемое «сейчас» для детерминированной даты в заголовке (тесты).
  readonly now?: Date;
};

// Объединённая сводка сверки коммитов в Telegram-группу пространства. Собирает результаты
// НЕСКОЛЬКИХ проектов одного батча (совпали группа+дата+час+минута сверки) в ОДНО сообщение:
//  - заголовок дайджеста с датой;
//  - по каждому проекту — нативно сворачиваемый блок <details> (в rich) / <blockquote expandable>
//    (в fallback) с таблицей/списком задач и подписью режима: «закрыто» (auto) / «предложено
//    закрыть» (propose). Режим может отличаться у проектов в одном батче.
// Действия по задаче (↗ открыть, ✓ закрыть через email-action токен) сохраняются и работают в
// объединённом сообщении: токены всех проектов запоминаются одной записью доставки.
export class SendWorkspaceCommitReview {
  constructor(private readonly deps: Deps) {}

  async execute(input: SendWorkspaceCommitReviewInput): Promise<boolean> {
    if (input.results.length === 0) return false;
    const now = input.now ?? new Date();

    const richHtml = buildDigestRich(input.results, now);
    let deliveredHtml = richHtml;
    let deliveredKind: 'rich' | 'html' = 'rich';
    let result: SendMessageResult | null = null;
    let fallbackAllowed = !this.deps.telegram.sendRichMessage;
    if (this.deps.telegram.sendRichMessage) {
      try {
        const richResult = await this.deps.telegram.sendRichMessage({
          chatId: input.chatId,
          html: richHtml,
        });
        if (richResult.kind === 'ok') result = richResult;
        // Неоднозначный сбой (deliveryUnknown) не повторяем — иначе дубль в группе.
        fallbackAllowed = richResult.kind === 'error' && richResult.deliveryUnknown !== true;
      } catch (error) {
        console.warn('[commit-sync-digest] rich message failed', error);
        fallbackAllowed = false;
      }
    }

    if (!result && fallbackAllowed) {
      deliveredHtml = buildDigestFallback(input.results, now);
      deliveredKind = 'html';
      result = await this.deps.telegram.sendMessage({
        chatId: input.chatId,
        text: deliveredHtml,
        parseMode: 'HTML',
        disableWebPagePreview: true,
      });
    }

    if (result?.kind !== 'ok') return false;
    await this.deps.telegramDigestActions
      .attach({
        tokens: extractTelegramDigestActionTokens(deliveredHtml),
        chatId: input.chatId,
        messageId: result.messageId,
        messageHtml: deliveredHtml,
        messageKind: deliveredKind,
      })
      .catch((error) => console.warn('[commit-sync-digest] remember actions failed', error));
    return true;
  }
}

function modeLabel(mode: 'auto' | 'propose'): string {
  return mode === 'auto' ? 'закрыто' : 'предложено закрыть';
}

// «N задача/задачи/задач» — русская форма множественного числа.
function pluralTasks(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${n} задач`;
  if (mod10 === 1) return `${n} задача`;
  if (mod10 >= 2 && mod10 <= 4) return `${n} задачи`;
  return `${n} задач`;
}

function digestTitle(now: Date): string {
  const date = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(now);
  return `🔍 Сверка коммитов · ${date}`;
}

// rich_message (Bot API 10.2): заголовок + по проекту нативно сворачиваемый <details> с таблицей.
function buildDigestRich(results: readonly CommitReviewResult[], now: Date): string {
  const body: string[] = [`<h2>${escapeHtml(digestTitle(now))}</h2>`];
  for (const result of results) {
    const summary = `${escapeHtml(result.projectName)} · ${pluralTasks(result.rows.length)} · ${modeLabel(result.mode)}`;
    body.push(`<details><summary>${summary}</summary>`);
    body.push('<table bordered striped>');
    body.push('<tr><th>Задача</th></tr>');
    for (const row of result.rows) {
      body.push(`<tr><td><b>${escapeHtml(row.title)}</b><br>${richActions(row)}</td></tr>`);
    }
    body.push('</table>');
    body.push('</details>');
  }
  return body.join('');
}

function richActions(row: CommitReviewRow): string {
  const open = `<a href="${escapeHtml(row.openUrl)}">↗</a>`;
  return row.completeUrl
    ? `<a href="${escapeHtml(row.completeUrl)}">✓</a> · ${open}`
    : open;
}

// Fallback обычным HTML: заголовок + по проекту подпись режима и <blockquote expandable> со
// списком задач. Заголовок задачи обёрнут в ссылку «открыть» — так и действие ✓, и вычёркивание
// при завершении (markTelegramDigestTaskCompleted) деградируют корректно.
function buildDigestFallback(results: readonly CommitReviewResult[], now: Date): string {
  const parts: string[] = [`<b>${escapeHtml(digestTitle(now))}</b>`];
  for (const result of results) {
    parts.push('');
    parts.push(`<b>${escapeHtml(result.projectName)} · ${modeLabel(result.mode)}</b>`);
    const lines = result.rows.map((row) => {
      const title = `<a href="${escapeHtml(row.openUrl)}"><b>${escapeHtml(row.title)}</b></a>`;
      return row.completeUrl
        ? `• ${title} <a href="${escapeHtml(row.completeUrl)}">✓</a>`
        : `• ${title}`;
    });
    parts.push(`<blockquote expandable>${lines.join('\n')}</blockquote>`);
  }
  return parts.join('\n');
}
