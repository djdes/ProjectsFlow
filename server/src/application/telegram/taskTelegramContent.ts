import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import { figureImageSrc, markdownToRich } from '../../domain/task/digestFormat.js';
import { attachmentIdFromSrc } from '../attachments/signedAttachmentUrl.js';
import type { SendRichMessageMediaInput } from './TelegramClient.js';

const TELEGRAM_TEXT_LIMIT = 3_200;
const TELEGRAM_RICH_TEXT_LIMIT = 32_768;
const TELEGRAM_RICH_MEDIA_LIMIT = 50;

type RawDescriptionPart =
  | { readonly kind: 'text'; readonly markdown: string }
  | { readonly kind: 'image'; readonly src: string };

export type TelegramTaskContentPart =
  | {
      readonly kind: 'text';
      readonly html: string;
      readonly section: 'description' | 'attachments_heading';
    }
  | {
      readonly kind: 'attachment';
      readonly attachmentId: string;
      readonly url: string;
      readonly filename: string;
      readonly mimeType: string;
      readonly inline: boolean;
    };

export type TelegramTaskRichContent = {
  readonly html: string;
  readonly media: readonly SendRichMessageMediaInput[];
  readonly consumedParts: number;
};

function splitDescription(description: string | null): RawDescriptionPart[] {
  const parts: RawDescriptionPart[] = [];
  const textLines: string[] = [];
  let inCodeFence = false;

  const flushText = (): void => {
    const markdown = textLines.join('\n').trim();
    textLines.length = 0;
    if (markdown) parts.push({ kind: 'text', markdown });
  };

  for (const line of (description ?? '').replace(/\r/g, '').split('\n')) {
    if (/^\s*```/.test(line)) {
      inCodeFence = !inCodeFence;
      textLines.push(line);
      continue;
    }
    const imageSrc = inCodeFence ? null : figureImageSrc(line);
    if (imageSrc) {
      flushText();
      parts.push({ kind: 'image', src: imageSrc });
    } else {
      textLines.push(line);
    }
  }
  flushText();
  return parts;
}

function renderMarkdown(markdown: string): string {
  return markdownToRich(markdown, 'telegram').trim();
}

function splitLongLine(line: string): string[] {
  const chunks: string[] = [];
  let remaining = line;
  while (remaining) {
    let size = Math.min(remaining.length, TELEGRAM_TEXT_LIMIT);
    let rendered = renderMarkdown(remaining.slice(0, size));
    while (rendered.length > TELEGRAM_TEXT_LIMIT && size > 1) {
      size = Math.max(1, Math.floor(size * 0.75));
      rendered = renderMarkdown(remaining.slice(0, size));
    }
    if (size < remaining.length) {
      const whitespace = remaining.lastIndexOf(' ', size - 1);
      if (whitespace > Math.floor(size / 2)) {
        size = whitespace + 1;
        rendered = renderMarkdown(remaining.slice(0, size));
      }
    }
    if (rendered) chunks.push(rendered);
    remaining = remaining.slice(size);
  }
  return chunks;
}

// Telegram limits one text message to 4096 characters. Keep a reserve for service text and
// split on source lines so markdown is rendered into balanced HTML independently per message.
function renderTextChunks(markdown: string): string[] {
  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    const rendered = renderMarkdown(current);
    current = '';
    if (rendered) chunks.push(rendered);
  };

  for (const line of markdown.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (renderMarkdown(candidate).length <= TELEGRAM_TEXT_LIMIT) {
      current = candidate;
      continue;
    }
    flush();
    const renderedLine = renderMarkdown(line);
    if (renderedLine.length <= TELEGRAM_TEXT_LIMIT) current = line;
    else chunks.push(...splitLongLine(line));
  }
  flush();
  return chunks;
}

export function buildTaskTelegramContent(
  description: string | null,
  attachments: readonly TaskAttachment[],
  resolveAttachmentUrl: (attachmentId: string) => string | null,
): TelegramTaskContentPart[] {
  const parts: TelegramTaskContentPart[] = [];
  const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const inlineAttachmentIds = new Set<string>();

  for (const part of splitDescription(description)) {
    if (part.kind === 'text') {
      for (const html of renderTextChunks(part.markdown)) {
        parts.push({ kind: 'text', html, section: 'description' });
      }
      continue;
    }

    const attachmentId = attachmentIdFromSrc(part.src);
    const attachment = attachmentId ? attachmentsById.get(attachmentId) : undefined;
    if (!attachment) continue;
    const url = resolveAttachmentUrl(attachment.id);
    if (!url) continue;
    inlineAttachmentIds.add(attachment.id);
    parts.push({
      kind: 'attachment',
      attachmentId: attachment.id,
      url,
      filename: attachment.filename,
      mimeType: attachment.mimeType.startsWith('image/') ? attachment.mimeType : 'image/png',
      inline: true,
    });
  }

  const regularAttachments = attachments
    .filter((attachment) => !inlineAttachmentIds.has(attachment.id))
    .map((attachment) => ({ attachment, url: resolveAttachmentUrl(attachment.id) }))
    .filter(
      (item): item is { attachment: TaskAttachment; url: string } => item.url !== null,
    );
  if (regularAttachments.length > 0) {
    parts.push({
      kind: 'text',
      html: '<b>📎 Файлы</b>',
      section: 'attachments_heading',
    });
  }
  for (const { attachment, url } of regularAttachments) {
    parts.push({
      kind: 'attachment',
      attachmentId: attachment.id,
      url,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      inline: false,
    });
  }
  return parts;
}

// Bot API 10.2 can render task screenshots as real media blocks between text paragraphs.
// Return null when the task exceeds Telegram rich-message limits so the caller can use the
// ordered text/photo fallback without losing content.
export function buildTaskTelegramRichContent(
  parts: readonly TelegramTaskContentPart[],
): TelegramTaskRichContent | null {
  const firstAttachmentsPart = parts.findIndex(
    (part) =>
      (part.kind === 'text' && part.section === 'attachments_heading') ||
      (part.kind === 'attachment' && !part.inline),
  );
  const consumedParts = firstAttachmentsPart === -1 ? parts.length : firstAttachmentsPart;
  const descriptionParts = parts.slice(0, consumedParts);
  const inlineMedia = descriptionParts.filter(
    (part): part is Extract<TelegramTaskContentPart, { kind: 'attachment' }> =>
      part.kind === 'attachment' && part.inline,
  );
  if (inlineMedia.length === 0 || inlineMedia.length > TELEGRAM_RICH_MEDIA_LIMIT) return null;

  const media: SendRichMessageMediaInput[] = [];
  const htmlParts = ['<h3>📋 Задача</h3>'];
  for (const part of descriptionParts) {
    if (part.kind === 'text') {
      htmlParts.push(part.html);
      continue;
    }
    const id = `task_photo_${media.length + 1}`;
    media.push({ id, kind: 'photo', url: part.url });
    htmlParts.push(`<img src="tg://photo?id=${id}"/>`);
  }

  const html = htmlParts.join('\n\n');
  if (html.length > TELEGRAM_RICH_TEXT_LIMIT) return null;
  return { html, media, consumedParts };
}
