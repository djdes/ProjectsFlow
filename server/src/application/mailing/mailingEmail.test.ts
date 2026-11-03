import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { MAILING_STARTERS } from '../../domain/mailing/starters.js';
import { MAILING_LAYOUTS, splitOfferPrice } from '../../domain/mailing/layouts.js';
import { MailingError } from '../../domain/mailing/errors.js';
import { escapeMailingHtml, fillMailingVariables } from '../../domain/mailing/renderMailingBody.js';
import { renderMailingEmail, renderMailingPreheader } from './mailingEmail.js';
import { parseMailingContent } from './MailingService.js';
import { PROMO_THEMES, isLastDayDeadline, type PromoLayout } from './promoLayouts.js';

const UNSUB = 'https://projectsflow.ru/api/mailing/unsubscribe/token.sig';
const vars = { name: 'Анна', workspace: 'Студия Север' };
const PROMO = MAILING_LAYOUTS.filter((l): l is PromoLayout => l !== 'standard');
const PROMO_STARTERS = MAILING_STARTERS.filter((s) => s.layout !== 'standard');

const render = (content: Parameters<typeof renderMailingEmail>[0]['content'], v = vars) =>
  renderMailingEmail({ to: 'anna@example.com', content, vars: v, unsubscribeUrl: UNSUB, assetBaseUrl: 'https://projectsflow.ru/' });

const count = (hay: string, needle: string) => hay.split(needle).length - 1;
// The offer field: the row holding data-pf-offer, up to the body row.
const fieldOf = (html: string) => {
  const at = html.lastIndexOf('<tr>', html.indexOf('data-pf-offer'));
  return html.indexOf('data-pf-offer') < 0 ? '' : html.slice(at,html.indexOf('</td></tr>\n        <tr><td class="pf-pad" style="padding:30px', at));
};

test('every promo layout has a starter', () => {
  for (const layout of PROMO) assert.ok(MAILING_STARTERS.some((s) => s.layout === layout), `no starter for ${layout}`);
});

