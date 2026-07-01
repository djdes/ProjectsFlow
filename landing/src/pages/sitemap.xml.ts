// Карта сайта для поисковиков: главная, список блога и все статьи (с lastmod по дате).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

const SITE = 'https://projectsflow.ru';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('blog', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );

  const urls: { loc: string; priority: string; lastmod?: string }[] = [
    { loc: `${SITE}/`, priority: '1.0' },
    { loc: `${SITE}/blog/`, priority: '0.8' },
    ...posts.map((p) => ({
      loc: `${SITE}/blog/${p.id}/`,
      priority: '0.7',
      lastmod: p.data.date.toISOString().slice(0, 10),
    })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>${u.priority}</priority></url>`,
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
