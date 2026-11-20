// /llms-full.txt — полный справочник продукта, тарифов, FAQ и всех статей журнала (0 SQL).
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
    `# ${SITE_NAME} — Полный справочник для ИИ-систем (llms-full.txt)`,
    '',
    `> ${SITE_DESCRIPTION}`,
    '',
    `- Сайт: ${SITE_URL}/ (Markdown: ${SITE_URL}/index.md)`,
    `- Журнал: ${SITE_URL}/blog/ (Markdown: ${SITE_URL}/blog.md)`,
    `- Краткий индекс: ${SITE_URL}/llms.txt`,
    '',
    '## Слои платформы',
    '',
    ...STACK_LAYERS.map(
      (l) =>
        `- **${l.shortName} — ${l.headline} ${l.accentHeadline}**: ${l.description} (${l.bullets.join('; ')})`,
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
    '## Вопросы и ответы',
    '',
    ...FAQ.flatMap((f) => [`### ${f.q}`, '', f.a, '']),
  ];

  if (posts.length > 0) {
    lines.push(`## Полные тексты статей журнала (${posts.length})`, '');
    for (const p of posts) {
      const mins = readingMinutes(p.body ?? '');
      const iso = p.data.date.toISOString().slice(0, 10);
      lines.push(
        '---',
        '',
        `### ${p.data.title}`,
        '',
        `- URL: ${SITE_URL}/blog/${p.id}/`,
        `- Markdown: ${SITE_URL}/blog/${p.id}.md`,
        `- Тема: ${p.data.topic} | Дата: ${iso} | Время чтения: ${mins} мин`,
        `- Описание: ${p.data.description}`,
        '',
        (p.body ?? '').trim(),
        '',
      );
    }
  }

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
