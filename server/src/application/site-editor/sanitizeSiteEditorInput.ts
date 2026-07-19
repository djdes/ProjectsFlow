import type {
  ProjectEditOperation,
  SiteElementLocator,
  SitePatchKind,
} from '../../domain/site-editor/SiteEditor.js';
import { SiteEditorValidationError } from '../../domain/site-editor/errors.js';

const STYLE_PROPERTIES = new Set([
  'color', 'background', 'backgroundColor', 'border', 'borderColor', 'borderRadius', 'borderWidth', 'borderStyle',
  'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'fontSize', 'fontWeight', 'fontFamily', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textDecoration', 'textTransform', 'whiteSpace', 'wordBreak',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'display',
  'visibility', 'opacity', 'boxShadow', 'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  'overflow', 'overflowX', 'overflowY', 'flex', 'justifyContent', 'justifyItems', 'justifySelf',
  'alignItems', 'alignContent', 'alignSelf', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink',
  'flexBasis', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'rowGap', 'columnGap',
  'objectFit', 'objectPosition', 'aspectRatio', 'transform', 'transformOrigin', 'cursor',
]);
const SAFE_ATTRIBUTES = new Set(['title', 'alt', 'aria-label', 'href', 'target', 'rel', 'class']);
const DANGEROUS_VALUE = /(?:javascript\s*:|expression\s*\(|url\s*\(|@import|[{};]|<\/?script)/i;
const SECRET_PAIR = /\b(password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization)\b\s*[:=]\s*([^\s"'<>]+)/gi;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}/gi;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /(?<!\d)(?:\+?\d[\d\s().-]{8,}\d)(?!\d)/g;

function isSafeHref(value: string): boolean {
  if ([...value].some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  })) return false;
  if (value.startsWith('//')) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme);
}

export function normalizeSiteRoute(raw: string): string {
  const route = raw.trim();
  if (!route.startsWith('/') || route.length > 500 || route.includes('..') || /[\0\r\n]/.test(route)) {
    throw new SiteEditorValidationError('Invalid site route');
  }
  const withoutFragment = route.split('#', 1)[0] ?? '/';
  return withoutFragment.split('?', 1)[0] || '/';
}

export function sanitizeLocator(raw: SiteElementLocator): SiteElementLocator {
  const cssPath = raw.cssPath.trim();
  const tagName = raw.tagName.trim().toLowerCase();
  if (!cssPath || cssPath.length > 1000 || DANGEROUS_VALUE.test(cssPath)) {
    throw new SiteEditorValidationError('Invalid element selector');
  }
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(tagName) || tagName === 'script') {
    throw new SiteEditorValidationError('Invalid element tag');
  }
  const entries = Object.entries(raw.stableAttributes ?? {});
  if (entries.length > 20) throw new SiteEditorValidationError('Too many locator attributes');
  const stableAttributes: Record<string, string> = {};
  for (const [name, value] of entries) {
    const key = name.trim().toLowerCase();
    if (!/^[a-z_:][a-z0-9:_.-]{0,63}$/.test(key) || key.startsWith('on') || key === 'srcdoc') {
      throw new SiteEditorValidationError('Unsafe locator attribute');
    }
    if (value.length > 200 || /[\0\r\n]/.test(value)) {
      throw new SiteEditorValidationError('Invalid locator attribute value');
    }
    stableAttributes[key] = redactSensitiveText(value).slice(0, 200);
  }
  return {
    cssPath,
    tagName,
    stableAttributes,
    ...(raw.textFingerprint ? { textFingerprint: redactSensitiveText(raw.textFingerprint).slice(0, 512) } : {}),
    ...(raw.ancestorFingerprint
      ? { ancestorFingerprint: redactSensitiveText(raw.ancestorFingerprint).slice(0, 512) }
      : {}),
  };
}

