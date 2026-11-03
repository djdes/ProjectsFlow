import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MAILING_STARTERS } from '../../domain/mailing/starters.js';
import { MAILING_LAYOUTS } from '../../domain/mailing/layouts.js';
import { MailingError } from '../../domain/mailing/errors.js';
import { renderMailingEmail, renderMailingPreheader } from './mailingEmail.js';
import { parseMailingContent } from './MailingService.js';
import { PROMO_THEMES, type PromoLayout } from './promoLayouts.js';

const UNSUB = 'https://projectsflow.ru/api/mailing/unsubscribe/token.sig';
const vars = { name: 'Анна', workspace: 'Студия Север' };
const PROMO = MAILING_LAYOUTS.filter((l): l is PromoLayout => l !== 'standard');

const render = (content: Parameters<typeof renderMailingEmail>[0]['content'], v = vars) =>
  renderMailingEmail({ to: 'anna@example.com', content, vars: v, unsubscribeUrl: UNSUB, assetBaseUrl: 'https://projectsflow.ru/' });

test('every promo layout has a starter, and each starter renders a complete live-text letter', () => {
  for (const layout of PROMO) {
    const starter = MAILING_STARTERS.find((s) => s.layout === layout);
    assert.ok(starter, `no starter for ${layout}`);
    const msg = render(starter);
    const headline = /^# (.+)$/m.exec(starter.bodyMarkdown)?.[1];
    assert.ok(headline, `${layout}: starter has no headline`);
    assert.match(msg.html, new RegExp(`<h1 class="pf-h1"[^>]*>${headline}</h1>`), `${layout}: headline is not live text`);
    assert.ok(msg.html.includes(`data-pf-layout="${layout}"`));
    assert.ok(msg.html.includes(`src="https://projectsflow.ru/mail/${layout}/hero-1.png"`), `${layout}: hero url`);
    assert.match(msg.html, /<img [^>]*alt="[^"]{12,}"/, `${layout}: hero alt text`);
    assert.ok(msg.html.includes(`>${starter.ctaLabel}</a>`) && msg.html.includes(`href="${starter.ctaUrl}"`), `${layout}: CTA`);
    assert.ok(msg.html.includes(`bgcolor="${PROMO_THEMES[layout].cta.bg}"`), `${layout}: bulletproof button`);
    assert.ok(msg.html.includes(starter.offer!.badge) && msg.html.includes(starter.offer!.deadline), `${layout}: offer strip`);
    assert.ok(msg.html.includes(`href="${UNSUB}"`) && msg.html.includes('Отписаться от рассылок'), `${layout}: unsubscribe footer`);
    assert.equal(msg.headers?.['List-Unsubscribe'], `<${UNSUB}>`);
    assert.ok(!/<svg|<script|background-image|position:\s*absolute|@import|backdrop-filter/i.test(msg.html), `${layout}: unsupported markup`);
    assert.ok(!/\{\{/.test(msg.html + msg.subject + msg.text), `${layout}: unfilled variable`);
    assert.ok(msg.text.includes(starter.offer!.badge) && msg.text.includes(UNSUB), `${layout}: plain-text part`);
  }
});

test('hero images ship with the client and stay light', () => {
  for (const layout of PROMO) {
    const file = fileURLToPath(new URL(`../../../../client/public/mail/${layout}/${PROMO_THEMES[layout].hero.file}`, import.meta.url));
    const size = statSync(file).size;
    assert.ok(size > 10_000 && size <= 250_000, `${layout}: hero is ${size} bytes`);
  }
});

test('promo variables {{offer}}/{{deadline}} and the recipient name are escaped', () => {
  const content = {
    subject: '{{name}}: {{offer}} {{deadline}}', preheader: 'До {{deadline}}', bodyMarkdown: '# Привет, {{name}}\n\nПредложение: {{offer}}',
    ctaLabel: 'Забрать {{offer}}', ctaUrl: 'https://projectsflow.ru/profile',
    layout: 'trial' as const, offer: { badge: '<b>7 дней</b>', deadline: 'до "завтра"' },
  };
  const msg = render(content, { name: '<img src=x onerror=1>', workspace: '' });
  assert.ok(!msg.html.includes('<b>7 дней</b>') && !msg.html.includes('<img src=x'));
  assert.ok(msg.html.includes('&lt;b&gt;7 дней&lt;/b&gt;') && msg.html.includes('до &quot;завтра&quot;'));
  assert.equal(msg.subject, '<img src=x onerror=1>: <b>7 дней</b> до "завтра"');
  assert.equal(renderMailingPreheader(content, vars), 'До до "завтра"');
});

test('the classic layout ignores offers and has no hero; a missing offer hides the strip', () => {
  const base = { subject: 'Тема', preheader: '', bodyMarkdown: 'Текст', ctaLabel: null, ctaUrl: null };
  const standard = render({ ...base, layout: 'standard', offer: { badge: '7 дней', deadline: 'x' } });
  assert.ok(!standard.html.includes('/mail/') && !standard.html.includes('7 дней') && standard.html.includes('PROJECTSFLOW'));
  const bare = render({ ...base, layout: 'annual', offer: null });
  assert.ok(bare.html.includes('/mail/annual/hero-1.png') && !bare.html.includes('class="pf-offer"'));
  // Rows saved before db/177 (no layout) render as the classic letter.
  const legacy = render({ ...base } as unknown as Parameters<typeof render>[0]);
  assert.ok(legacy.html.includes('PROJECTSFLOW') && !legacy.html.includes('/mail/'));
});

test('content parsing: layout defaults to standard, unknown layouts are rejected, offers are normalized', () => {
  const base = { subject: 'Тема', bodyMarkdown: 'Текст' };
  assert.deepEqual([parseMailingContent(base).layout, parseMailingContent(base).offer], ['standard', null]);
  assert.equal(parseMailingContent({ ...base, layout: 'standard', offer: { badge: '7 дней' } }).offer, null);
  const promo = parseMailingContent({ ...base, layout: 'trial', offer: { badge: '  7   дней ', deadline: 'д'.repeat(100) } });
  assert.deepEqual(promo.offer, { badge: '7 дней', deadline: 'д'.repeat(60) });
  assert.equal(parseMailingContent({ ...base, layout: 'news', offer: { badge: ' ', deadline: '' } }).offer, null);
  assert.throws(() => parseMailingContent({ ...base, layout: 'brutalist' }), (e: unknown) => e instanceof MailingError && e.code === 'invalid_content');
});

test('своя подпись к предложению заменяет подпись макета, без неё остаётся подпись макета', () => {
  const vip = MAILING_STARTERS.find((s) => s.key === 'promo_vip')!;
  const own = render(vip);
  assert.ok(own.html.includes('тариф VIP без оплаты') && !own.html.includes('на годовой тариф'));
  assert.ok(own.text.includes('тариф VIP без оплаты: 14 дней'));
  const plain = render({ ...vip, offer: { badge: '14 дней', deadline: 'до 20 декабря' } });
  assert.ok(plain.html.includes(PROMO_THEMES.annual.offer.caption));
  assert.deepEqual(parseMailingContent({ ...vip, offer: { badge: '1', deadline: '', caption: `  ${'x'.repeat(60)} ` } }).offer?.caption, 'x'.repeat(40));
});
