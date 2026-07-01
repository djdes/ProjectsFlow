// Коллекция блога (Astro 5, glob-loader). Статьи — Markdown в src/content/blog/*.md.
// Схема фронтматтера валидируется zod'ом; TOC и время чтения считаются из тела статьи.
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    /** Заголовок статьи. */
    title: z.string(),
    /** Короткое описание (карточка + og). */
    description: z.string(),
    /** Тема — для фильтра на /blog и цвета обложки. */
    topic: z.enum(['Практика', 'Продукт', 'Деньги', 'Автоматизация']),
    /** Дата публикации. */
    date: z.coerce.date(),
    /** Автор (по умолчанию — команда). */
    author: z.string().default('Команда ProjectsFlow'),
    /** Скрыть из списка (черновик). */
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
