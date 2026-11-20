// /blog.md — чистая Markdown-версия журнала ProjectsFlow для ИИ-агентов (0 SQL).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_NAME, SITE_URL } from '@/data/site';
import { readingMinutes } from '@/lib/blog';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const lines: string[] = [
    `# Журнал ${SITE_NAME} — как строить продукты с AI`,
    '',
    '> Практика, архитектура, экономика и ИИ-агенты для тех, кто запускает цифровые продукты.',
    '',
    `- Канонический адрес: ${SITE_URL}/blog/`,
    '',
    `## Статьи (${posts.length})`,
    '',
    ...posts.map((p) => {
      const mins = readingMinutes(p.body ?? '');
      const iso = p.data.date.toISOString().slice(0, 10);
      return `- [${p.data.title}](${SITE_URL}/blog/${p.id}/) ([#${p.data.topic}] · ${iso} · ${mins} мин): ${p.data.description}`;
    }),
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
