// Markdown → email HTML/plain text for marketing letters. A deliberately small subset of
// what the app editor produces (headings, paragraphs, lists, quotes, rules, code, bold,
// italic, strike, links, images) with inline styles: mail clients ignore stylesheets.
//
// Variables ({{name}}, {{workspace}}, with an optional inline fallback {{name|коллега}})
// are swapped for private-use placeholders BEFORE parsing and filled in at the very end,
// escaped. A recipient's name therefore can never inject markup, a link or bold text.

// name/workspace come from the recipient; offer/deadline from the template's promo terms.
export type MailingVariables = {
  readonly name: string;
  readonly workspace: string;
  readonly offer?: string;
  readonly deadline?: string;
};
export type MailingVariableKey = keyof MailingVariables;

export const MAILING_VARIABLES: ReadonlyArray<{ readonly key: MailingVariableKey; readonly fallback: string }> = [
  { key: 'name', fallback: 'коллега' },
  { key: 'workspace', fallback: 'ProjectsFlow' },
  { key: 'offer', fallback: 'подарок' },
  { key: 'deadline', fallback: 'в ближайшие дни' },
];

/** Colours and type of the rendered body; promo layouts pass their own. */
export type MailingBodyTheme = {
  readonly text: string;
  readonly heading: string;
  readonly link: string;
  readonly quote: string;
  readonly quoteBorder: string;
  readonly rule: string;
  readonly codeBg: string;
  readonly font?: string;
  readonly headingFont?: string;
  readonly headingWeight?: number;
  readonly headingStyle?: 'normal' | 'italic';
  readonly headingTransform?: 'uppercase';
  readonly headingSpacing?: string;
  readonly h1Size?: number;
};

export const DEFAULT_MAILING_BODY_THEME: MailingBodyTheme = {
  text: '#334155', heading: '#0f172a', link: '#2563eb', quote: '#475569', quoteBorder: '#cbd5e1', rule: '#e2e8f0', codeBg: '#f1f5f9',
};

const VARIABLE_RE = /\{\{\s*([a-z_]+)\s*(?:\|([^{}\n]*))?\}\}/giu;
// Private-use code points never typed by people; stripped from input before parsing.
const PUA_RE = /[-]/gu;
const VAR_OPEN = '';
const VAR_CLOSE = '';
const STASH_OPEN = '';
const STASH_CLOSE = '';

export function escapeMailingHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isKnownVariable(key: string): key is MailingVariableKey {
  return MAILING_VARIABLES.some((v) => v.key === key);
}

function resolveVariable(key: MailingVariableKey, inlineFallback: string | undefined, vars: MailingVariables): string {
  const value = (vars[key] ?? '').trim();
  if (value) return value;
  const fallback = inlineFallback?.trim();
  if (fallback) return fallback;
  return MAILING_VARIABLES.find((v) => v.key === key)!.fallback;
}

/** Plain-text substitution for the subject, the preheader and similar one-liners. */
export function fillMailingVariables(text: string, vars: MailingVariables): string {
  return text.replace(VARIABLE_RE, (whole, key: string, fallback: string | undefined) => {
    const k = key.toLowerCase();
    return isKnownVariable(k) ? resolveVariable(k, fallback, vars) : whole;
  });
}

/** Variables the renderer does not know; the editor warns about them before saving. */
export function findUnknownMailingVariables(text: string): string[] {
  const unknown = new Set<string>();
  for (const m of text.matchAll(VARIABLE_RE)) {
    const key = m[1]!.toLowerCase();
    if (!isKnownVariable(key)) unknown.add(key);
  }
  return [...unknown];
}

type Block =
  | { readonly type: 'p'; readonly lines: string[] }
  | { readonly type: 'h'; readonly level: 1 | 2 | 3; readonly text: string }
  | { readonly type: 'ul' | 'ol'; readonly items: string[] }
  | { readonly type: 'quote'; readonly lines: string[] }
  | { readonly type: 'hr' }
  | { readonly type: 'code'; readonly text: string };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let current = null as Block | null;
  const flush = (): void => {
    if (current) blocks.push(current);
    current = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) code.push(lines[i]!);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (/^\s*$/.test(line)) { flush(); continue; }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: 'h', level: Math.min(heading[1]!.length, 3) as 1 | 2 | 3, text: heading[2]! });
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); blocks.push({ type: 'hr' }); continue; }
    const quote = /^\s{0,3}>\s?(.*)$/.exec(line);
    if (quote) {
      if (current?.type !== 'quote') { flush(); current = { type: 'quote', lines: [] }; }
      current.lines.push(quote[1]!);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = bullet ? null : /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const type = bullet ? 'ul' : 'ol';
      if (current?.type !== type) { flush(); current = { type, items: [] }; }
      // Task-list items keep their state as a glyph; mail has no checkboxes.
      const item = (bullet ?? ordered)![1]!.replace(/^\[( |x|X)\]\s+/, (_m, mark: string) => (mark === ' ' ? '☐ ' : '☑ '));
      current.items.push(item);
      continue;
    }
    if ((current?.type === 'ul' || current?.type === 'ol') && /^\s{2,}\S/.test(line)) {
      const items = current.items;
      items[items.length - 1] = `${items[items.length - 1]!} ${line.trim()}`;
      continue;
    }
    if (current?.type !== 'p') { flush(); current = { type: 'p', lines: [] }; }
    // A trailing backslash or two spaces is a markdown hard break; every newline breaks anyway.
    current.lines.push(line.replace(/(\\|\s{2,})$/, ''));
  }
  flush();
  return blocks;
}

