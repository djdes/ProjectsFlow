import type { TaskAttachment } from '../../domain/task/TaskAttachment.js';
import { escapeHtml, figureImageSrc, markdownToRich } from '../../domain/task/digestFormat.js';
import { attachmentIdFromSrc } from '../attachments/signedAttachmentUrl.js';
import type { SendRichMessageMediaInput } from './TelegramClient.js';

const TELEGRAM_TEXT_LIMIT = 3_200;
const TELEGRAM_SINGLE_MESSAGE_RAW_LIMIT = 3_900;
const TELEGRAM_RICH_TEXT_LIMIT = 32_768;
const TELEGRAM_RICH_MEDIA_LIMIT = 50;
const TELEGRAM_RICH_BLOCK_LIMIT = 500;
const TELEGRAM_PHOTO_UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;
const TELEGRAM_OTHER_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;
// Multipart FormData duplicates buffers internally. Keep one task safely below the Node heap
// even though Telegram's per-message media counter would allow a much larger aggregate payload.
const TELEGRAM_RICH_TOTAL_UPLOAD_LIMIT_BYTES = 50 * 1024 * 1024;

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
      readonly sizeBytes: number;
      readonly inline: boolean;
    };

export type TelegramTaskRichContent = {
  readonly html: string;
  readonly media: readonly TelegramTaskRichMedia[];
  readonly consumedParts: number;
};

type TelegramTaskRichMedia = SendRichMessageMediaInput & {
  readonly attachmentId: string;
  readonly filename: string;
  readonly mimeType: string;
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
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      inline: true,
    });
  }

  const regularAttachmentIds = new Set<string>();
  const regularAttachments = attachments
    .filter((attachment) => {
      if (inlineAttachmentIds.has(attachment.id) || regularAttachmentIds.has(attachment.id)) {
        return false;
      }
      regularAttachmentIds.add(attachment.id);
      return true;
    })
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
      sizeBytes: attachment.sizeBytes,
      inline: false,
    });
  }
  return parts;
}

// Bot API 10.2 can render photos, videos, animations, audio and voice notes inside one rich
// message. It deliberately doesn't accept InputMediaDocument, so general files are kept in the
// same message as download links instead of being emitted as additional Telegram messages.
// Return null only when the whole task can't fit Telegram's rich-message text/block limits.
export function buildTaskTelegramRichContent(
  parts: readonly TelegramTaskContentPart[],
  footerHtml?: string,
): TelegramTaskRichContent | null {
  const media: TelegramTaskRichMedia[] = [];
  const mediaByAttachmentId = new Map<string, TelegramTaskRichMedia>();
  const htmlParts = ['<h3>📋 Задача</h3>'];
  let blockCount = 1;
  let uploadBytes = 0;
  for (const part of parts) {
    if (part.kind === 'text') {
      const html = toRichHtmlBlocks(part.html);
      htmlParts.push(html);
      blockCount += countRichBlocks(html);
      continue;
    }

    const kind = richMediaKind(part);
    const declaredMedia = mediaByAttachmentId.get(part.attachmentId);
    if (kind && declaredMedia) {
      htmlParts.push(renderRichMediaBlock(part, declaredMedia.kind, declaredMedia.id));
      blockCount += 1;
      continue;
    }
    if (
      !kind ||
      media.length >= TELEGRAM_RICH_MEDIA_LIMIT ||
      uploadBytes + part.sizeBytes > TELEGRAM_RICH_TOTAL_UPLOAD_LIMIT_BYTES
    ) {
      htmlParts.push(renderAttachmentLink(part));
      blockCount += 1;
      continue;
    }

    const id = `task_${kind}_${media.length + 1}`;
    const declared: TelegramTaskRichMedia = {
      id,
      kind,
      url: part.url,
      attachmentId: part.attachmentId,
      filename: part.filename,
      mimeType: part.mimeType,
    };
    media.push(declared);
    mediaByAttachmentId.set(part.attachmentId, declared);
    uploadBytes += part.sizeBytes;
    htmlParts.push(renderRichMediaBlock(part, kind, id));
    blockCount += 1;
  }

  if (footerHtml) {
    htmlParts.push(footerHtml);
    blockCount += countRichBlocks(footerHtml);
  }

  const html = htmlParts.join('\n\n');
  if (
    countRichTextCharacters(html) > TELEGRAM_RICH_TEXT_LIMIT ||
    blockCount > TELEGRAM_RICH_BLOCK_LIMIT
  ) {
    const truncatedHtml = [
      '<h3>📋 Задача</h3>',
      '<p>Содержимое задачи не поместилось в лимиты Telegram. Полная версия доступна в ProjectsFlow.</p>',
      footerHtml ?? '',
    ].filter(Boolean).join('\n\n');
    return { html: truncatedHtml, media: [], consumedParts: parts.length };
  }
  return { html, media, consumedParts: parts.length };
}