test('each promo starter leads with the offer: live text right under the hero, then the button, the button again at the end', () => {
  for (const starter of PROMO_STARTERS) {
    const layout = starter.layout as PromoLayout;
    const theme = PROMO_THEMES[layout];
    const offer = starter.offer!;
    const msg = render(starter);
    const k = starter.key;
    const field = fieldOf(msg.html);
    const label = escapeMailingHtml(fillMailingVariables(starter.ctaLabel!, { ...vars, offer: offer.badge, deadline: offer.deadline }));

    assert.ok(msg.html.includes(`src="https://projectsflow.ru/mail/${layout}/hero-2.png"`), `${k}: hero url`);
    assert.match(msg.html, /<img [^>]*alt="[^"]{12,}"/, `${k}: hero alt text`);
    // Order: hero → offer field (badge, deadline, button) → headline.
    const hero = msg.html.indexOf('<img ');
    const h1 = msg.html.indexOf('<h1 class="pf-h1"');
    assert.ok(hero > 0 && hero < msg.html.indexOf('data-pf-offer') && msg.html.indexOf('data-pf-offer') < h1, `${k}: offer is not right under the hero`);
    assert.ok(field.includes(`class="pf-offer pf-offer-`) && field.includes(`>${escapeMailingHtml(offer.badge)}</div>`), `${k}: badge is not live text in the field`);
    assert.ok(field.includes(escapeMailingHtml(offer.deadline)), `${k}: deadline missing in the field`);
    assert.ok(field.includes(`bgcolor="${theme.offer.field}"`), `${k}: field colour survives images off`);
    assert.ok(field.includes(`bgcolor="${theme.offer.button.bg}"`) && field.includes(`>${label}</a>`), `${k}: primary button in the field`);
    // The CTA twice: in the field and after the body.
    assert.equal(count(msg.html, `>${label}</a>`), 2, `${k}: CTA must appear twice`);
    assert.equal(count(msg.html, `href="${starter.ctaUrl}"`), 2, `${k}: CTA href twice`);
    assert.ok(msg.html.lastIndexOf(`>${label}</a>`) > h1, `${k}: repeated CTA after the body`);
    assert.ok(msg.html.includes(`bgcolor="${theme.cta.bg}"`), `${k}: bulletproof end button`);
    assert.match(msg.html, /class="pf-btn [^"]*" style="[^"]*font-size:18px;[^"]*padding:18px/, `${k}: button at least 48px tall`);
    // Copy pattern: headline, P.S. with the offer.
    const headline = /^# (.+)$/m.exec(starter.bodyMarkdown)?.[1];
    assert.ok(headline, `${k}: starter has no headline`);
    assert.match(starter.bodyMarkdown, /\*\*P\.S\.\*\* .*\{\{(offer|deadline)\}\}/, `${k}: P.S. repeats the offer or its term`);

    assert.ok(msg.html.includes(`data-pf-layout="${layout}"`));
    assert.ok(msg.html.includes(`href="${UNSUB}"`) && msg.html.includes('Отписаться от рассылок'), `${k}: unsubscribe footer`);
    assert.equal(msg.headers?.['List-Unsubscribe'], `<${UNSUB}>`);
    assert.ok(!/<svg|<script|background-image|position:\s*(absolute|fixed)|(?<!text-)transform:|@import|backdrop-filter/i.test(msg.html), `${k}: unsupported markup`);
    assert.ok(!/\{\{/.test(msg.html + msg.subject + msg.text), `${k}: unfilled variable`);
    // Plain text: offer first, CTA link before the body and at the end.
    assert.ok(msg.text.indexOf(offer.badge) < msg.text.indexOf(headline!), `${k}: plain text starts with the offer`);
    assert.equal(count(msg.text, `: ${starter.ctaUrl!}\n`), 2, `${k}: plain-text CTA twice`);
    assert.ok(msg.text.includes(UNSUB));
  }
});

test('subjects and preheaders: personal, concrete, short; the preheader adds instead of repeating', () => {
  for (const starter of PROMO_STARTERS) {
    const v = { ...vars, offer: starter.offer!.badge, deadline: starter.offer!.deadline };
    const subject = fillMailingVariables(starter.subject, v);
    const preheader = fillMailingVariables(starter.preheader, v);
    assert.ok(starter.subject.includes('{{name}}'), `${starter.key}: subject is not personal`);
    assert.ok(subject.length <= 60, `${starter.key}: subject is ${subject.length} chars`);
    assert.match(subject, /\d|месяц/u, `${starter.key}: subject has no concrete offer`);
    assert.ok(preheader.length > 20 && preheader !== subject && !subject.includes(preheader), `${starter.key}: preheader`);
  }
});

test('honest urgency: no invented scarcity, counters, reviews or prizes in any starter', () => {
  const FAKE = /осталось\s+\d|\d+\s+мест|мест[ао]?\s+осталось|вы выиграли|победител|таймер|обратный отсч|отзыв|\d[\d\s]*\s(команд|пользовател|клиент)/iu;
  for (const s of MAILING_STARTERS) {
    const text = [s.subject, s.preheader, s.bodyMarkdown, s.ctaLabel ?? '', s.offer?.badge ?? '', s.offer?.caption ?? '', s.offer?.price ?? ''].join('\n');
    assert.ok(!FAKE.test(text), `${s.key}: ${FAKE.exec(text)?.[0]}`);
    // A crossed-out price only next to a real discount.
    if (s.offer?.price && splitOfferPrice(s.offer.price)) assert.match(s.offer.badge, /^−\d+%$/, `${s.key}: crossed-out price without a discount`);
  }
});

test('the badge is always the biggest line; only a last-day deadline in «Закат» becomes a ribbon', () => {
  const vip = MAILING_STARTERS.find((s) => s.key === 'promo_vip')!;
  // The owner's case: the VIP letter moved to «Закат» with an ordinary date.
  const onSunset = fieldOf(render({ ...vip, layout: 'deadline' }).html);
  assert.ok(!onSunset.includes('pf-ribbon'), 'an ordinary date must not become the big line');
  assert.match(onSunset, /class="pf-chip"[^>]*>только до 20 декабря</);
  assert.match(onSunset, /class="pf-offer pf-offer-m"[^>]*>14 дней</);

  const last = MAILING_STARTERS.find((s) => s.key === 'promo_deadline')!;
  const lastField = fieldOf(render(last).html);
  assert.match(lastField, /class="pf-ribbon"[^>]*>сегодня до 23:59</);
  assert.ok(lastField.indexOf('pf-ribbon') < lastField.indexOf('class="pf-offer'), 'ribbon above the badge');
  assert.match(lastField, /class="pf-offer pf-offer-l"[^>]*>−30%</, 'the discount stays poster-sized on the last day');
  assert.ok(!lastField.includes('pf-chip'));

  // Other layouts keep a chip even for «сегодня».
  assert.equal(isLastDayDeadline(PROMO_THEMES.annual, 'сегодня до 23:59'), false);
  assert.equal(isLastDayDeadline(PROMO_THEMES.deadline, 'до 20 декабря'), false);
  assert.equal(isLastDayDeadline(PROMO_THEMES.deadline, 'до завтра'), true);
  assert.ok(fieldOf(render({ ...last, layout: 'annual' }).html).includes('class="pf-chip"'));
});

test('price line: «X вместо Y» crosses out the old price, any other text is shown as is', () => {
  const annual = MAILING_STARTERS.find((s) => s.key === 'promo_annual')!;
  const NB = String.fromCharCode(0xa0);
  // Plain spaces as an admin types them; amounts are glued with non-breaking spaces on render.
  const field = fieldOf(render({ ...annual, offer: { ...annual.offer!, price: '15 960 ₽ вместо 22 800 ₽' } }).html);
  assert.ok(field.includes(`>15${NB}960${NB}₽</b> вместо <s style="text-decoration:line-through;">22${NB}800${NB}₽</s>`), 'crossed-out old price');
  const free = fieldOf(render({ ...annual, offer: { ...annual.offer!, badge: '7 дней', price: '0 ₽ — без карты' } }).html);
  assert.ok(free.includes(`0${NB}₽ — без карты`) && !free.includes('<s '));
  assert.deepEqual(splitOfferPrice('1 520 ₽ вместо 1 900 ₽'), { now: '1 520 ₽', was: '1 900 ₽' });
  assert.equal(splitOfferPrice('0 ₽ · обычно 3 900 ₽'), null);
});

test('hero images ship with the client and stay light; the previous heroes stay for letters already sent', () => {
  for (const layout of PROMO) {
    const url = (f: string) => fileURLToPath(new URL(`../../../../client/public/mail/${layout}/${f}`, import.meta.url));
    const size = statSync(url(PROMO_THEMES[layout].hero.file)).size;
    assert.ok(size > 10_000 && size <= 250_000, `${layout}: hero is ${size} bytes`);
    assert.ok(existsSync(url('hero-1.png')), `${layout}: hero-1.png is still referenced by sent letters`);
    assert.ok(existsSync(url('thumb-2.jpg')), `${layout}: picker thumbnail`);
  }
});

test('promo variables {{offer}}/{{deadline}} and the recipient name are escaped', () => {
  const content = {
    subject: '{{name}}: {{offer}} {{deadline}}', preheader: 'До {{deadline}}', bodyMarkdown: '# Привет, {{name}}\n\nПредложение: {{offer}}',
    ctaLabel: 'Забрать {{offer}}', ctaUrl: 'https://projectsflow.ru/profile',
    layout: 'trial' as const, offer: { badge: '<b>7 дней</b>', deadline: 'до "завтра"', price: '<i>1</i> вместо <s>2</s>' },
  };
  const msg = render(content, { name: '<img src=x onerror=1>', workspace: '' });
  assert.ok(!msg.html.includes('<b>7 дней</b>') && !msg.html.includes('<img src=x') && !msg.html.includes('<i>1</i>'));
  assert.ok(msg.html.includes('&lt;b&gt;7 дней&lt;/b&gt;') && msg.html.includes('до &quot;завтра&quot;'));
  assert.equal(msg.subject, '<img src=x onerror=1>: <b>7 дней</b> до "завтра"');
  assert.equal(renderMailingPreheader(content, vars), 'До до "завтра"');
});

test('the classic layout ignores offers and has no hero; a missing offer leaves only the button in the field', () => {
  const base = { subject: 'Тема', preheader: '', bodyMarkdown: 'Текст', ctaLabel: null, ctaUrl: null };
  const standard = render({ ...base, layout: 'standard', offer: { badge: '7 дней', deadline: 'x' } });
  assert.ok(!standard.html.includes('/mail/') && !standard.html.includes('7 дней') && standard.html.includes('PROJECTSFLOW'));
  const bare = render({ ...base, layout: 'annual', offer: null });
  assert.ok(bare.html.includes('/mail/annual/hero-2.png') && !bare.html.includes('class="pf-offer'));
  const withButton = render({ ...base, ctaLabel: 'Открыть', ctaUrl: 'https://projectsflow.ru/', layout: 'annual', offer: null });
  assert.ok(fieldOf(withButton.html).includes('>Открыть</a>') && count(withButton.html, '>Открыть</a>') === 2);
  // Rows saved before db/177 (no layout) render as the classic letter.
  const legacy = render({ ...base } as unknown as Parameters<typeof render>[0]);
  assert.ok(legacy.html.includes('PROJECTSFLOW') && !legacy.html.includes('/mail/'));
});

test('templates saved before the redesign (badge and deadline only) render with the new field', () => {
  const saved = {
    subject: '{{name}}, попробуйте VIP — {{offer}} без оплаты', preheader: 'Больше AI-бюджета', bodyMarkdown: '# Когда задач больше, чем рук\n\nТекст',
    ctaLabel: 'Посмотреть VIP', ctaUrl: 'https://projectsflow.ru/profile', layout: 'deadline' as const,
    offer: { badge: '14 дней', deadline: 'до 20 декабря', caption: 'тариф VIP без оплаты' },
  };
  const field = fieldOf(render(saved).html);
  assert.match(field, /class="pf-offer pf-offer-m"[^>]*>14 дней</);
  assert.ok(field.includes('тариф VIP без оплаты') && field.includes('class="pf-chip"') && field.includes('>Посмотреть VIP</a>'));
});

test('content parsing: layout defaults to standard, unknown layouts are rejected, offers are normalized', () => {
  const base = { subject: 'Тема', bodyMarkdown: 'Текст' };
  assert.deepEqual([parseMailingContent(base).layout, parseMailingContent(base).offer], ['standard', null]);
  assert.equal(parseMailingContent({ ...base, layout: 'standard', offer: { badge: '7 дней' } }).offer, null);
  const promo = parseMailingContent({ ...base, layout: 'trial', offer: { badge: '  7   дней ', deadline: 'д'.repeat(100) } });
  assert.deepEqual(promo.offer, { badge: '7 дней', deadline: 'д'.repeat(60) });
  assert.equal(parseMailingContent({ ...base, layout: 'news', offer: { badge: ' ', deadline: '' } }).offer, null);
  assert.deepEqual(parseMailingContent({ ...base, layout: 'annual', offer: { badge: '−30%', price: ` ${'9'.repeat(80)} ` } }).offer,
    { badge: '−30%', deadline: '', price: '9'.repeat(60) });
  assert.throws(() => parseMailingContent({ ...base, layout: 'brutalist' }), (e: unknown) => e instanceof MailingError && e.code === 'invalid_content');
});

test('своя подпись к предложению заменяет подпись макета, без неё остаётся подпись макета', () => {
  const vip = MAILING_STARTERS.find((s) => s.key === 'promo_vip')!;
  const own = render(vip);
  assert.ok(own.html.includes('VIP бесплатно') && !own.html.includes('на годовой тариф'));
  assert.ok(own.text.includes('VIP бесплатно: 14 дней'));
  const plain = render({ ...vip, offer: { badge: '14 дней', deadline: 'до 20 декабря' } });
  assert.ok(plain.html.includes(PROMO_THEMES.annual.offer.caption));
  assert.deepEqual(parseMailingContent({ ...vip, offer: { badge: '1', deadline: '', caption: `  ${'x'.repeat(60)} ` } }).offer?.caption, 'x'.repeat(40));
});
