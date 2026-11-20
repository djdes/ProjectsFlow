// /index.md — чистая Markdown-версия главной страницы ProjectsFlow для ИИ-агентов (0 SQL).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { FAQ } from '@/data/faq';
import { PLANS, formatRub } from '@/data/pricing';
import { STACK_LAYERS } from '@/data/showcaseData';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/data/site';
import { readingMinutes } from '@/lib/blog';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const lines: string[] = [
    `# ${SITE_NAME} — опиши идею, получи готовый продукт`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `- Канонический адрес: ${SITE_URL}/`,
    `- Журнал: ${SITE_URL}/blog/`,
    `- Справочники для ИИ: ${SITE_URL}/llms.txt | ${SITE_URL}/llms-full.txt`,
    '',
    '## Архитектура и возможности платформы',
    '',
    ...STACK_LAYERS.map(
      (l) => `- **${l.shortName} (${l.headline} ${l.accentHeadline})**: ${l.description}`,
    ),
    '',
    '## Тарифы',
    '',
    '| Тариф | Стоимость | Слоган | Возможности |',
    '| --- | --- | --- | --- |',
    ...PLANS.map((p) => {
      const price =
        p.priceRub === 0
          ? `0 ₽ (${p.priceNote})`
          : `${formatRub(p.priceRub)} ₽ ${p.priceNote}${p.requestOnly ? ' (по запросу)' : ''}`;
      return `| ${p.name} | ${price} | ${p.tagline} | ${p.features.join('; ')} |`;
    }),
    '',
  ];

  if (posts.length > 0) {
    lines.push('## Свежие разборы в журнале', '');
    for (const p of posts.slice(0, 6)) {
      const mins = readingMinutes(p.body ?? '');
      const iso = p.data.date.toISOString().slice(0, 10);
      lines.push(
        `- [${p.data.title}](${SITE_URL}/blog/${p.id}/) (${iso}, ${mins} мин): ${p.data.description}`,
      );
    }
    lines.push('');
  }

  lines.push('## Частые вопросы', '');
  for (const f of FAQ) {
    lines.push(`### ${f.q}`, '', f.a, '');
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
