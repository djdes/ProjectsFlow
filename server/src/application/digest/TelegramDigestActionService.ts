import type { EmailActionPreview, EmailActionRun, EmailActionService } from '../email-action/EmailActionService.js';
import type { TelegramClient } from '../telegram/TelegramClient.js';
import type { TelegramDigestActionDeliveryRepository } from './TelegramDigestActionDeliveryRepository.js';

type Deps = {
  readonly emailActions: EmailActionService;
  readonly deliveries: TelegramDigestActionDeliveryRepository;
  readonly telegram: TelegramClient;
  readonly notifyTaskChanged?: (projectId: string) => void;
};

export class TelegramDigestActionService {
  constructor(private readonly deps: Deps) {}

  preview(token: string): Promise<EmailActionPreview> {
    return this.deps.emailActions.preview(token);
  }

  async complete(token: string): Promise<EmailActionRun> {
    const delivery = await this.deps.deliveries.findByToken(token).catch(() => null);
    const result = await this.deps.emailActions.complete(token);
    if (result.kind !== 'done' && result.kind !== 'used') return result;

    if (result.kind === 'done') {
      this.deps.notifyTaskChanged?.(result.projectId);
    }
    if (!delivery) return result;

    const updated = markTelegramDigestTaskCompleted(delivery.messageHtml, token);
    if (updated === delivery.messageHtml) return result;

    await this.deps.deliveries
      .updateMessage({
        chatId: delivery.chatId,
        messageId: delivery.messageId,
        messageHtml: updated,
      })
      .catch(() => undefined);

    await this.deps.telegram
      .editMessageText(
        delivery.messageKind === 'rich'
          ? {
              chatId: delivery.chatId,
              messageId: delivery.messageId,
              richHtml: updated,
            }
          : {
              chatId: delivery.chatId,
              messageId: delivery.messageId,
              text: updated,
              parseMode: 'HTML',
              disableWebPagePreview: true,
            },
      )
      .catch(() => undefined);

    return result;
  }
}

export function extractTelegramDigestActionTokens(html: string): string[] {
  const tokens = new Set<string>();
  const pattern = /\/api\/telegram-digest-actions\/([a-f0-9]{32,64})/gi;
  for (const match of html.matchAll(pattern)) {
    if (match[1]) tokens.add(match[1].toLowerCase());
  }
  return [...tokens];
}

export function markTelegramDigestTaskCompleted(html: string, token: string): string {
  const safeToken = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const actionPattern = new RegExp(
    `<a href="[^"]*\\/api\\/telegram-digest-actions\\/${safeToken}">(?:○|✓(?: Завершить)?)<\\/a>`,
    'i',
  );
  const match = actionPattern.exec(html);
  if (!match) return html;

  const rowStart = html.lastIndexOf('<tr>', match.index);
  const rowEnd = html.indexOf('</tr>', match.index);
  if (rowStart >= 0 && rowEnd >= 0) {
    const end = rowEnd + '</tr>'.length;
    const row = html.slice(rowStart, end);
    let updatedRow = row.replace(actionPattern, '<b>✅</b>');
    updatedRow = updatedRow.replace(/<b>([\s\S]*?)<\/b>/, '<s><b>$1</b></s>');
    return html.slice(0, rowStart) + updatedRow + html.slice(end);
  }

  const itemStart = html.lastIndexOf('<li>', match.index);
  const itemEnd = html.indexOf('</li>', match.index);
  if (itemStart < 0 || itemEnd < 0) {
    const lineStart = html.lastIndexOf('\n', match.index) + 1;
    const nextBreak = html.indexOf('\n', match.index);
    const lineEnd = nextBreak < 0 ? html.length : nextBreak;
    const line = html.slice(lineStart, lineEnd);
    let updatedLine = line.replace(actionPattern, '<b>✅ Завершено</b>');
    updatedLine = updatedLine.replace(
      /<a href="([^"]+)"><b>([\s\S]*?)<\/b><\/a>/,
      '<a href="$1"><s><b>$2</b></s></a>',
    );
    return html.slice(0, lineStart) + updatedLine + html.slice(lineEnd);
  }

  const end = itemEnd + '</li>'.length;
  const item = html.slice(itemStart, end);
  let updatedItem = item.replace(actionPattern, '<b>✅ Завершено</b>');
  updatedItem = updatedItem.replace(
    /<a href="([^"]+)"><b>([\s\S]*?)<\/b><\/a>/,
    '<a href="$1"><s><b>$2</b></s></a>',
  );
  return html.slice(0, itemStart) + updatedItem + html.slice(end);
}