// A relay or an older Telegram deployment can reject sendRichMessage. Keep that exceptional
// path one-task/one-message too: supported formatting is preserved where it fits, every possible
// attachment is represented by a link, and the permanent task link is always retained.
export function buildTaskTelegramFallbackContent(
  parts: readonly TelegramTaskContentPart[],
  taskUrl: string,
): string {
  const header = '📋 <b>Задача</b>';
  const footer =
    `<a href="${escapeHtml(taskUrl)}">Открыть в ProjectsFlow</a>\n\n` +
    `↩️ Ответь reply'ем на это сообщение, чтобы добавить комментарий.`;
  const uniqueAttachments = new Map<string, Extract<TelegramTaskContentPart, { kind: 'attachment' }>>();
  for (const part of parts) {
    if (part.kind === 'attachment' && !uniqueAttachments.has(part.attachmentId)) {
      uniqueAttachments.set(part.attachmentId, part);
    }
  }

  const selectedFileLines: string[] = [];
  let omittedFiles = false;
  for (const part of uniqueAttachments.values()) {
    const line = `📎 <a href="${escapeHtml(part.url)}">${escapeHtml(part.filename)}</a>`;
    const candidateFiles = ['<b>📎 Файлы</b>', ...selectedFileLines, line].join('\n');
    const candidate = [header, candidateFiles, footer].join('\n\n');
    if (candidate.length <= TELEGRAM_SINGLE_MESSAGE_RAW_LIMIT) selectedFileLines.push(line);
    else omittedFiles = true;
  }

  const fileSection = selectedFileLines.length > 0
    ? ['<b>📎 Файлы</b>', ...selectedFileLines].join('\n')
    : '';
  const omission = omittedFiles ? '… Остальные файлы доступны в ProjectsFlow.' : '';
  const selectedDescription: string[] = [];
  let omittedDescription = false;
  for (const part of parts) {
    if (part.kind !== 'text' || part.section !== 'description') continue;
    const candidate = [
      header,
      ...selectedDescription,
      part.html,
      fileSection,
      omission,
      footer,
    ].filter(Boolean).join('\n\n');
    if (candidate.length <= TELEGRAM_SINGLE_MESSAGE_RAW_LIMIT) selectedDescription.push(part.html);
    else omittedDescription = true;
  }

  return [
    header,
    ...selectedDescription,
    omittedDescription ? '… Полное описание доступно в ProjectsFlow.' : '',
    fileSection,
    omission,
    footer,
  ].filter(Boolean).join('\n\n');
}

function richMediaKind(
  part: Extract<TelegramTaskContentPart, { kind: 'attachment' }>,
): SendRichMessageMediaInput['kind'] | null {
  const mimeType = part.mimeType.toLowerCase();
  const filename = part.filename.toLowerCase();
  const isTelegramPhoto =
    ['image/jpeg', 'image/png'].includes(mimeType) ||
    /\.(?:jpe?g|png)$/.test(filename);

  if (part.inline) {
    return isTelegramPhoto && part.sizeBytes <= TELEGRAM_PHOTO_UPLOAD_LIMIT_BYTES
      ? 'photo'
      : null;
  }
  if (mimeType === 'image/gif' || filename.endsWith('.gif')) {
    return part.sizeBytes <= TELEGRAM_OTHER_UPLOAD_LIMIT_BYTES ? 'animation' : null;
  }
  if (isTelegramPhoto) {
    return part.sizeBytes <= TELEGRAM_PHOTO_UPLOAD_LIMIT_BYTES ? 'photo' : null;
  }
  if (mimeType === 'video/mp4' || filename.endsWith('.mp4')) {
    return part.sizeBytes <= TELEGRAM_OTHER_UPLOAD_LIMIT_BYTES ? 'video' : null;
  }
  if (
    ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a'].includes(mimeType) ||
    /\.(?:mp3|m4a)$/.test(filename)
  ) {
    return part.sizeBytes <= TELEGRAM_OTHER_UPLOAD_LIMIT_BYTES ? 'audio' : null;
  }
  return null;
}

function renderRichMediaBlock(
  part: Extract<TelegramTaskContentPart, { kind: 'attachment' }>,
  kind: SendRichMessageMediaInput['kind'],
  id: string,
): string {
  const tag = kind === 'photo'
    ? `<img src="tg://photo?id=${id}"/>`
    : kind === 'video' || kind === 'animation'
      ? `<video src="tg://video?id=${id}"></video>`
      : `<audio src="tg://audio?id=${id}"></audio>`;
  if (part.inline) return tag;
  return `<figure>${tag}<figcaption>${escapeHtml(part.filename)}</figcaption></figure>`;
}

function renderAttachmentLink(
  part: Extract<TelegramTaskContentPart, { kind: 'attachment' }>,
): string {
  const icon = part.inline ? '🖼' : '📎';
  return `<p>${icon} <a href="${escapeHtml(part.url)}">${escapeHtml(part.filename)}</a></p>`;
}

function countRichBlocks(html: string): number {
  return html.match(/<(?:h[1-6]|p|pre|footer|blockquote|aside|figure|img|video|audio)\b/g)?.length ?? 0;
}

function countRichTextCharacters(html: string): number {
  const text = html
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:#\d+|#x[\da-f]+|lt|gt|amp|quot|apos|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo);/gi, 'x');
  return [...text].length;
}

function toRichHtmlBlocks(html: string): string {
  const blocks: string[] = [];
  const blockTag = /(<pre>[\s\S]*?<\/pre>|<blockquote>[\s\S]*?<\/blockquote>)/g;
  let offset = 0;
  for (const match of html.matchAll(blockTag)) {
    const index = match.index ?? 0;
    appendParagraphBlocks(blocks, html.slice(offset, index));
    blocks.push(match[0]);
    offset = index + match[0].length;
  }
  appendParagraphBlocks(blocks, html.slice(offset));
  return blocks.join('\n');
}

function appendParagraphBlocks(target: string[], html: string): void {
  for (const line of html.split('\n')) {
    const trimmed = line.trim();
    if (trimmed) target.push(`<p>${trimmed}</p>`);
  }
}