const LINK_RE = /\[([^\]\n]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const IMAGE_RE = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const AUTOLINK_RE = /\bhttps?:\/\/[^\s<>()-]+[^\s<>().,;:!?"'-]/g;
const ESCAPE_RE = /\\([\\`*_{}[\]()#+\-.!~<>|="])/g;
// The editor stores text/background colour as inline HTML; only these spans survive.
const SPAN_RE = /<span style="([^"<>]{1,120})">([\s\S]*?)<\/span>/g;
const COLOR_DECL_RE = /^(color|background-color)\s*:\s*(#[0-9a-f]{3,8}|rgba?\(\s*[\d.\s,%]+\))$/i;

function safeSpanStyle(style: string): string | null {
  const decls = style.split(';').map((d) => d.trim()).filter(Boolean);
  if (decls.length === 0 || !decls.every((d) => COLOR_DECL_RE.test(d))) return null;
  return decls.join(';');
}

function isSafeUrl(url: string): boolean {
  // A URL assembled from a variable is not a link: the value is the recipient's own text.
  return /^(https?:\/\/|mailto:)/i.test(url) && !url.includes(VAR_OPEN);
}

const linkStyle = (t: MailingBodyTheme): string => `color:${t.link};text-decoration:underline;`;

function renderInline(src: string, t: MailingBodyTheme, allowLinks = true): string {
  const stash: string[] = [];
  const put = (html: string): string => `${STASH_OPEN}${stash.push(html) - 1}${STASH_CLOSE}`;
  let s = src.replace(ESCAPE_RE, (_m, ch: string) => put(escapeMailingHtml(ch)));
  s = s.replace(SPAN_RE, (whole, style: string, inner: string) => {
    const safe = safeSpanStyle(style);
    return safe ? `${put(`<span style="${escapeMailingHtml(safe)}">`)}${inner}${put('</span>')}` : inner;
  });
  s = s.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    put(`<code style="font-family:SFMono-Regular,Consolas,monospace;font-size:13px;background:${t.codeBg};border-radius:4px;padding:1px 4px;">${escapeMailingHtml(code)}</code>`));
  s = s.replace(IMAGE_RE, (whole, alt: string, url: string) =>
    /^https:\/\//i.test(url) && !url.includes(VAR_OPEN)
      ? put(`<img src="${escapeMailingHtml(url)}" alt="${escapeMailingHtml(alt)}" style="display:block;max-width:100%;height:auto;border:0;border-radius:8px;margin:8px 0;">`)
      : put(escapeMailingHtml(alt || whole)));
  if (allowLinks) {
    s = s.replace(LINK_RE, (_m, text: string, url: string) => {
      const inner = renderInline(text, t, false);
      return isSafeUrl(url) ? put(`<a href="${escapeMailingHtml(url)}" style="${linkStyle(t)}">${inner}</a>`) : put(inner);
    });
    s = s.replace(AUTOLINK_RE, (url: string) => put(`<a href="${escapeMailingHtml(url)}" style="${linkStyle(t)}word-break:break-all;">${escapeMailingHtml(url)}</a>`));
  }
  s = escapeMailingHtml(s)
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+?)~~/g, '<s>$1</s>')
    .replace(/\+\+([^+\n]+?)\+\+/g, '<u>$1</u>')
    .replace(/==([^=\n]+?)==/g, '<mark style="background:#fef3c7;color:inherit;">$1</mark>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/gu, '$1<em>$2</em>');
  // Stash entries may contain stashes of their own (link text): unstash until stable.
  const unstash = new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}`, 'g');
  while (unstash.test(s)) s = s.replace(unstash, (_m, n: string) => stash[Number(n)] ?? '');
  return s;
}

function inlineText(src: string): string {
  return src
    .replace(ESCAPE_RE, '$1')
    .replace(SPAN_RE, (_m, _style: string, inner: string) => inner)
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(IMAGE_RE, (_m, alt: string) => alt)
    .replace(LINK_RE, (_m, text: string, url: string) => (isSafeUrl(url) && text !== url ? `${text} (${url})` : text))
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/__([^_\n]+?)__/g, '$1')
    .replace(/~~([^~\n]+?)~~/g, '$1')
    .replace(/\+\+([^+\n]+?)\+\+/g, '$1')
    .replace(/==([^=\n]+?)==/g, '$1')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?!\*)/g, '$1$2')
    .replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/gu, '$1$2');
}