export function sanitizePatchPayload(
  kind: SitePatchKind,
  raw: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (kind === 'text') {
    const text = raw['text'];
    if (typeof text !== 'string' || text.length > 50_000 || /<\/?script/i.test(text)) {
      throw new SiteEditorValidationError('Invalid text patch');
    }
    return { text };
  }
  if (kind === 'html') {
    const html = raw['html'];
    if (typeof html !== 'string' || html.length > 50_000 || !html.trim()) {
      throw new SiteEditorValidationError('Invalid html patch');
    }
    if (/<(?:script|style|iframe|object|embed|link|meta|base|form)\b/i.test(html)
      || /\son[a-z]+\s*=|(?:javascript|vbscript)\s*:|srcdoc\s*=/i.test(html)) {
      throw new SiteEditorValidationError('Unsafe html patch');
    }
    return { html };
  }
  if (kind === 'visibility') {
    if (typeof raw['hidden'] !== 'boolean') throw new SiteEditorValidationError('Invalid visibility patch');
    return { hidden: raw['hidden'] };
  }
  if (kind === 'command') {
    const command = raw['command'];
    if (!['duplicate', 'delete', 'toggle-visibility', 'layout'].includes(String(command))) {
      throw new SiteEditorValidationError('Invalid command patch');
    }
    return { command };
  }
  if (kind === 'attribute') {
    const name = typeof raw['name'] === 'string' ? raw['name'].trim().toLowerCase() : '';
    const value = raw['value'] === null ? null : typeof raw['value'] === 'string' ? raw['value'].trim() : '';
    if (!SAFE_ATTRIBUTES.has(name) || name.startsWith('on') || (value?.length ?? 0) > 2000) {
      throw new SiteEditorValidationError('Unsafe attribute patch');
    }
    if (value !== null && ((name === 'href' && !isSafeHref(value)) || DANGEROUS_VALUE.test(value))) {
      throw new SiteEditorValidationError('Unsafe attribute value');
    }
    return { name, value };
  }
  const styles = raw['styles'];
  if (!styles || typeof styles !== 'object' || Array.isArray(styles)) {
    throw new SiteEditorValidationError('Style patch must contain styles');
  }
  const entries = Object.entries(styles as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 32) throw new SiteEditorValidationError('Invalid style count');
  const safe: Record<string, string> = {};
  for (const [property, value] of entries) {
    if (!STYLE_PROPERTIES.has(property) || typeof value !== 'string' || value.length > 200) {
      throw new SiteEditorValidationError('Unsafe style property');
    }
    if (DANGEROUS_VALUE.test(value)) throw new SiteEditorValidationError('Unsafe style value');
    safe[property] = value.trim();
  }
  return { styles: safe };
}

export function sanitizeComputedStyles(raw: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const entries = Object.entries(raw);
  if (entries.length > 50) throw new SiteEditorValidationError('Too many computed styles');
  const safe: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!STYLE_PROPERTIES.has(name) || value.length > 500 || DANGEROUS_VALUE.test(value)) continue;
    safe[name] = value;
  }
  return safe;
}

export function redactDomSnapshot(raw: string): string {
  let value = raw.slice(0, 50_000)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<!-- script redacted -->')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<!-- style redacted -->')
    .replace(/(<(?:input|option)\b[^>]*\bvalue\s*=\s*)(["']).*?\2/gi, '$1$2[redacted]$2')
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, '$1[redacted]$2')
    .replace(/\s(?:on[a-z]+|srcdoc)\s*=\s*(["']).*?\1/gi, '');
  value = redactSensitiveText(value);
  return value.slice(0, 50_000);
}

export function redactSensitiveText(raw: string): string {
  return raw
    .replace(BEARER, 'Bearer [redacted]')
    .replace(SECRET_PAIR, '$1=[redacted]')
    .replace(EMAIL, '[redacted-email]')
    .replace(PHONE, '[redacted-phone]');
}

export function assertProjectEditOperation(value: string): ProjectEditOperation {
  const allowed: ProjectEditOperation[] = [
    'rewrite_text', 'restyle', 'regenerate_element', 'regenerate_section', 'replace_icon', 'edit_code',
  ];
  if (!allowed.includes(value as ProjectEditOperation)) {
    throw new SiteEditorValidationError('Unsupported edit operation');
  }
  return value as ProjectEditOperation;
}
