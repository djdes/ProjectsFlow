// /blog/<slug>.md — чистый Markdown отдельной статьи журнала для ИИ-агентов (0 SQL).
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { SITE_URL } from '@/data/site';
import { readingMinutes } from '@/lib/blog';

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.map((post) => ({
    params: { slug: post.id },
    props: { post },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const post = props.post;
  const mins = readingMinutes(post.body ?? '');
  const iso = post.data.date.toISOString().slice(0, 10);

  const lines: string[] = [
    `# ${post.data.title}`,
    '',
    `> ${post.data.description}`,
    '',
    `- Канонический адрес: ${SITE_URL}/blog/${post.id}/`,
    `- Тема: ${post.data.topic}`,
    `- Автор: ${post.data.author}`,
    `- Дата публикации: ${iso}`,
    `- Время чтения: ${mins} мин`,
    '',
    (post.body ?? '').trim(),
    '',
  ];

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
