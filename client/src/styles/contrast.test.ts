// WCAG AA for the design tokens (globals.css), both themes: text 4.5:1, large/UI 3:1.
// Translucent tokens (color-mix … transparent) are composited over the surface they sit on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Comments mention token names in prose (`--muted:`) — strip them before reading values.
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf('\n  }', start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

type Rgba = [number, number, number, number];

function oklchToRgb(L: number, C: number, h: number): [number, number, number] {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  // Linear light → gamma-encoded sRGB, the space browsers composite translucent layers in.
  const clamp = (x: number): number => {
    const c = Math.min(1, Math.max(0, x));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return [
    clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

function parseTriple(v: string): [number, number, number] {
  const [L, C, h] = v.replace('%', '').split(/\s+/);
  return [Number(L) / 100, Number(C), h === 'none' ? 0 : Number(h)];
}

/** A token value: a bare OKLCH triple, oklch(…), or color-mix(in oklch, oklch(…) N%, transparent). */
function resolve(tokens: Record<string, string>, name: string): Rgba {
  const v = tokens[name];
  assert.ok(v, `token --${name}`);
  const mix = v.match(/color-mix\(in oklch,\s*oklch\(([^)]+)\)\s*([\d.]+)%,\s*transparent\)/);
  if (mix) return [...oklchToRgb(...parseTriple(mix[1]!)), Number(mix[2]) / 100];
  const fn = v.match(/^oklch\(([^)]+)\)$/);
  return [...oklchToRgb(...parseTriple(fn ? fn[1]! : v)), 1];
}

function over(top: Rgba, base: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + base[0] * (1 - a), top[1] * a + base[1] * (1 - a), top[2] * a + base[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a! + 0.05) / (b! + 0.05);
}

// [text token, surface token (may be translucent), the opaque surface under it, minimum]
const PAIRS: [string, string, string, number][] = [
  ['foreground', 'background', 'background', 4.5],
  ['foreground', 'card', 'card', 4.5],
  ['foreground', 'panel', 'panel', 4.5],
  ['foreground', 'muted', 'muted', 4.5],
  ['muted-foreground', 'background', 'background', 4.5],
  ['muted-foreground', 'card', 'card', 4.5],
  ['muted-foreground', 'panel', 'panel', 4.5],
  ['muted-foreground', 'muted', 'muted', 3],
  ['primary-foreground', 'primary', 'primary', 4.5],
  ['primary-ink', 'background', 'background', 4.5],
  ['primary-ink', 'primary-soft', 'card', 4.5],
  ['destructive', 'background', 'background', 4.5],
  ['destructive', 'destructive-soft', 'card', 4.5],
  ['destructive-foreground', 'destructive', 'destructive', 4.5],
  ['done-ink', 'done-soft', 'card', 4.5],
  ['approval-ink', 'approval-soft', 'card', 4.5],
  ['manual-ink', 'manual-soft', 'card', 4.5],
  ['today', 'background', 'background', 3],
  ['toast-foreground', 'toast', 'toast', 4.5],
  ['foreground', 'message-bubble', 'message-bubble', 4.5],
];

for (const [theme, selector] of [['светлая', ':root'], ['тёмная', '.dark']] as const) {
  const tokens = { ...block(':root'), ...(selector === '.dark' ? block('.dark') : {}) };
  for (const [text, surface, base, min] of PAIRS) {
    test(`${theme}: --${text} на --${surface} ≥ ${min}:1`, () => {
      const bg = over(resolve(tokens, surface), resolve(tokens, base));
      const fg = over(resolve(tokens, text), bg);
      const r = ratio(fg, bg);
      assert.ok(r >= min, `${r.toFixed(2)}:1`);
    });
  }
}
