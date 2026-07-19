import type { SiteEditorSnapshot } from '@/application/site-editor/SiteEditorRepository';

export const ALLOWED_STYLE_PROPERTIES = new Set([
  'color', 'background', 'backgroundColor', 'border', 'borderColor', 'borderWidth', 'borderStyle', 'borderRadius',
  'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap',
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing',
  'textAlign', 'textDecoration', 'textTransform', 'whiteSpace', 'wordBreak',
  'width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight',
  'display', 'visibility', 'opacity', 'boxShadow', 'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  'overflow', 'overflowX', 'overflowY', 'flex', 'flexDirection', 'flexWrap', 'flexGrow', 'flexShrink',
  'flexBasis', 'alignItems', 'alignContent', 'alignSelf', 'justifyContent', 'justifyItems', 'justifySelf',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'rowGap', 'columnGap',
  'objectFit', 'objectPosition', 'aspectRatio', 'transform', 'transformOrigin', 'cursor',
]);

const SAFE_VALUE = /^[#(),.%\-\w\s/'":]+$/u;

export function sanitizeStylePatch(property: string, value: string): { property: string; value: string } | null {
  const trimmed = value.trim().slice(0, 160);
  if (!ALLOWED_STYLE_PROPERTIES.has(property) || !trimmed || !SAFE_VALUE.test(trimmed) || /url\s*\(|expression|javascript:/iu.test(trimmed)) return null;
  return { property, value: trimmed };
}

export function sanitizeAttribute(name: string, value: string): { name: string; value: string } | null {
  if (!['href', 'title', 'aria-label', 'alt', 'target', 'rel', 'class'].includes(name)) return null;
  const trimmed = value.trim().slice(0, 500);
  if ([...trimmed].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  if (name === 'href') {
    if (/^(?:javascript|data|vbscript):/iu.test(trimmed) || trimmed.startsWith('//')) return null;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed) && !/^(?:https?|mailto|tel):/iu.test(trimmed)) return null;
  }
  return { name, value: trimmed };
}

export function capSnapshot(snapshot: SiteEditorSnapshot): SiteEditorSnapshot {
  const attributes = Object.fromEntries(Object.entries(snapshot.locator.attributes ?? {}).slice(0, 24).map(([key, value]) => [key.slice(0, 80), value.slice(0, 240)]));
  const styles = Object.fromEntries(Object.entries(snapshot.styles ?? {}).filter(([key]) => ALLOWED_STYLE_PROPERTIES.has(key)).slice(0, 40).map(([key, value]) => [key, value.slice(0, 160)]));
  return {
    locator: { ...snapshot.locator, selector: snapshot.locator.selector.slice(0, 500), tagName: snapshot.locator.tagName.slice(0, 40), text: snapshot.locator.text?.slice(0, 1_000), attributes },
    source: snapshot.source?.slice(0, 8_000),
    styles,
  };
}

export function sanitizePrompt(prompt: string): string {
  const withoutControls = [...prompt]
    .map((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : char;
    })
    .join('');
  return withoutControls.replace(/\s+/gu, ' ').trim().slice(0, 2_000);
}

export function sanitizeSourceMarkup(source: string): string | null {
  const value = source.trim().slice(0, 50_000);
  if (!value || /<(?:script|style|iframe|object|embed|link|meta|base|form)\b/iu.test(value)) return null;
  if (/\son[a-z]+\s*=|(?:javascript|vbscript)\s*:|srcdoc\s*=/iu.test(value)) return null;
  return value;
}
