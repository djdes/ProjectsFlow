import { cn } from '@/lib/utils';
import { MARKDOWN_COMPACT } from '@/presentation/components/markdown/Markdown';

// Типографика текста задачи на карточках (доска проекта и «Входящие») — одна на обе
// поверхности, чтобы карточка выглядела одинаково, где бы её ни увидели.
//
// Заголовок — всегда полужирный и одной жирности: `**…**` в первой строке (так пишет
// композер из Telegram) больше не делает его жирнее заголовков без разметки.
export const TASK_CARD_TITLE_CLASS = 'font-semibold text-foreground';

// Тело — обычный приглушённый текст. Выделенные слова (`**…**`) — средней жирности и
// основного цвета: раньше они были жирнее самого заголовка и спорили с ним за внимание.
// Заголовки разметки внутри тела не «раздуваются» — выглядят как обычный текст.
export const TASK_CARD_BODY_CLASS = cn(
  MARKDOWN_COMPACT,
  'mbs-1 text-foreground/75',
  '[&_h1]:font-normal [&_h2]:font-normal [&_h3]:font-normal [&_h4]:font-normal',
  '[&_strong]:font-medium [&_b]:font-medium [&_strong]:text-foreground [&_b]:text-foreground',
);