// The default theme yields exactly the classic styles; extras are appended only when set.
function blockStyles(t: MailingBodyTheme): { p: string; h: Record<1 | 2 | 3, string>; list: string; quote: string; hr: string; pre: string } {
  const font = t.font ? `font-family:${t.font};` : '';
  const hx = (weight: number): string => `font-weight:${t.headingWeight ?? weight};color:${t.heading};`
    + (t.headingFont ? `font-family:${t.headingFont};` : '')
    + (t.headingStyle ? `font-style:${t.headingStyle};` : '')
    + (t.headingTransform ? `text-transform:${t.headingTransform};` : '')
    + (t.headingSpacing ? `letter-spacing:${t.headingSpacing};` : '');
  return {
    p: `margin:0 0 14px;font-size:15px;line-height:1.6;color:${t.text};${font}`,
    h: {
      1: `margin:0 0 14px;font-size:${t.h1Size ?? 22}px;line-height:${t.h1Size ? 1.12 : 1.3};${hx(700)}`,
      2: `margin:20px 0 10px;font-size:18px;line-height:1.35;${hx(700)}`,
      3: `margin:16px 0 8px;font-size:16px;line-height:1.4;${hx(600)}`,
    },
    list: `margin:0 0 14px;padding:0 0 0 22px;font-size:15px;line-height:1.6;color:${t.text};${font}`,
    quote: `margin:0 0 14px;padding:4px 0 4px 14px;border-left:3px solid ${t.quoteBorder};font-size:15px;line-height:1.6;color:${t.quote};${font}`,
    hr: `border:0;border-top:1px solid ${t.rule};margin:20px 0;`,
    pre: `margin:0 0 14px;padding:12px;background:${t.codeBg};border-radius:8px;font-family:SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.5;color:${t.heading};white-space:pre-wrap;word-break:break-word;`,
  };
}

export type RenderedMailingBody = { readonly html: string; readonly text: string };

export function renderMailingBody(markdown: string, vars: MailingVariables, theme: MailingBodyTheme = DEFAULT_MAILING_BODY_THEME): RenderedMailingBody {
  const st = blockStyles(theme);
  const values: string[] = [];
  const source = markdown.replace(PUA_RE, '').replace(VARIABLE_RE, (whole, key: string, fallback: string | undefined) => {
    const k = key.toLowerCase();
    if (!isKnownVariable(k)) return whole;
    return `${VAR_OPEN}${values.push(resolveVariable(k, fallback, vars)) - 1}${VAR_CLOSE}`;
  });
  const blocks = parseBlocks(source);
  const html = blocks.map((b): string => {
    switch (b.type) {
      case 'p': return `<p style="${st.p}">${b.lines.map((l) => renderInline(l, theme)).join('<br>')}</p>`;
      case 'h': return `<h${b.level} class="pf-h${b.level}" style="${st.h[b.level]}">${renderInline(b.text, theme)}</h${b.level}>`;
      case 'ul':
      case 'ol':
        return `<${b.type} style="${st.list}">` +
          b.items.map((item) => `<li style="margin:0 0 6px;">${renderInline(item, theme)}</li>`).join('') + `</${b.type}>`;
      case 'quote':
        return `<blockquote style="${st.quote}">${b.lines.map((l) => renderInline(l, theme)).join('<br>')}</blockquote>`;
      case 'hr': return `<hr style="${st.hr}">`;
      case 'code':
        return `<pre style="${st.pre}">${escapeMailingHtml(b.text)}</pre>`;
    }
  }).join('\n');
  const text = blocks.map((b): string => {
    switch (b.type) {
      case 'p': return b.lines.map(inlineText).join('\n');
      case 'h': return inlineText(b.text);
      case 'ul': return b.items.map((item) => `• ${inlineText(item)}`).join('\n');
      case 'ol': return b.items.map((item, i) => `${i + 1}. ${inlineText(item)}`).join('\n');
      case 'quote': return b.lines.map((l) => `> ${inlineText(l)}`).join('\n');
      case 'hr': return '———';
      case 'code': return b.text;
    }
  }).join('\n\n');
  const fill = (s: string, escape: boolean): string =>
    s.replace(new RegExp(`${VAR_OPEN}(\\d+)${VAR_CLOSE}`, 'g'), (_m, n: string) => {
      const value = values[Number(n)] ?? '';
      return escape ? escapeMailingHtml(value) : value;
    });
  return { html: fill(html, true), text: fill(text, false) };
}
