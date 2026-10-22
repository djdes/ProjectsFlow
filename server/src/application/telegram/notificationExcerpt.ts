import { escapeTelegramHtml, markdownToTelegramHtml } from './telegramMarkdown.js';

// Extract images before clipping: rich editor figures can occur beyond the excerpt.
export function notificationExcerpt(body: string, appUrl: string, limit = 240): string {
  const images = new Set<string>();
  const image = (src: string): string => {
    try {
      const url = new URL(src, appUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') images.add(url.href);
    } catch { /* Invalid image sources must not break notification delivery. */ }
    return '';
  };
  const text = body
    .replace(/<!--[\s\S]*?-->/gu, '')
    .replace(/<img\b[^>]*>/giu, (tag) => {
      const src = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/iu.exec(tag);
      return src ? image((src[1] ?? src[2] ?? '').replace(/&amp;/gu, '&')) : '';
    })
    .replace(/```[\s\S]*?```|`[^`\n]+`|<\/?[a-z][^>]*>/giu, (part) =>
      part.startsWith('`') ? part : '')
    .replace(/!\[[^\]]*\]\(([^)\s]+)\)/gu, (_match, src: string) => image(src))
    .trim();
  const excerpt = text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
  const links = [...images].slice(0, 8).map((url, index) =>
    `<a href="${escapeTelegramHtml(url).replace(/"/gu, '&quot;')}">🖼 Изображение ${index + 1}</a>`);
  return [markdownToTelegramHtml(excerpt), ...links].filter(Boolean).join('\n');
}
