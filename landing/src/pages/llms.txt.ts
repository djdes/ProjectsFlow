// /llms.txt — короткое описание сайта для ИИ-помощников (ChatGPT, Алиса, Perplexity)
// в формате llmstxt.org. Своего текста нет: описание, тарифы, вопросы и статьи берутся
// из тех же data-файлов и коллекции блога, что и видимые страницы.
// Без этого файла адрес отдавал оболочку приложения (HTML с кодом 200).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { FAQ } from '@/data/faq';
import { PLANS, formatRub } from '@/data/pricing';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/data/site';

/** Одна строка без переводов строк: в llms.txt абзац = строка. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const lines: string[] = [
    `# ${SITE_NAME}`,
    '',
    `> ${oneLine(SITE_DESCRIPTION)}`,
    '',
    '## Страницы',
    '',
    `- [Главная](${SITE_URL}/): что умеет платформа, тарифы, вопросы и ответы`,
    `- [Блог](${SITE_URL}/blog/): статьи о создании продуктов с AI`,
    '',
    '## Тарифы',
    '',
    ...PLANS.map((p) => {
      const price = p.priceRub === 0 ? `бесплатно, ${p.priceNote}` : `${formatRub(p.priceRub)} ₽ ${p.priceNote}`;
      const request = p.requestOnly ? ', подключение по запросу' : '';
      return `- ${p.name}: ${oneLine(price)}${request}. ${oneLine(p.tagline)}`;
    }),
    '',
  ];

  if (posts.length > 0) {
    lines.push('## Статьи', '');
    for (const p of posts) {
      lines.push(`- [${oneLine(p.data.title)}](${SITE_URL}/blog/${p.id}/): ${oneLine(p.data.description)}`);
    }
    lines.push('');
  }

  lines.push('## Вопросы и ответы', '');
  for (const f of FAQ) lines.push(`### ${oneLine(f.q)}`, '', oneLine(f.a), '');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
